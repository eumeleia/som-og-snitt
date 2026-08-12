'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { plassertPunkter } from './geometri'
import { effektivFargeRaa, effektivTradfarge, finnFargekjoring, type SekvensKontekst } from './sekvens'
import type { MinTrad } from './minTraadpalett'
import type { BroderiMotivData, PlassertMotiv, SekvensElement } from './types'

interface SimSubPath {
  cumStart: number
  punkter: [number, number][]
}

interface SimSegment {
  elId: string
  farge: string // snappet trådfarge — det maskinen faktisk syr, brukes til selve tegningen
  fargeNavn: string
  raaFarge: string // rå, kun til sammenligning/visning når den avviker fra farge
  motivNavn: string
  kjoringNummer: number
  stingFra: number
  stingTil: number
  subPaths: SimSubPath[]
}

function byggSegmenter(sekvens: SekvensElement[], ctx: SekvensKontekst): SimSegment[] {
  const segments: SimSegment[] = []
  let cumSting = 0
  let kjoringNummer = 0
  for (const el of sekvens) {
    if (el.type === 'pause') continue
    kjoringNummer++
    const funn = finnFargekjoring(ctx, el)
    if (!funn) continue
    const { pm, data, kjoring } = funn
    if (!data.bbox) continue
    const raaFarge = effektivFargeRaa(ctx, el) ?? kjoring.farge_hex
    const tradfarge = effektivTradfarge(ctx, el)
    const farge = tradfarge?.hex ?? raaFarge
    const subPaths: SimSubPath[] = []
    let segSting = cumSting
    for (let i = kjoring.fra_index; i <= kjoring.til_index; i++) {
      const blokk = data.stingblokker[i]
      if (!blokk || blokk.sting.length === 0) continue
      const abs = plassertPunkter(blokk.sting, data.bbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm)
      subPaths.push({ cumStart: segSting, punkter: abs })
      segSting += abs.length
    }
    if (subPaths.length === 0) continue
    segments.push({
      elId: el.id, farge, fargeNavn: tradfarge?.navn ?? '', raaFarge, motivNavn: pm.navn, kjoringNummer,
      stingFra: cumSting, stingTil: segSting, subPaths,
    })
    cumSting = segSting
  }
  return segments
}

const CANVAS_PX = 480
const STING_PER_SEK = 2000

