// Offline for pågående strikkeprosjekter: prosjektet, oppskriften, garnet og PDF-en lagres
// på enheten mens appen er på nett, og brukes derfra bare når nettet mangler. Lagret data
// for et prosjekt som ikke lenger er pågående, slettes ved neste synk.
//
// Store is an interface so the sync can be tested with an in-memory store; the app uses
// IndexedDB (idbStore below).
import type { Project } from './projects'
import type { StoredRecipe } from './extraction'
import type { YarnRow } from './yarns'
import type { ComboRow, SwatchRow } from './combos'

export interface RecipeInfo {
  title: string | null
  drive_file_id: string
  file_name: string
  thumbnail_path: string | null
  thumbnail_at: string | null
}

// Everything ProjectView reads from the database for one project.
export interface ProjectBundle {
  project: Project
  recipe: RecipeInfo | null
  stored: StoredRecipe | null
  yarns: YarnRow[]
  combos: ComboRow[]
  swatches: SwatchRow[]
}

export interface StoredBundle extends ProjectBundle { projectId: string; savedAt: string }
export interface StoredPdf { fileId: string; bytes: ArrayBuffer; savedAt: string }

export interface Store {
  getBundle(projectId: string): Promise<StoredBundle | null>
  putBundle(b: StoredBundle): Promise<void>
  deleteBundle(projectId: string): Promise<void>
  listBundles(): Promise<StoredBundle[]>
  getPdf(fileId: string): Promise<StoredPdf | null>
  putPdf(p: StoredPdf): Promise<void>
  deletePdf(fileId: string): Promise<void>
  listPdfIds(): Promise<string[]>
}

export const fileIdOf = (b: ProjectBundle) => b.recipe?.drive_file_id ?? null

// What a sync should do, from the projects in progress now and what is stored.
export function planSync(inProgressIds: string[], storedBundles: { projectId: string; fileId: string | null }[], storedPdfIds: string[], keptFileIds: string[]) {
  const keep = new Set(inProgressIds)
  const removeBundles = storedBundles.filter(b => !keep.has(b.projectId)).map(b => b.projectId)
  const used = new Set(keptFileIds)
  const removePdfs = storedPdfIds.filter(id => !used.has(id))
  const missingPdfs = [...used].filter(id => !storedPdfIds.includes(id))
  return { removeBundles, removePdfs, missingPdfs }
}

export interface SyncDeps {
  store: Store
  // Ids of the projects in progress, from the database.
  listInProgress(): Promise<string[]>
  loadBundle(projectId: string): Promise<ProjectBundle>
  downloadPdf(fileId: string, fileName: string): Promise<Uint8Array>
  now?: () => string
}

export interface SyncResult { saved: string[]; removed: string[]; pdfs: string[]; failed: string[] }

// Stores every project in progress with its PDF, and removes what is no longer in
// progress. A project that fails to load keeps its earlier copy.
export async function syncOffline(deps: SyncDeps): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date().toISOString())
  const ids = await deps.listInProgress()
  const result: SyncResult = { saved: [], removed: [], pdfs: [], failed: [] }
  const files = new Map<string, string>()
  for (const id of ids) {
    try {
      const b = await deps.loadBundle(id)
      if (b.project.status !== 'in_progress') continue
      await deps.store.putBundle({ ...b, projectId: id, savedAt: now() })
      result.saved.push(id)
      if (b.recipe) files.set(b.recipe.drive_file_id, b.recipe.file_name)
    } catch {
      result.failed.push(id)
      const old = await deps.store.getBundle(id)
      if (old?.recipe) files.set(old.recipe.drive_file_id, old.recipe.file_name)
    }
  }
  const stored = await deps.store.listBundles()
  const plan = planSync(ids, stored.map(b => ({ projectId: b.projectId, fileId: fileIdOf(b) })), await deps.store.listPdfIds(), [...files.keys()])
  for (const id of plan.removeBundles) { await deps.store.deleteBundle(id); result.removed.push(id) }
  for (const id of plan.removePdfs) await deps.store.deletePdf(id)
  for (const fileId of plan.missingPdfs) {
    try {
      const bytes = await deps.downloadPdf(fileId, files.get(fileId)!)
      await deps.store.putPdf({ fileId, bytes: bytes.slice().buffer as ArrayBuffer, savedAt: now() })
      result.pdfs.push(fileId)
    } catch { /* tried again at the next sync */ }
  }
  return result
}

// Projects ready to open without a network: stored with their PDF.
export async function offlineReady(store: Store): Promise<Set<string>> {
  const [bundles, pdfs] = await Promise.all([store.listBundles(), store.listPdfIds()])
  const have = new Set(pdfs)
  return new Set(bundles.filter(b => { const f = fileIdOf(b); return f !== null && have.has(f) }).map(b => b.projectId))
}

// ── IndexedDB ───────────────────────────────────────────────────────────────────────

const DB_NAME = 'strikk-offline'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('bundles')) db.createObjectStore('bundles', { keyPath: 'projectId' })
      if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'fileId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })
  return dbPromise
}

function run<T>(storeName: 'bundles' | 'pdfs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    tx.oncomplete = () => resolve(req.result as T)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

export const idbStore: Store = {
  getBundle: id => run<StoredBundle | undefined>('bundles', 'readonly', s => s.get(id)).then(b => b ?? null),
  putBundle: b => run('bundles', 'readwrite', s => s.put(b)).then(() => undefined),
  deleteBundle: id => run('bundles', 'readwrite', s => s.delete(id)).then(() => undefined),
  listBundles: () => run<StoredBundle[]>('bundles', 'readonly', s => s.getAll()),
  getPdf: id => run<StoredPdf | undefined>('pdfs', 'readonly', s => s.get(id)).then(p => p ?? null),
  putPdf: p => run('pdfs', 'readwrite', s => s.put(p)).then(() => undefined),
  deletePdf: id => run('pdfs', 'readwrite', s => s.delete(id)).then(() => undefined),
  listPdfIds: () => run<IDBValidKey[]>('pdfs', 'readonly', s => s.getAllKeys()).then(keys => keys.map(String)),
}

export const hasIndexedDb = () => typeof indexedDB !== 'undefined'
