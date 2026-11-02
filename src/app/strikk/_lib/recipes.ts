export interface KnitRecipe {
  id: string
  title: string
  designer: string | null
  drive_file_id: string
  file_name: string
  source: 'upload'
  created_at: string
  updated_at: string
}

export const RECIPE_SELECT = 'id, title, designer, drive_file_id, file_name, source, created_at, updated_at'

export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim() || fileName
}
