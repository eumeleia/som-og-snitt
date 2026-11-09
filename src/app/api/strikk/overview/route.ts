import { NextRequest, NextResponse } from 'next/server'
import { writeOverview } from '@/lib/strikk-overview'
import { driveErrorResponse } from '../driveError'

export const maxDuration = 60

// Writes Strikkeoversikt.xlsx. Without force it only writes when the content has changed
// since the last time, so Strikk can call it every time it opens.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { force?: boolean }
    return NextResponse.json(await writeOverview(body.force === true))
  } catch (err) {
    return driveErrorResponse(err, 'strikk/overview')
  }
}