export function StingSimulator({ sekvens, motiver, resolved, halv, pecTilEkte }: {
  sekvens: SekvensElement[]
  motiver: PlassertMotiv[]
  resolved: Record<string, BroderiMotivData>
  halv: number
  pecTilEkte?: Map<string, MinTrad>
}) {
  const ctx: SekvensKontekst = useMemo(() => ({ motiver, resolved, pecTilEkte }), [motiver, resolved, pecTilEkte])

  const segments = useMemo(() => byggSegmenter(sekvens, ctx), [sekvens, ctx])

  const totalSting = segments.length > 0 ? segments[segments.length - 1].stingTil : 0

  const [pos, setPos] = useState(0)
  const [spiller, setSpiller] = useState(false)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Animation loop
  useEffect(() => {
    if (!spiller) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      return
    }
    lastTimeRef.current = null
    function frame(t: number) {
      const dt = lastTimeRef.current ? (t - lastTimeRef.current) / 1000 : 0
      lastTimeRef.current = t
      setPos(p => {
        const neste = p + dt * STING_PER_SEK
        if (neste >= totalSting) { setSpiller(false); return totalSting }
        return neste
      })
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [spiller, totalSting])

  // Canvas draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const SCALE = CANVAS_PX / (halv * 20)
    const OX = CANVAS_PX / 2
    const OY = CANVAS_PX / 2
    const toCanvas = (x: number, y: number): [number, number] => [x * SCALE + OX, y * SCALE + OY]

    ctx2d.clearRect(0, 0, CANVAS_PX, CANVAS_PX)

    // Draw hoop border
    ctx2d.strokeStyle = '#C9A57A'
    ctx2d.lineWidth = 0.5
    ctx2d.setLineDash([4, 4])
    const hoopPx = 1000 * SCALE
    ctx2d.strokeRect(OX - hoopPx / 2, OY - hoopPx / 2, hoopPx, hoopPx)
    ctx2d.setLineDash([])

    const curPos = Math.floor(pos)

    for (const seg of segments) {
      if (seg.stingFra >= curPos) break
      ctx2d.strokeStyle = seg.farge
      ctx2d.lineWidth = 0.7
      ctx2d.lineJoin = 'round'
      ctx2d.lineCap = 'round'

      for (const sp of seg.subPaths) {
        if (sp.cumStart >= curPos) break
        const takePunks = sp.punkter.slice(0, Math.min(curPos - sp.cumStart, sp.punkter.length))
        if (takePunks.length < 2) continue
        ctx2d.beginPath()
        const [x0, y0] = toCanvas(takePunks[0][0], takePunks[0][1])
        ctx2d.moveTo(x0, y0)
        for (let i = 1; i < takePunks.length; i++) {
          const [cx, cy] = toCanvas(takePunks[i][0], takePunks[i][1])
          ctx2d.lineTo(cx, cy)
        }
        ctx2d.stroke()
      }
    }
  }, [pos, segments, halv])

  const curPos = Math.floor(pos)
  const currentSeg = segments.find(s => s.stingFra <= curPos && s.stingTil > curPos)
    ?? (curPos >= totalSting && segments.length > 0 ? segments[segments.length - 1] : null)

  if (segments.length === 0) {
    return (
      <p className="text-sm text-stone-400 italic text-center py-4">
        Venter på at motiver tolkes…
      </p>
    )
  }

  return (
    <div>
      <h3 className="font-serif text-lg text-stone-700 mb-3">Stingsimulator</h3>

      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => { if (pos >= totalSting) setPos(0); setSpiller(s => !s) }}
          className="px-3 py-1.5 rounded-lg bg-stone-800 text-white text-sm hover:bg-stone-700 transition-colors"
        >
          {spiller ? 'Stopp' : 'Spill'}
        </button>
        <button
          onClick={() => { setSpiller(false); setPos(0) }}
          className="px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 text-sm hover:bg-stone-50 transition-colors"
        >
          Til start
        </button>
        <span className="text-xs text-stone-500 ml-auto">{Math.floor(pos)} / {totalSting} sting</span>
      </div>

      <input
        type="range"
        min={0}
        max={totalSting}
        step={1}
        value={Math.floor(pos)}
        onChange={e => { setSpiller(false); setPos(+e.target.value) }}
        className="w-full accent-[#C9A57A] mb-2"
      />

      {currentSeg && (
        <div className="text-sm text-stone-700 mb-2">
          <p>
            Kjøring {currentSeg.kjoringNummer}
            <span
              className="inline-block w-4 h-4 rounded border border-stone-300 mx-1.5 align-middle"
              style={{ backgroundColor: currentSeg.farge }}
            />
            {currentSeg.farge}{currentSeg.fargeNavn ? ` · ${currentSeg.fargeNavn}` : ''} · {currentSeg.motivNavn}
          </p>
          {currentSeg.raaFarge !== currentSeg.farge && (
            <p className="text-xs text-stone-400">Kildefila har {currentSeg.raaFarge} — maskinen syr {currentSeg.farge}.</p>
          )}
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={CANVAS_PX}
        height={CANVAS_PX}
        className="w-full aspect-square rounded-xl bg-white border border-stone-100"
      />

      <div className="flex gap-1 overflow-x-auto pb-1 mt-2">
        {segments.map(seg => (
          <button
            key={seg.elId}
            title={`Kjøring ${seg.kjoringNummer} – ${seg.motivNavn}`}
            onClick={() => { setSpiller(false); setPos(seg.stingFra) }}
            className={`flex-shrink-0 w-5 h-5 rounded border-2 transition-transform ${
              currentSeg?.elId === seg.elId ? 'border-stone-600 scale-110' : 'border-stone-300'
            }`}
            style={{ backgroundColor: seg.farge }}
          />
        ))}
      </div>
    </div>
  )
}
