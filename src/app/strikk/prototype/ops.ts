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
}

export type Op =
  | { type: 'stroke_add'; stroke: Stroke }
  | { type: 'stroke_delete'; id: string }
  | { type: 'counter_add'; counter: Counter }
  | { type: 'counter_set'; id: string; value: number }
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
      case 'counter_add':
        if (!counters.some(c => c.id === op.counter.id)) counters = [...counters, op.counter]
        break
      case 'counter_set':
        counters = counters.map(c => (c.id === op.id ? { ...c, value: op.value } : c))
        break
      case 'counter_delete':
        counters = counters.filter(c => c.id !== op.id)
        break
    }
  }
  return { strokes, counters }
}
