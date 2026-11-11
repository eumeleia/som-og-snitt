// Shared by the page (to apply queued ops on top of server state) and by the op route
// (to merge them into the row). Every op is idempotent, so a retry after a lost response
// never changes the result.

export type Tool = 'marker' | 'pen' | 'eraser'

export interface Stroke {
  id: string
  page: number // 1-based
  tool: 'marker' | 'pen'
  color: string
  // Fraction of page width.
  width: number
  // Flat [x0, y0, x1, y1, ...], both relative to the page (0–1).
  points: number[]
}

export interface Counter {
  id: string
  name: string
  total: number | null
  value: number
  // Recent counter_step op ids, so a retried step is counted once.
  applied?: string[]
}

// How many step ids each counter remembers. A retry only arrives after a lost response,
// long before this many newer steps could have landed on the same counter.
const APPLIED_LIMIT = 200

export type Op =
  | { type: 'stroke_add'; stroke: Stroke }
  // Kept so ops still queued on a device from before the partial eraser can be applied.
  | { type: 'stroke_delete'; id: string }
  // Replaces a stroke with what the eraser left of it (empty = fully erased).
  | { type: 'stroke_split'; id: string; parts: Stroke[] }
  // Undoes an erase: takes away what the eraser left (parts, by id) and puts the whole
  // stroke back where it was. Nothing happens if the stroke is already there.
  | { type: 'stroke_restore'; stroke: Stroke; parts: string[] }
  | { type: 'counter_add'; counter: Counter }
  | { type: 'counter_set'; id: string; value: number }
  // +1/−1 from a tap. Steps from two devices add up, unlike counter_set where the last
  // write wins.
  | { type: 'counter_step'; id: string; delta: number; opId: string }
  | { type: 'counter_delete'; id: string }

export interface DocState {
  strokes: Stroke[]
  counters: Counter[]
}

export function applyOps(state: DocState, ops: Op[]): DocState {
  let strokes = state.strokes
  let counters = state.counters
  for (const op of ops) {
    switch (op.type) {
      case 'stroke_add':
        strokes = [...strokes.filter(s => s.id !== op.stroke.id), op.stroke]
        break
      case 'stroke_delete':
        strokes = strokes.filter(s => s.id !== op.id)
        break
      case 'stroke_split': {
        // Only while the stroke is still there: a retry after a lost response finds the
        // parts already in place, and a split from another device cannot bring erased
        // ink back.
        const i = strokes.findIndex(s => s.id === op.id)
        if (i === -1) break
        strokes = [...strokes.slice(0, i), ...op.parts, ...strokes.slice(i + 1)]
        break
      }
      case 'stroke_restore': {
        if (strokes.some(s => s.id === op.stroke.id)) break
        const drop = new Set(op.parts)
        const at = strokes.findIndex(s => drop.has(s.id))
        const rest = strokes.filter(s => !drop.has(s.id))
        strokes = at === -1 ? [...rest, op.stroke] : [...rest.slice(0, at), op.stroke, ...rest.slice(at)]
        break
      }
      case 'counter_add':
        if (!counters.some(c => c.id === op.counter.id)) counters = [...counters, op.counter]
        break
      case 'counter_set':
        counters = counters.map(c => (c.id === op.id ? { ...c, value: op.value } : c))
        break
      case 'counter_step':
        counters = counters.map(c => {
          if (c.id !== op.id || c.applied?.includes(op.opId)) return c
          return {
            ...c,
            value: Math.max(0, c.value + op.delta),
            applied: [...(c.applied ?? []), op.opId].slice(-APPLIED_LIMIT),
          }
        })
        break
      case 'counter_delete':
        counters = counters.filter(c => c.id !== op.id)
        break
    }
  }
  return { strokes, counters }
}

// The ops that undo one action (one stroke, or one eraser drag that may cut several
// strokes), worked out from the state just before it. Applied in order, they bring the
// strokes back to that state. Counters are not undone.
export function undoOps(before: DocState, ops: Op[]): Op[] {
  const undo: Op[] = []
  for (const op of ops) {
    if (op.type === 'stroke_add') {
      undo.unshift({ type: 'stroke_delete', id: op.stroke.id })
    } else if (op.type === 'stroke_split' || op.type === 'stroke_delete') {
      const stroke = before.strokes.find(s => s.id === op.id)
      if (!stroke) continue
      const parts = op.type === 'stroke_split' ? op.parts.map(p => p.id) : []
      undo.unshift({ type: 'stroke_restore', stroke, parts })
    }
  }
  return undo
}
