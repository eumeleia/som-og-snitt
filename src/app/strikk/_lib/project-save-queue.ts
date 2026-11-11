import type { Counter, Op } from './markup-ops'

// Samme kø-mønster som strikk/prototype hadde (saveQueue.ts, nå fjernet sammen med
// prototypen): hver op går gjennom køen og lagres i localStorage før den sendes, så en
// strek overlever at Safari lukkes midt i en forespørsel. Én forespørsel om gangen, så
// read–merge–write i op-ruta ikke kappes med seg selv. Nå peker den på ett prosjekt i
// strikk_project i stedet for den ene raden strikk_prototype hadde.

const STORAGE_KEY = 'strikk-project-queue'
const RETRY_MS = 10_000
const CONFLICT_RETRY_MS = [300, 800] as const
const CONFLICTS_BEFORE_UNSAVED = 3

interface QueuedOp {
  docId: string
  op: Op
}

export interface QueueStatus {
  pending: number
  failed: boolean
}

let queue: QueuedOp[] = read()
let inFlight = false
let failed = false
let conflicts = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(s: QueueStatus) => void>()
const counterListeners = new Set<(docId: string, counters: Counter[]) => void>()

function read(): QueuedOp[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    return raw ? (JSON.parse(raw) as QueuedOp[]) : []
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Private mode or full storage: the op is still in memory and is sent while the page is open.
  }
}

function notify() {
  const status = getStatus()
  for (const l of listeners) l(status)
}

export function getStatus(): QueueStatus {
  return { pending: queue.length, failed }
}

export function subscribe(listener: (s: QueueStatus) => void): () => void {
  listeners.add(listener)
  listener(getStatus())
  return () => { listeners.delete(listener) }
}

export function subscribeServerCounters(listener: (docId: string, counters: Counter[]) => void): () => void {
  counterListeners.add(listener)
  return () => { counterListeners.delete(listener) }
}

export function pendingOps(docId: string): Op[] {
  return queue.filter(q => q.docId === docId).map(q => q.op)
}

export function enqueue(docId: string, op: Op) {
  queue.push({ docId, op })
  persist()
  notify()
  void flush()
}

function scheduleRetry(ms = RETRY_MS) {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flush()
  }, ms)
}

export async function flush() {
  if (inFlight || queue.length === 0) return
  inFlight = true
  try {
    while (queue.length > 0) {
      const docId = queue[0].docId
      let n = 0
      while (n < queue.length && queue[n].docId === docId) n++
      const batch = queue.slice(0, n)

      let res: Response
      try {
        res = await fetch(`/api/strikk/projects/${docId}/op`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ops: batch.map(b => b.op) }),
        })
      } catch {
        failed = true
        notify()
        scheduleRetry()
        return
      }

      if (res.status === 409) {
        conflicts++
        if (conflicts >= CONFLICTS_BEFORE_UNSAVED) failed = true
        notify()
        const [min, max] = CONFLICT_RETRY_MS
        scheduleRetry(min + Math.random() * (max - min))
        return
      }

      if (!res.ok && res.status !== 400 && res.status !== 404) {
        failed = true
        notify()
        scheduleRetry()
        return
      }
      if (!res.ok) console.error('[strikk-project] dropped ops', res.status, await res.text())
      const body = res.ok ? await res.json().catch(() => null) as { counters?: Counter[] } | null : null

      queue = queue.slice(n)
      failed = false
      conflicts = 0
      persist()
      notify()
      if (body?.counters) for (const l of counterListeners) l(docId, body.counters)
    }
  } finally {
    inFlight = false
  }
}

if (typeof window !== 'undefined') {
  void flush()
  window.addEventListener('online', () => { void flush() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush()
  })
}
