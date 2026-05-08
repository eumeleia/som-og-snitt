import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    // Strip tags and condense whitespace, cap at 8000 chars for Claude
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)

    return NextResponse.json({ content: text })
  } catch (err) {
    console.error('fetch-url error:', err)
    return NextResponse.json({ error: 'Kunne ikke hente siden' }, { status: 500 })
  }
}
