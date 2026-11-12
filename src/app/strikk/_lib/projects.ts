// Strikk › Prosjekter: one row per project in strikk_project, with its yarn choices in
// strikk_project_yarn (migration 019). Pure types and the select string shared by the API
// routes and the client; no imports, like the rest of _lib.

export const STATUSES = ['planned', 'in_progress', 'done'] as const
export type ProjectStatus = typeof STATUSES[number]
export const STATUS_LABEL: Record<ProjectStatus, string> = { planned: 'Planlagt', in_progress: 'Pågående', done: 'Ferdig' }

export interface ProjectYarn {
  id: string
  position: number
  yarn_id: string | null
  color_label: string | null
}

export interface Project {
  id: string
  name: string
  oppskrift_id: string | null
  size_index: number | null
  size_label: string | null
  needles: string | null
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  notes: string | null
  sort_order: number
  // Same Stroke/Counter shape markup-ops.ts works on.
  strokes: unknown[]
  counters: unknown[]
  version: number
  created_at: string
  updated_at: string
  last_page: number | null
  last_offset: number | null
  current_page: number | null
  cover_path: string | null
  cover_at: string | null
  last_opened_at: string | null
  strikk_project_yarn: ProjectYarn[]
}

export const PROJECT_SELECT =
  'id, name, oppskrift_id, size_index, size_label, needles, status, start_date, end_date, notes, ' +
  'sort_order, strokes, counters, version, created_at, updated_at, ' +
  'last_page, last_offset, current_page, cover_path, cover_at, last_opened_at, ' +
  'strikk_project_yarn(id, position, yarn_id, color_label)'

export function sortedYarn(p: Pick<Project, 'strikk_project_yarn'>): ProjectYarn[] {
  return [...p.strikk_project_yarn].sort((a, b) => a.position - b.position)
}

// For prosjektlista: ikke streker/tellere (kan bli store), men oppskriftens titel for
// visning på kortet.
export const PROJECT_LIST_SELECT =
  'id, name, oppskrift_id, size_label, status, sort_order, created_at, updated_at, last_opened_at, cover_path, cover_at, ' +
  'strikk_oppskrift(title, thumbnail_path, thumbnail_at)'

export interface ProjectListRow {
  id: string
  name: string
  oppskrift_id: string | null
  size_label: string | null
  status: ProjectStatus
  sort_order: number
  created_at: string
  updated_at: string
  last_opened_at: string | null
  cover_path: string | null
  cover_at: string | null
  strikk_oppskrift: { title: string; thumbnail_path: string | null; thumbnail_at: string | null } | null
}

export const COVER_BUCKET = 'strikk-covers'
export const COVER_MAX_BYTES = 200 * 1024

// Where the project opens: the page marked «Gjeldende side» goes first, at its top, or at
// the saved height when the last position is on that same page. Then the last position.
export function startPosition(p: Pick<Project, 'current_page' | 'last_page' | 'last_offset'>): { page: number; offset: number } | null {
  if (p.current_page) return { page: p.current_page, offset: p.last_page === p.current_page ? p.last_offset ?? 0 : 0 }
  if (p.last_page) return { page: p.last_page, offset: p.last_offset ?? 0 }
  return null
}

// Most recently opened first. A project not opened since this was recorded counts by when
// it was last changed (fallback), or else created.
export function sortByLastOpened<T extends { last_opened_at: string | null; created_at: string }>(list: T[], fallback: (p: T) => string | null = () => null): T[] {
  const when = (p: T) => p.last_opened_at ?? fallback(p) ?? p.created_at
  return [...list].sort((a, b) => Number(!a.last_opened_at) - Number(!b.last_opened_at) || when(b).localeCompare(when(a)))
}

// The reading position and «Gjeldende side» from a PATCH body. These are not edits of the
// project: they do not change updated_at. undefined when the body has none of them.
export function parsePositionPatch(b: Record<string, unknown>):
  { patch: { last_page?: number; last_offset?: number; current_page?: number | null } } | { error: string } | undefined {
  const has = (k: string) => b[k] !== undefined
  if (!has('last_page') && !has('last_offset') && !has('current_page')) return undefined
  const patch: { last_page?: number; last_offset?: number; current_page?: number | null } = {}
  if (has('last_page') || has('last_offset')) {
    const page = b.last_page, offset = b.last_offset
    if (!Number.isInteger(page) || (page as number) < 1 || typeof offset !== 'number' || !Number.isFinite(offset)) return { error: 'Ugyldig posisjon' }
    patch.last_page = page as number
    patch.last_offset = Math.min(1, Math.max(0, Math.round(offset * 1000) / 1000))
  }
  if (has('current_page')) {
    const c = b.current_page
    if (c !== null && !(Number.isInteger(c) && (c as number) >= 1)) return { error: 'Ugyldig side' }
    patch.current_page = c as number | null
  }
  return { patch }
}
