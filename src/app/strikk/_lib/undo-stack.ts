// The undo steps for one project on this device: each step is the ops that undo one action.
// Kept in localStorage, so undo still works after the page is reloaded or the change has
// been saved. Steps from other devices are not here.
import type { Op } from './markup-ops'

export const UNDO_LIMIT = 50

export type UndoStep = Op[]

export function pushStep(stack: UndoStep[], step: UndoStep, limit = UNDO_LIMIT): UndoStep[] {
  if (step.length === 0) return stack
  return [...stack, step].slice(-limit)
}

export function popStep(stack: UndoStep[]): { step: UndoStep | null; stack: UndoStep[] } {
  if (stack.length === 0) return { step: null, stack }
  return { step: stack[stack.length - 1], stack: stack.slice(0, -1) }
}

const key = (projectId: string) => `strikk-undo-${projectId}`

export function readStack(projectId: string): UndoStep[] {
  try {
    const raw = localStorage.getItem(key(projectId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeStack(projectId: string, stack: UndoStep[]) {
  try {
    if (stack.length) localStorage.setItem(key(projectId), JSON.stringify(stack))
    else localStorage.removeItem(key(projectId))
  } catch { /* full or private storage: undo still works while the page is open */ }
}
