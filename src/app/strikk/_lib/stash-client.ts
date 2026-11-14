// Loading the stash in the browser with the newest columns the database has: migrations
// 028 (dye_lot) and 029 (project_skeins) may not be run yet.
import { supabase } from '@/lib/supabase'
import { MISSING_COLUMN, STASH_SELECTS, type StashRow } from './stash'

export async function fetchStash(where: { projectId?: string } = {}): Promise<{ data: StashRow[] | null; error: string | null }> {
  let last: string | null = null
  for (const select of STASH_SELECTS) {
    let q = supabase.from('strikk_yarn_stash').select(select)
    if (where.projectId) q = q.eq('project_id', where.projectId)
    const res = await q.order('created_at')
    if (!res.error) return { data: (res.data ?? []) as unknown as StashRow[], error: null }
    last = res.error.message
    if (res.error.code !== MISSING_COLUMN) break
  }
  return { data: null, error: last }
}
