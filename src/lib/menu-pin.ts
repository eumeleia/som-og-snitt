import { supabase } from '@/lib/supabase'

// «Fest til meny»: one knitting and one sewing project as shortcuts at the top of the
// side menu. Stored in menu_pin (migration 027), one row per kind.

export type PinKind = 'strikk' | 'sy'
export const PIN_KINDS: readonly PinKind[] = ['strikk', 'sy']

export interface MenuPin { kind: PinKind; projectId: string; name: string }

export const PIN_EVENT = 'menu-pin-changed'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parsePinBody(body: unknown): { kind: PinKind; projectId: string | null } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Mangler data' }
  const { kind, project_id } = body as Record<string, unknown>
  if (!PIN_KINDS.includes(kind as PinKind)) return { error: 'Ukjent type' }
  if (project_id === null) return { kind: kind as PinKind, projectId: null }
  if (typeof project_id !== 'string' || !UUID.test(project_id)) return { error: 'Ugyldig prosjekt-id' }
  return { kind: kind as PinKind, projectId: project_id }
}

// Pins whose project still exists, with the name shown in the menu. Empty when the
// table does not exist yet (migration 027 not run) or the network is down.
export async function loadPins(): Promise<MenuPin[]> {
  const { data, error } = await supabase.from('menu_pin').select('kind, project_id')
  if (error || !data) return []
  const out: MenuPin[] = []
  for (const row of data as { kind: PinKind; project_id: string }[]) {
    if (row.kind === 'strikk') {
      const { data: p } = await supabase.from('strikk_project')
        .select('id, name, strikk_oppskrift(title)').eq('id', row.project_id).maybeSingle()
      if (!p) continue
      const recipe = (p as unknown as { strikk_oppskrift: { title: string | null } | null }).strikk_oppskrift
      out.push({ kind: 'strikk', projectId: p.id, name: p.name || recipe?.title || 'Uten navn' })
    } else {
      const { data: p } = await supabase.from('projects').select('id, data->>name').eq('id', row.project_id).maybeSingle()
      if (!p) continue
      out.push({ kind: 'sy', projectId: p.id, name: (p as { name: string | null }).name || 'Uten navn' })
    }
  }
  return out.sort((a, b) => PIN_KINDS.indexOf(a.kind) - PIN_KINDS.indexOf(b.kind))
}

export async function savePin(kind: PinKind, projectId: string | null): Promise<void> {
  const res = await fetch('/api/menu-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, project_id: projectId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `Feil ${res.status}`)
  }
  window.dispatchEvent(new Event(PIN_EVENT))
}

// The sewing projects page opens a project named in sessionStorage; this event tells an
// already-open page to look again.
export const OPEN_SY_PROJECT_EVENT = 'open-sy-project'
