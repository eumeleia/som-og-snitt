import { NextResponse } from 'next/server'
import { getStrikkConnection } from '@/lib/strikk-drive'

export async function GET() {
  try {
    const conn = await getStrikkConnection()
    return NextResponse.json(
      conn ? { connected: true, email: conn.email } : { connected: false },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
