// Loading a project with everything ProjectView shows, from the database, and keeping the
// projects in progress on the device for use without a network (offline.ts).
import { supabase } from '@/lib/supabase'
import { EXTRACTION_SELECT, type StoredRecipe } from './extraction'
import { PROJECT_SELECT, type Project } from './projects'
import { COMBO_SELECT, SWATCH_SELECT, type ComboRow, type SwatchRow } from './combos'
import type { YarnRow } from './yarns'
import { downloadPdf } from './drive'
import { hasIndexedDb, idbStore, syncOffline, type ProjectBundle, type SyncResult } from './offline'

export class ProjectMissingError extends Error {}

export async function fetchProjectBundle(id: string): Promise<ProjectBundle> {
  const { data: p, error: pErr } = await supabase.from('strikk_project').select(PROJECT_SELECT).eq('id', id).maybeSingle()
  if (pErr) throw new Error(pErr.message)
  if (!p) throw new ProjectMissingError('Fant ikke prosjektet. Det kan være slettet.')
  const project = p as unknown as Project
  let recipe: ProjectBundle['recipe'] = null
  let stored: StoredRecipe | null = null
  if (project.oppskrift_id) {
    const [{ data: r, error: rErr }, { data: thumb }] = await Promise.all([
      supabase.from('strikk_oppskrift').select(EXTRACTION_SELECT).eq('id', project.oppskrift_id).maybeSingle(),
      supabase.from('strikk_oppskrift').select('thumbnail_path, thumbnail_at').eq('id', project.oppskrift_id).maybeSingle(),
    ])
    if (rErr) throw new Error(rErr.message)
    if (r) {
      stored = r as unknown as StoredRecipe
      recipe = {
        title: stored.title, drive_file_id: stored.drive_file_id, file_name: stored.file_name,
        thumbnail_path: thumb?.thumbnail_path ?? null, thumbnail_at: thumb?.thumbnail_at ?? null,
      }
    }
  }
  const [yRes, comboRes, swatchRes] = await Promise.all([
    supabase.from('strikk_yarn').select('*'),
    supabase.from('strikk_yarn_combo').select(COMBO_SELECT),
    supabase.from('strikk_swatch').select(SWATCH_SELECT),
  ])
  if (yRes.error) throw new Error(yRes.error.message)
  return {
    project, recipe, stored,
    yarns: (yRes.data ?? []) as YarnRow[],
    combos: comboRes.error ? [] : (comboRes.data as unknown as ComboRow[] ?? []),
    swatches: swatchRes.error ? [] : (swatchRes.data as unknown as SwatchRow[] ?? []),
  }
}

async function listInProgress(): Promise<string[]> {
  const { data, error } = await supabase.from('strikk_project').select('id').eq('status', 'in_progress')
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => r.id as string)
}

// The pages and code a project needs without a network, fetched while there is one so
// the service worker keeps them (public/sw.js).
async function warmServiceWorker(projectIds: string[]) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
  navigator.serviceWorker.controller.postMessage({
    type: 'warm',
    urls: ['/', '/dashboard', '/strikk/prosjekter', ...projectIds.map(id => `/strikk/prosjekt/${id}`)],
  })
  // The PDF reader is loaded only when a PDF opens; load it now so it is kept too.
  await import('@/lib/readable-stream-async-iterator-polyfill')
  await import('pdfjs-dist')
  await fetch(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href).catch(() => undefined)
}

export const OFFLINE_EVENT = 'strikk-offline-changed'
let running: Promise<SyncResult | null> | null = null

// Runs at most once at a time; does nothing without a network.
export function runOfflineSync(): Promise<SyncResult | null> {
  if (running) return running
  if (typeof navigator === 'undefined' || !navigator.onLine || !hasIndexedDb()) return Promise.resolve(null)
  running = (async () => {
    try {
      const result = await syncOffline({ store: idbStore, listInProgress, loadBundle: fetchProjectBundle, downloadPdf })
      window.dispatchEvent(new Event(OFFLINE_EVENT))
      await warmServiceWorker(result.saved).catch(err => console.error('[offline] warm', err))
      return result
    } catch (err) {
      console.error('[offline] sync', err)
      return null
    } finally {
      running = null
    }
  })()
  return running
}
