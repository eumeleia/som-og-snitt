import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()

    let fetchUrl = url
    const driveMatch = (url as string).match(/\/file\/d\/([^/?]+)/)
    if (driveMatch) {
      fetchUrl = `https://drive.google.com/uc?id=${driveMatch[1]}&export=download`
    }

    const res = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const buf = await res.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')

    return NextResponse.json({ data: base64 })
  } catch (err) {
    console.error('fetch-pdf error:', err)
    return NextResponse.json({ error: 'Kunne ikke hente PDF' }, { status: 500 })
  }
}
