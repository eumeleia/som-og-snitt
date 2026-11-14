import { describe, it, expect } from 'vitest'
import { offlineReady, planSync, syncOffline, type ProjectBundle, type Store, type StoredBundle, type StoredPdf } from './offline'
import { applyOps, type Op } from './markup-ops'
import { signedInOrOffline } from '@/lib/offline-auth'
import type { Project } from './projects'

function memoryStore(): Store & { bundles: Map<string, StoredBundle>; pdfs: Map<string, StoredPdf> } {
  const bundles = new Map<string, StoredBundle>()
  const pdfs = new Map<string, StoredPdf>()
  return {
    bundles, pdfs,
    getBundle: async id => bundles.get(id) ?? null,
    putBundle: async b => { bundles.set(b.projectId, b) },
    deleteBundle: async id => { bundles.delete(id) },
    listBundles: async () => [...bundles.values()],
    getPdf: async id => pdfs.get(id) ?? null,
    putPdf: async p => { pdfs.set(p.fileId, p) },
    deletePdf: async id => { pdfs.delete(id) },
    listPdfIds: async () => [...pdfs.keys()],
  }
}

const project = (id: string, status: Project['status'] = 'in_progress'): Project => ({
  id, name: id, oppskrift_id: `r-${id}`, size_index: null, size_label: null, needles: null, status, start_date: null,
  end_date: null, notes: null, sort_order: 0, strokes: [], counters: [], version: 1, created_at: '', updated_at: '',
  last_page: null, last_offset: null, current_page: null, cover_path: null, cover_at: null, last_opened_at: null, strikk_project_yarn: [],
})
const bundle = (id: string, fileId: string | null = `f-${id}`, status: Project['status'] = 'in_progress'): ProjectBundle => ({
  project: project(id, status),
  recipe: fileId ? { title: id, drive_file_id: fileId, file_name: `${id}.pdf`, thumbnail_path: null, thumbnail_at: null } : null,
  stored: null, yarns: [], combos: [], swatches: [],
})

function deps(store: Store, inProgress: string[], bundles: Record<string, ProjectBundle | Error>, downloads: string[] = []) {
  return {
    store,
    listInProgress: async () => inProgress,
    loadBundle: async (id: string) => { const b = bundles[id]; if (b instanceof Error) throw b; return b },
    downloadPdf: async (fileId: string) => { downloads.push(fileId); return new Uint8Array([1, 2, 3]) },
    now: () => '2026-11-14T12:00:00.000Z',
  }
}

describe('planSync', () => {
  it('removes what is no longer in progress and fetches missing PDFs', () => {
    expect(planSync(['a'], [{ projectId: 'a', fileId: 'fa' }, { projectId: 'b', fileId: 'fb' }], ['fb'], ['fa']))
      .toEqual({ removeBundles: ['b'], removePdfs: ['fb'], missingPdfs: ['fa'] })
  })
})

describe('syncOffline', () => {
  it('stores every project in progress with its PDF', async () => {
    const store = memoryStore()
    const downloads: string[] = []
    const res = await syncOffline(deps(store, ['a', 'b'], { a: bundle('a'), b: bundle('b') }, downloads))
    expect(res.saved).toEqual(['a', 'b'])
    expect([...store.bundles.keys()]).toEqual(['a', 'b'])
    expect(downloads).toEqual(['f-a', 'f-b'])
    expect(await offlineReady(store)).toEqual(new Set(['a', 'b']))
  })

  it('downloads a PDF only once, and removes a project and its PDF when it is no longer in progress', async () => {
    const store = memoryStore()
    await syncOffline(deps(store, ['a', 'b'], { a: bundle('a'), b: bundle('b') }))
    const downloads: string[] = []
    const res = await syncOffline(deps(store, ['a'], { a: bundle('a') }, downloads))
    expect(downloads).toEqual([])
    expect(res.removed).toEqual(['b'])
    expect([...store.bundles.keys()]).toEqual(['a'])
    expect([...store.pdfs.keys()]).toEqual(['f-a'])
  })

  it('keeps the earlier copy, and its PDF, when a project fails to load', async () => {
    const store = memoryStore()
    await syncOffline(deps(store, ['a'], { a: bundle('a') }))
    const res = await syncOffline(deps(store, ['a'], { a: new Error('network') }))
    expect(res.failed).toEqual(['a'])
    expect(store.bundles.has('a')).toBe(true)
    expect(store.pdfs.has('f-a')).toBe(true)
  })

  it('shares one PDF between two projects from the same recipe', async () => {
    const store = memoryStore()
    const downloads: string[] = []
    await syncOffline(deps(store, ['a', 'b'], { a: bundle('a', 'same'), b: bundle('b', 'same') }, downloads))
    expect(downloads).toEqual(['same'])
    await syncOffline(deps(store, ['b'], { b: bundle('b', 'same') }))
    expect(store.pdfs.has('same')).toBe(true)
  })

  it('does not count a project without a PDF as ready', async () => {
    const store = memoryStore()
    await syncOffline(deps(store, ['a'], { a: bundle('a', null) }))
    expect(await offlineReady(store)).toEqual(new Set())
  })
})

describe('changes made without a network', () => {
  it('show again on top of the stored project, and are sent as they are', () => {
    const saved = { strokes: [], counters: [{ id: 'c', name: 'Rad', total: null, value: 3 }] }
    const pending: Op[] = [
      { type: 'stroke_add', stroke: { id: 's1', page: 1, tool: 'pen', color: '#000', width: 0.003, points: [0.1, 0.1, 0.2, 0.2] } },
      { type: 'counter_step', id: 'c', delta: 1, opId: 'o1' },
    ]
    const shown = applyOps(saved, pending)
    expect(shown.strokes.map(s => s.id)).toEqual(['s1'])
    expect(shown.counters[0].value).toBe(4)
    // The server applies the same ops when the network is back; applying them twice changes nothing.
    expect(applyOps(shown, pending)).toEqual(shown)
  })
})

describe('signedInOrOffline', () => {
  it('lets a stored login through when it cannot be renewed without a network', () => {
    expect(signedInOrOffline(null, { name: 'AuthRetryableFetchError' } as never)).toBe(true)
    expect(signedInOrOffline(null, null)).toBe(false)
    expect(signedInOrOffline(null, { name: 'AuthApiError' } as never)).toBe(false)
    expect(signedInOrOffline({} as never, null)).toBe(true)
  })
})
