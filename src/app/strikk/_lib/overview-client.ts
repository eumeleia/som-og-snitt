// When Strikkeoversikt.xlsx is written from the browser. A change schedules one write a
// little later, so a series of changes (many uploads, several approvals) gives one write.

const QUIET_MS = 15_000

export interface OverviewResult { ok: boolean; message: string }

let timer: ReturnType<typeof setTimeout> | null = null
let opened = false
let chain: Promise<unknown> = Promise.resolve()
const listeners = new Set<(r: OverviewResult) => void>()

export function onOverviewResult(fn: (r: OverviewResult) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

async function post(force: boolean): Promise<OverviewResult> {
  try {
    const res = await fetch('/api/strikk/overview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }), cache: 'no-store',
    })
    const body = await res.json() as { status?: string; recipes?: number; yarns?: number; error?: string }
    if (!res.ok) return { ok: false, message: body.error ?? `Feil ${res.status}` }
    const what = `${body.recipes} oppskriftsrader og ${body.yarns} garn`
    return { ok: true, message: body.status === 'unchanged' ? `Regnearket er oppdatert (${what})` : `Regnearket er skrevet (${what})` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export function refreshOverview(force: boolean): Promise<OverviewResult> {
  if (timer) { clearTimeout(timer); timer = null }
  // One write at a time: a new one waits for the one already running.
  const next = chain.then(() => post(force))
  chain = next
  return next.then(r => { listeners.forEach(fn => fn(r)); return r })
}

export function scheduleOverviewRefresh(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void refreshOverview(false) }, QUIET_MS)
}

// Once per page load: picks up changes made outside the app, such as by Claude Code.
export function refreshOverviewOnOpen(): void {
  if (opened) return
  opened = true
  void refreshOverview(false)
}
