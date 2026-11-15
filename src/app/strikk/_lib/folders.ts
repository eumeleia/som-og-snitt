// Folders and the wish list in Strikk › Oppskrifter (migration 031). The folders per garment
// type and audience, and Favoritter, are worked out from the recipes; only Maria's own
// folders are stored. Pure, so it is tested without a database.
import type { Audience } from './extraction'
import { AUDIENCE_LABEL } from './recipe-filter'

export interface Folder { id: string; name: string; created_at: string }
export interface FolderLink { folder_id: string; oppskrift_id: string }
export interface Wish {
  id: string
  oppskrift_id: string | null
  title: string | null
  designer: string | null
  url: string | null
  price_nok: number | null
  note: string | null
  image_path: string | null
  image_at: string | null
  created_at: string
}

export const WISH_SELECT = 'id, oppskrift_id, title, designer, url, price_nok, note, image_path, image_at, created_at'
export const WISH_BUCKET = 'strikk-wishes'
export const MIGRATION_031 = 'Egne mapper og ønskelista krever migrasjon 031. Kjør den i Supabase først.'

// 'all', 'fav', 'wish', 'g:<garment type>', 'a:<audience>' or 'f:<own folder id>'.
export type FolderKey = string

export interface FolderRecipe { id: string; garment_type: string | null; audience: Audience | null; favorite: boolean }
export interface AutoFolder { key: FolderKey; label: string; count: number }

const nb = (a: string, b: string) => a.localeCompare(b, 'nb', { sensitivity: 'base' })
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function autoFolders(recipes: FolderRecipe[]): { favorites: number; garments: AutoFolder[]; audiences: AutoFolder[] } {
  const garments = new Map<string, number>()
  const audiences = new Map<Audience, number>()
  for (const r of recipes) {
    const g = r.garment_type?.trim().toLowerCase()
    if (g) garments.set(g, (garments.get(g) ?? 0) + 1)
    if (r.audience) audiences.set(r.audience, (audiences.get(r.audience) ?? 0) + 1)
  }
  return {
    favorites: recipes.filter(r => r.favorite).length,
    garments: [...garments].sort(([a], [b]) => nb(a, b)).map(([g, count]) => ({ key: `g:${g}`, label: capital(g), count })),
    audiences: [...audiences].sort(([a], [b]) => nb(AUDIENCE_LABEL[a], AUDIENCE_LABEL[b]))
      .map(([a, count]) => ({ key: `a:${a}`, label: AUDIENCE_LABEL[a], count })),
  }
}

export function membership(links: FolderLink[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const l of links) {
    if (!out.has(l.folder_id)) out.set(l.folder_id, new Set())
    out.get(l.folder_id)!.add(l.oppskrift_id)
  }
  return out
}

export function inFolder(key: FolderKey, r: FolderRecipe, members: Map<string, Set<string>>): boolean {
  if (key === 'all' || key === 'wish') return true
  if (key === 'fav') return r.favorite
  if (key.startsWith('g:')) return r.garment_type?.trim().toLowerCase() === key.slice(2)
  if (key.startsWith('a:')) return r.audience === key.slice(2)
  if (key.startsWith('f:')) return members.get(key.slice(2))?.has(r.id) ?? false
  return true
}

export function folderLabel(key: FolderKey, folders: Folder[]): string {
  if (key === 'all') return 'Alle'
  if (key === 'fav') return 'Favoritter'
  if (key === 'wish') return 'Ønskeliste'
  if (key.startsWith('g:')) return capital(key.slice(2))
  if (key.startsWith('a:')) return AUDIENCE_LABEL[key.slice(2) as Audience] ?? key.slice(2)
  if (key.startsWith('f:')) return folders.find(f => f.id === key.slice(2))?.name ?? 'Mappe'
  return key
}

export function cleanFolderName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const name = input.replace(/\s+/g, ' ').trim()
  return name.length > 0 && name.length <= 60 ? name : null
}

export interface WishInput {
  oppskrift_id: string | null
  title: string | null
  designer: string | null
  url: string | null
  price_nok: number | null
  note: string | null
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

// Validates a wish from the form or the API. A wish from the library needs only its recipe;
// one Maria does not have needs a name. The link must be a web address; «ca. 250» is 250.
export function parseWish(body: unknown, partial = false): { ok: true; value: Partial<WishInput> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Ugyldige data' }
  const b = body as Record<string, unknown>
  const out: Partial<WishInput> = {}
  if ('oppskrift_id' in b) {
    if (b.oppskrift_id !== null && (typeof b.oppskrift_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.oppskrift_id))) return { ok: false, error: 'Ukjent oppskrift' }
    out.oppskrift_id = b.oppskrift_id as string | null
  }
  if ('title' in b) out.title = text(b.title, 200)
  if ('designer' in b) out.designer = text(b.designer, 200)
  if ('note' in b) out.note = text(b.note, 2000)
  if ('url' in b) {
    const u = text(b.url, 2000)
    if (u) {
      const withScheme = /^https?:\/\//i.test(u) ? u : `https://${u}`
      try { new URL(withScheme) } catch { return { ok: false, error: 'Lenken er ikke en nettadresse' } }
      if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(withScheme)) return { ok: false, error: 'Lenken er ikke en nettadresse' }
      out.url = withScheme
    } else out.url = null
  }
  if ('price_nok' in b) {
    const raw = b.price_nok
    if (raw === null || raw === '') out.price_nok = null
    else {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/ca\.?/i, '').replace(/kr/i, '').replace(',', '.').trim())
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Prisen må være et tall' }
      out.price_nok = Math.round(n * 100) / 100
    }
  }
  if (!partial && !out.oppskrift_id && !out.title) return { ok: false, error: 'Skriv navnet på oppskriften' }
  return { ok: true, value: out }
}

export function wishImageUrl(w: Pick<Wish, 'image_path' | 'image_at'>, base = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!w.image_path || !base) return null
  const v = w.image_at ? `?v=${Date.parse(w.image_at)}` : ''
  return `${base}/storage/v1/object/public/${WISH_BUCKET}/${encodeURIComponent(w.image_path)}${v}`
}

export const formatPrice = (n: number | null) => (n === null ? null : `ca. ${n.toLocaleString('nb-NO')} kr`)
