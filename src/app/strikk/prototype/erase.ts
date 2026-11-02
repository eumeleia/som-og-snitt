import type { Stroke } from './ops'

// Parts shorter than this (page-width units) are dropped, so an erased stroke does not
// leave specks behind.
const MIN_PART_LENGTH = 0.001

type Pt = [number, number]

function round(v: number) {
  return Math.round(v * 1e5) / 1e5
}

function length(pts: Pt[]) {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return l
}

/**
 * Removes the part of a stroke's centre line that lies inside a circle. Coordinates are in
 * page-width units on both axes (y already multiplied by the page aspect), so the circle is
 * round on the page. The stroke's half width is added to the radius, so touching the edge
 * of the ink is enough.
 *
 * Returns null when the circle misses the stroke, otherwise the remaining parts (possibly
 * none) as new strokes with fresh ids.
 */
export function eraseCircle(
  stroke: Stroke,
  cx: number,
  cy: number,
  radius: number,
  aspect: number,
): Stroke[] | null {
  const r = radius + stroke.width / 2
  const pts: Pt[] = []
  for (let i = 0; i + 1 < stroke.points.length; i += 2) pts.push([stroke.points[i], stroke.points[i + 1] * aspect])
  if (pts.length === 0) return null

  const inside = (p: Pt) => Math.hypot(p[0] - cx, p[1] - cy) < r

  if (pts.length === 1) return inside(pts[0]) ? [] : null

  const parts: Pt[][] = []
  let cur: Pt[] = inside(pts[0]) ? [] : [pts[0]]
  let changed = cur.length === 0

  const finish = () => {
    if (cur.length >= 2 && length(cur) >= MIN_PART_LENGTH) parts.push(cur)
    cur = []
  }

  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const qa = dx * dx + dy * dy
    const qb = 2 * (dx * (a[0] - cx) + dy * (a[1] - cy))
    const qc = (a[0] - cx) ** 2 + (a[1] - cy) ** 2 - r * r
    const disc = qb * qb - 4 * qa * qc

    let lo = 1
    let hi = 0
    if (qa > 0 && disc > 0) {
      const sq = Math.sqrt(disc)
      lo = Math.max((-qb - sq) / (2 * qa), 0)
      hi = Math.min((-qb + sq) / (2 * qa), 1)
    }

    if (lo >= hi) {
      // Segment misses the circle; b is outside unless the segment has zero length.
      if (qa === 0 && inside(b)) { finish(); continue }
      if (cur.length === 0) cur.push(a)
      cur.push(b)
      continue
    }

    changed = true
    if (lo > 0) {
      cur.push([a[0] + lo * dx, a[1] + lo * dy])
    }
    finish()
    if (hi < 1) cur = [[a[0] + hi * dx, a[1] + hi * dy], b]
  }
  finish()

  if (!changed) return null
  return parts.map(part => ({
    ...stroke,
    id: crypto.randomUUID(),
    points: part.flatMap(([x, y]) => [round(x), round(y / aspect)]),
  }))
}
