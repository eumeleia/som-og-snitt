import { NextResponse } from 'next/server'
import { getOAuth2Client } from '@/lib/drive-helpers'
import { driveErrorResponse } from '../driveError'

// Kortlevd access-token til nettleseren, slik at PDF-en hentes rett fra Drive
// (files/{id}?alt=media) og aldri går gjennom en Vercel-funksjon med 4,5 MB-tak.
export async function GET() {
  try {
    const auth = await getOAuth2Client()
    const { token } = await auth.getAccessToken()
    if (!token) throw new Error('Kunne ikke hente access token')
    return NextResponse.json({ accessToken: token }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return driveErrorResponse(err, 'strikk-prototype/token')
  }
}
