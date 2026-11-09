import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hasPlastic, normalizeYarn } from '@/app/strikk/_lib/yarns'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Saves a corrected yarn from the catalogue. `approve: true` also approves it, after which
// the lookup script leaves it alone. Spellings, status and links are not changed here.
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/strikk/yarns/[id]'>) {
  try {
    const { id } = await ctx.params
    const { data, approve } = await req.json() as { data?: unknown; approve?: boolean }
    const y = normalizeYarn(data)
    if (!y.name) return NextResponse.json({ error: 'Garnet må ha et navn' }, { status: 400 })
    const now = new Date().toISOString()
    const { data: row, error } = await supabaseAdmin.from('strikk_yarn')
      .update({
        ...y,
        has_plastic: hasPlastic(y.fibers),
        updated_at: now,
        // Approving means the uncertain fields have been checked; what is missing still shows.
        ...(approve === true ? { status: 'approved', approved_at: now, uncertain_fields: [], uncertain_reasons: {} } : {}),
      })
      .eq('id', id).select('id').maybeSingle()
    if (error) {
      const taken = error.code === '23505'
      return NextResponse.json({ error: taken ? 'Et annet garn har allerede denne produsenten og navnet' : error.message }, { status: taken ? 409 : 500 })
    }
    if (!row) return NextResponse.json({ error: 'Fant ikke garnet' }, { status: 404 })
    return NextResponse.json({ status: approve === true ? 'approved' : 'saved' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
