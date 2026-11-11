import type { Audience, StoredRecipe } from './extraction'

export interface KnitRecipe {
  id: string
  title: string
  designer: string | null
  drive_file_id: string
  file_name: string
  source: 'upload'
  created_at: string
  updated_at: string
  audience: Audience | null
  extraction_status: StoredRecipe['extraction_status']
}

export const RECIPE_SELECT = 'id, title, designer, drive_file_id, file_name, source, created_at, updated_at, audience, extraction_status'

// Not read in yet: waiting for Claude Code. Read in but not approved: Claude Code has
// checked it and kept it for Maria, because something in the pattern itself is unclear.
export const waitsForClaudeCode = (r: Pick<KnitRecipe, 'extraction_status'>) => r.extraction_status === 'pending' || r.extraction_status === 'failed'
export const needsMaria = (r: Pick<KnitRecipe, 'extraction_status'>) => r.extraction_status === 'extracted'

export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || fileName
}

// «Navn - Designer.pdf» → title and designer. Split on the last « - », so a title may
// contain a dash but a designer may not. Anything else is all title.
export function parseRecipeFileName(fileName: string): { title: string; designer: string | null } {
  const base = titleFromFileName(fileName)
  const at = base.lastIndexOf(' - ')
  if (at <= 0) return { title: base, designer: null }
  const title = base.slice(0, at).trim()
  const designer = base.slice(at + 3).trim()
  return title && designer ? { title, designer } : { title: base, designer: null }
}
