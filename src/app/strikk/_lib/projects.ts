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
  strikk_project_yarn: ProjectYarn[]
}

export const PROJECT_SELECT =
  'id, name, oppskrift_id, size_index, size_label, needles, status, start_date, end_date, notes, ' +
  'sort_order, strokes, counters, version, created_at, updated_at, ' +
  'strikk_project_yarn(id, position, yarn_id, color_label)'

export function sortedYarn(p: Pick<Project, 'strikk_project_yarn'>): ProjectYarn[] {
  return [...p.strikk_project_yarn].sort((a, b) => a.position - b.position)
}

// For prosjektlista: ikke streker/tellere (kan bli store), men oppskriftens titel for
// visning på kortet.
export const PROJECT_LIST_SELECT =
  'id, name, oppskrift_id, size_label, status, sort_order, created_at, strikk_oppskrift(title)'

export interface ProjectListRow {
  id: string
  name: string
  oppskrift_id: string | null
  size_label: string | null
  status: ProjectStatus
  sort_order: number
  created_at: string
  strikk_oppskrift: { title: string } | null
}
