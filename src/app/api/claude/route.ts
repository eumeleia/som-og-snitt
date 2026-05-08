import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { prompt, pdfBase64 } = await req.json()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = []

    if (pdfBase64) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
      })
    }

    content.push({ type: 'text', text: prompt })

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    })

    const result = (msg.content[0] as Anthropic.TextBlock).text
    return NextResponse.json({ result })
  } catch (err) {
    console.error('Claude error:', err)
    return NextResponse.json({ error: 'AI-feil' }, { status: 500 })
  }
}
