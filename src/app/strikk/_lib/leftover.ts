// Whether a pattern's own text mentions leftover yarn. Pure, with no imports, so the app,
// the tests and scripts/strikk can all load it.

// Whole words only: «rester» counts, «resten» does not. A single «garnrest» is a strand
// for embroidery, not leftover yarn; «garnrester» counts.
const LEFTOVER = /(?<![\p{L}\p{N}])(restegarn\p{L}*|restgarn\p{L}*|garnrester|rester|leftovers?|left-overs?|scrap[ -]?yarns?|scraps)(?![\p{L}\p{N}])/iu

// The words around the first mention, or null when there is none.
export function findLeftoverMention(text: string): string | null {
  const m = LEFTOVER.exec(text)
  if (!m) return null
  const start = Math.max(0, m.index - 40)
  const end = Math.min(text.length, m.index + m[0].length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

// Too little text to search: a scanned page without a text layer.
export function hasSearchableText(text: string): boolean {
  return (text.match(/\p{L}/gu) ?? []).length >= 200
}
