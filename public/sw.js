// Service worker for Søm & Snitt: lets the app open from the home screen without a
// network, for the knitting projects in progress (src/app/strikk/_lib/offline.ts keeps
// their data and PDFs in IndexedDB).
//
// With a network the app always gets the latest version: pages and data come from the
// network, and the stored copy is used only when the network fails. Files under
// /_next/static/ have a hash in their name, so a stored one is never out of date; a new
// deploy brings new names. Files not used for 30 days are removed.

const PAGES = 'pages-v1'
const STATIC = 'static-v1'
const META = 'meta-v1'
const META_KEY = '/__sw-last-used'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [PAGES, STATIC, META]
    for (const name of await caches.keys()) if (!keep.includes(name)) await caches.delete(name)
    await self.clients.claim()
    await prune()
  })())
})

// ---- Last use of each static file, for pruning ----

let lastUsed = null
let saveTimer = null

async function loadLastUsed() {
  if (lastUsed) return lastUsed
  const res = await (await caches.open(META)).match(META_KEY)
  lastUsed = res ? await res.json() : {}
  return lastUsed
}

function touch(url) {
  loadLastUsed().then(m => {
    m[url] = Date.now()
    if (saveTimer) return
    saveTimer = setTimeout(async () => {
      saveTimer = null
      await (await caches.open(META)).put(META_KEY, new Response(JSON.stringify(lastUsed), { headers: { 'Content-Type': 'application/json' } }))
    }, 2000)
  })
}

async function prune() {
  const m = await loadLastUsed()
  const cache = await caches.open(STATIC)
  const now = Date.now()
  for (const req of await cache.keys()) {
    const used = m[req.url]
    if (used === undefined) { m[req.url] = now; continue }
    if (now - used > MAX_AGE_MS) { await cache.delete(req); delete m[req.url] }
  }
  await (await caches.open(META)).put(META_KEY, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }))
}

// ---- Fetching ----

// Pages are stored by path: /strikk/prosjekt/x?view=pdf and /strikk/prosjekt/x are the same page.
const pageKey = url => new URL(url).origin + new URL(url).pathname

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES)
  try {
    const res = await fetch(request)
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      await cache.put(pageKey(request.url), res.clone())
    }
    return res
  } catch {
    const stored = await cache.match(pageKey(request.url))
    if (stored) return stored
    return offlinePage()
  }
}

function offlinePage() {
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Uten nett</title><body style="font-family:system-ui;background:#FAF7F4;color:#44403c;padding:2rem">' +
    '<h1 style="font-size:1.25rem">Uten nett</h1><p>Denne siden er ikke lagret på enheten. ' +
    'Pågående strikkeprosjekter finner du på <a href="/dashboard">Hjem</a>.</p></body>'
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC)
  const stored = await cache.match(request)
  touch(request.url)
  if (stored) return stored
  const res = await fetch(request)
  if (res.ok) await cache.put(request, res.clone())
  return res
}

// Icons, the manifest and other public files: the network, or the stored copy without one.
async function networkFirstFile(request) {
  const cache = await caches.open(STATIC)
  try {
    const res = await fetch(request)
    if (res.ok) await cache.put(request, res.clone())
    return res
  } catch (err) {
    const stored = await cache.match(request)
    if (stored) return stored
    throw err
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // A client-side navigation asks for the page as RSC data. Without a network it fails,
  // and Next then loads the page in full, which is answered from the stored pages below.
  if (request.headers.get('RSC') === '1' || url.searchParams.has('_rsc')) return

  if (request.mode === 'navigate') { event.respondWith(networkFirstPage(request)); return }
  if (url.pathname.startsWith('/_next/static/')) { event.respondWith(cacheFirstStatic(request)); return }
  if (/\.(png|svg|ico|json|webmanifest|woff2?)$/.test(url.pathname)) { event.respondWith(networkFirstFile(request)); return }
})

// ---- Warming: store the pages for the projects in progress and the code they load ----

async function warm(urls) {
  const pages = await caches.open(PAGES)
  const statics = await caches.open(STATIC)
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: 'same-origin' })
      if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) continue
      const html = await res.clone().text()
      await pages.put(pageKey(new URL(u, self.location.origin).href), res)
      const assets = new Set()
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1])
      // Chunks named only in the inline RSC payload: "/_next/static/chunks/….js".
      for (const m of html.matchAll(/(\/_next\/static\/[^"\\]+?\.(?:js|css))/g)) assets.add(m[1])
      for (const a of assets) {
        if (await statics.match(a)) { touch(new URL(a, self.location.origin).href); continue }
        try {
          const r = await fetch(a)
          if (r.ok) { await statics.put(a, r); touch(new URL(a, self.location.origin).href) }
        } catch { /* next warm */ }
      }
    } catch { /* next warm */ }
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'warm' && Array.isArray(event.data.urls)) event.waitUntil(warm(event.data.urls))
})
