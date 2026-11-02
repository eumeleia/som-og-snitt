import type { Op } from './ops'

// Every op goes through this queue, not only the failed ones: it is written to
// localStorage before the request is sent, so a stroke survives Safari being closed
// mid-request. Requests run one at a time, which keeps the op route's read–merge–write
// from racing itself.

const STORAGE_KEY = 'strikk-prototype-queue'
const RETRY_MS = 10_000

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
let retryTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(s: QueueStatus) => void>()

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

export function pendingOps(docId: string): Op[] {
  return queue.filter(q => q.docId === docId).map(q => q.op)
}

export function enqueue(docId: string, op: Op) {
  queue.push({ docId, op })
  persist()
  notify()
  void flush()
}

function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flush()
  }, RETRY_MS)
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
        res = await fetch(`/api/strikk-prototype/${docId}/op`, {
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

      // 400/404 will never succeed on retry (bad op or deleted row) and would block
      // everything behind it, so those ops are dropped.
      if (!res.ok && res.status !== 400 && res.status !== 404) {
        failed = true
        notify()
        scheduleRetry()
        return
      }
      if (!res.ok) console.error('[strikk-prototype] dropped ops', res.status, await res.text())

      // New ops may have been appended while the request ran; they sit after the batch.
      queue = queue.slice(n)
      failed = false
      persist()
      notify()
    }
  } finally {
    inFlight = false
  }
}

if (typeof window !== 'undefined') {
  // Ops left over from a session that was closed before they were sent.
  void flush()
  window.addEventListener('online', () => { void flush() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush()
  })
}
