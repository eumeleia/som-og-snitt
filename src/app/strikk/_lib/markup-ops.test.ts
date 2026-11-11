import { describe, it, expect } from 'vitest'
import { applyOps, undoOps, type DocState, type Op, type Stroke } from './markup-ops'
import { popStep, pushStep, type UndoStep } from './undo-stack'

const stroke = (id: string, points = [0.1, 0.1, 0.5, 0.5]): Stroke => ({ id, page: 1, tool: 'pen', color: '#000', width: 0.003, points })
const empty: DocState = { strokes: [], counters: [] }

// Does an action, remembers how to undo it, as the project view does.
function act(state: DocState, stack: UndoStep[], ops: Op[]) {
  return { state: applyOps(state, ops), stack: pushStep(stack, undoOps(state, ops)) }
}
function undo(state: DocState, stack: UndoStep[]) {
  const { step, stack: rest } = popStep(stack)
  return { state: step ? applyOps(state, step) : state, stack: rest }
}
const ids = (s: DocState) => s.strokes.map(x => x.id)

describe('undo', () => {
  it('takes away the last stroke', () => {
    let r = act(empty, [], [{ type: 'stroke_add', stroke: stroke('a') }])
    expect(ids(r.state)).toEqual(['a'])
    r = undo(r.state, r.stack)
    expect(ids(r.state)).toEqual([])
    expect(r.stack).toEqual([])
  })

  it('brings back what the eraser took, also a stroke erased completely, in its old place', () => {
    const start: DocState = { strokes: [stroke('a'), stroke('b'), stroke('c')], counters: [] }
    // One drag cuts a in two and erases c completely.
    const r = act(start, [], [
      { type: 'stroke_split', id: 'a', parts: [stroke('a1', [0.1, 0.1, 0.2, 0.2]), stroke('a2', [0.4, 0.4, 0.5, 0.5])] },
      { type: 'stroke_split', id: 'c', parts: [] },
    ])
    expect(ids(r.state)).toEqual(['a1', 'a2', 'b'])
    expect(r.stack).toHaveLength(1)
    const back = undo(r.state, r.stack)
    expect(back.state.strokes).toEqual(start.strokes)
  })

  it('goes back several steps in order', () => {
    let r = act(empty, [], [{ type: 'stroke_add', stroke: stroke('a') }])
    r = act(r.state, r.stack, [{ type: 'stroke_add', stroke: stroke('b') }])
    r = act(r.state, r.stack, [{ type: 'stroke_split', id: 'a', parts: [stroke('a1')] }])
    expect(ids(r.state)).toEqual(['a1', 'b'])
    r = undo(r.state, r.stack)
    expect(ids(r.state)).toEqual(['a', 'b'])
    r = undo(r.state, r.stack)
    expect(ids(r.state)).toEqual(['a'])
    r = undo(r.state, r.stack)
    expect(ids(r.state)).toEqual([])
    r = undo(r.state, r.stack)
    expect(ids(r.state)).toEqual([])
  })

  it('gives the same result when the undo ops are sent twice, as after a lost response', () => {
    const start: DocState = { strokes: [stroke('a'), stroke('b')], counters: [] }
    const ops: Op[] = [{ type: 'stroke_split', id: 'a', parts: [stroke('a1')] }]
    const step = undoOps(start, ops)
    const once = applyOps(applyOps(start, ops), step)
    expect(applyOps(once, step)).toEqual(once)
    expect(once.strokes).toEqual(start.strokes)
  })

  it('remembers nothing for counters, or an erase of a stroke that was not there', () => {
    expect(undoOps(empty, [{ type: 'counter_add', counter: { id: 'c', name: 'Omganger', total: null, value: 0 } }])).toEqual([])
    expect(undoOps(empty, [{ type: 'stroke_split', id: 'x', parts: [] }])).toEqual([])
    expect(pushStep([], [])).toEqual([])
  })

  it('keeps the newest steps when there are too many', () => {
    let stack: UndoStep[] = []
    for (let i = 0; i < 5; i++) stack = pushStep(stack, [{ type: 'stroke_delete', id: `s${i}` }], 3)
    expect(stack.map(s => (s[0] as { id: string }).id)).toEqual(['s2', 's3', 's4'])
  })
})
