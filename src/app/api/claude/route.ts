import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { prompt, pdfText } = await req.json()

    const fullPrompt = pdfText
      ? `PDF-innhold:\n${pdfText}\n\n${prompt}`
      : prompt

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: fullPrompt }],
    })

    const result = (msg.content[0] as Anthropic.TextBlock).text
    return NextResponse.json({ result })
  } catch (err) {
    console.error('Claude error:', err)
    const message = err instanceof Error ? err.message : 'AI-feil'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
