// What PATCH /api/strikk/oppskrifter/[id] may change. Pure, so the rules are tested
// without a database.
import { AUDIENCES, type Audience } from './extraction'

export interface RecipePatch {
  title?: string
  designer?: string | null
  audience?: Audience | null
  rating?: number | null
  favorite?: boolean
  last_page?: number
  last_offset?: number
  updated_at?: string
}

// Only title, designer and audience count as editing the recipe (updated_at, and a new
// Drive name for title and designer). Stars, favourite and reading position do not.
export function parseRecipePatch(body: unknown, now = new Date()): { patch: RecipePatch; rename: boolean } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Ugyldig forespørsel' }
  const b = body as Record<string, unknown>
  const patch: RecipePatch = {}
  if (b.title !== undefined) {
    const title = typeof b.title === 'string' ? b.title.trim() : ''
    if (!title) return { error: 'Tittel kan ikke være tom' }
    patch.title = title
  }
  if (b.designer !== undefined) {
    const designer = typeof b.designer === 'string' ? b.designer.trim() : ''
    patch.designer = designer || null
  }
  if (b.audience !== undefined) {
    if (b.audience !== null && !(AUDIENCES as readonly unknown[]).includes(b.audience)) return { error: 'Ukjent målgruppe' }
    patch.audience = b.audience as Audience | null
  }
  if (b.rating !== undefined) {
    if (b.rating !== null && !(Number.isInteger(b.rating) && (b.rating as number) >= 1 && (b.rating as number) <= 5)) {
      return { error: 'Stjerner må være 1–5' }
    }
    patch.rating = b.rating as number | null
  }
  if (b.favorite !== undefined) {
    if (typeof b.favorite !== 'boolean') return { error: 'Favoritt må være ja eller nei' }
    patch.favorite = b.favorite
  }
  if (b.last_page !== undefined || b.last_offset !== undefined) {
    const page = b.last_page, offset = b.last_offset
    if (!Number.isInteger(page) || (page as number) < 1 || typeof offset !== 'number' || !Number.isFinite(offset)) {
      return { error: 'Ugyldig posisjon' }
    }
    patch.last_page = page as number
    patch.last_offset = Math.min(1, Math.max(0, Math.round(offset * 1000) / 1000))
  }
  if (Object.keys(patch).length === 0) return { error: 'Ingenting å endre' }
  const edits = patch.title !== undefined || patch.designer !== undefined || patch.audience !== undefined
  if (edits) patch.updated_at = now.toISOString()
  return { patch, rename: patch.title !== undefined || patch.designer !== undefined }
}
