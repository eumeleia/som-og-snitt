'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FargePicker } from './FargePicker'
import {
  finnFargekjoring, effektivFarge, tellOmtredninger, flyttElementEtter,
  finnSammenslaingsforslag, sjekkFasesortering, fasesorter, nyPause,
  plassertFargekjoringRaster, type SekvensKontekst, type SammenslaingForslag,
} from './sekvens'
import { plassertPunkter } from './geometri'
import type { BroderiMotivData, PlassertMotiv, SekvensElement, SekvensKjoring } from './types'

export function SekvensPanel({
  sekvens, onChange, motiver, resolved,
  fokusKjoringId, setFokusKjoringId, onHoverEndret,
}: {
  sekvens: SekvensElement[]
  onChange: (ny: SekvensElement[]) => void
  motiver: PlassertMotiv[]
  resolved: Record<string, BroderiMotivData>
  fokusKjoringId: string | null
  setFokusKjoringId: (id: string | null) => void
  onHoverEndret: (id: string | null) => void
}) {
  const [fargePickerForId, setFargePickerForId] = useState<string | null>(null)
  const [forhåndsvisForslag, setForhåndsvisForslag] = useState<SammenslaingForslag | null>(null)

  const ctx: SekvensKontekst = useMemo(() => ({ motiver, resolved }), [motiver, resolved])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rasterCache = useMemo(() => new Map<string, Set<string> | null>(), [motiver, resolved])

  const omtredninger = useMemo(() => tellOmtredninger(sekvens, ctx), [sekvens, ctx])
  const { forslag, flereEnnVist } = useMemo(
    () => finnSammenslaingsforslag(sekvens, ctx, rasterCache),
    [sekvens, ctx, rasterCache],
  )
  const faseStatus = useMemo(() => sjekkFasesortering(ctx), [ctx])

  const kjoringsNummer = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const el of sekvens) {
      if (el.type === 'kjoring') { n++; map.set(el.id, n) }
    }
    return map
  }, [sekvens])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
  )

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sekvens.findIndex(el => el.id === active.id)
    const newIndex = sekvens.findIndex(el => el.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onChange(arrayMove(sekvens, oldIndex, newIndex))
  }

  function settFarge(elId: string, hex: string) {
    onChange(sekvens.map(el => el.id === elId && el.type === 'kjoring' ? { ...el, fargeOverrideHex: hex } : el))
  }

  function nullstillFarge(elId: string) {
    onChange(sekvens.map(el => {
      if (el.id !== elId || el.type !== 'kjoring') return el
      return {
        id: el.id, type: el.type, plassertMotivId: el.plassertMotivId, fargekjoringIndex: el.fargekjoringIndex,
      } satisfies SekvensKjoring
    }))
  }

  function leggPauseEtter(elId: string) {
    const idx = sekvens.findIndex(el => el.id === elId)
    if (idx === -1) return
    const ny = [...sekvens]
    ny.splice(idx + 1, 0, nyPause())
    onChange(ny)
  }

  function slettElement(elId: string) {
    onChange(sekvens.filter(el => el.id !== elId))
  }

  const fargePickerEl = fargePickerForId
    ? (sekvens.find(el => el.id === fargePickerForId) as SekvensKjoring | undefined)
    : undefined
  const fargePickerFunn = fargePickerEl ? finnFargekjoring(ctx, fargePickerEl) : undefined

  const tryggForslag = forslag.filter(f => !f.endrerLagrekkefolge)
  const risikableForslag = forslag.filter(f => f.endrerLagrekkefolge)
  const alleRisikable = tryggForslag.length === 0 && risikableForslag.length > 0

  function ForslagKort({ f }: { f: SammenslaingForslag }) {
    const iEl = sekvens.find(el => el.id === f.iId) as SekvensKjoring | undefined
    const jEl = sekvens.find(el => el.id === f.jId) as SekvensKjoring | undefined
    const iFunn = iEl ? finnFargekjoring(ctx, iEl) : undefined
    const jFunn = jEl ? finnFargekjoring(ctx, jEl) : undefined
    const iNr = kjoringsNummer.get(f.iId) ?? '?'
    const jNr = kjoringsNummer.get(f.jId) ?? '?'
    const iMotivNavn = iFunn?.pm.navn ?? ''
    const jMotivNavn = jFunn?.pm.navn ?? ''

    const mellomInfoList = f.mellomKjoringIder.map(mid => {
      const el = sekvens.find(e => e.id === mid) as SekvensKjoring | undefined
      if (!el) return null
      const funn = finnFargekjoring(ctx, el)
      return {
        nr: kjoringsNummer.get(mid) ?? '?',
        farge: effektivFarge(ctx, el) ?? funn?.kjoring.farge_hex,
        navn: funn?.pm.navn,
      }
    }).filter((x): x is { nr: number | string; farge: string | undefined; navn: string | undefined } => x !== null)

    return (
      <div className="p-3 rounded-xl border text-sm border-stone-200 bg-white">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="text-stone-700">
              <span className="font-medium">Kjøring {iNr}</span>
              <span className="inline-block w-3.5 h-3.5 rounded border border-stone-300 mx-1 align-middle" style={{ backgroundColor: f.farge }} />
              {iMotivNavn !== jMotivNavn ? iMotivNavn : ''}
              {' + '}
              <span className="font-medium">Kjøring {jNr}</span>
              {iMotivNavn !== jMotivNavn ? ` · ${jMotivNavn}` : ''}
            </p>
            <p className="text-xs text-stone-500 mt-0.5">Sparer {f.sparteOmtredninger} omtredning{f.sparteOmtredninger === 1 ? '' : 'er'}</p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => setForhåndsvisForslag(f)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Forhåndsvis
            </button>
            <button
              onClick={() => onChange(flyttElementEtter(sekvens, f.jId, f.iId))}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition-colors"
            >
              Slå sammen
            </button>
          </div>
        </div>

        {mellomInfoList.length > 0 && (
          <p className="text-xs text-stone-500 mb-1.5">
            Flytter forbi:{' '}
            {mellomInfoList.map(m => (
              <span key={String(m.nr)} className="inline-flex items-center gap-0.5 mr-1">
                <span className="inline-block w-3 h-3 rounded border border-stone-300 flex-shrink-0" style={{ backgroundColor: m.farge }} />
                kjøring {m.nr}
                {m.navn ? ` (${m.navn})` : ''}
              </span>
            ))}
          </p>
        )}

        {f.endrerLagrekkefolge && (
          <p className="text-xs text-amber-800 flex items-center gap-1 flex-wrap">
            <span>⚠ Legger</span>
            {f.overlappendeFarger.map(h => (
              <span key={h} className="inline-block w-3 h-3 rounded-sm border border-stone-300 flex-shrink-0" style={{ backgroundColor: h }} />
            ))}
            <span>over</span>
            <span className="inline-block w-3 h-3 rounded-sm border border-stone-300 flex-shrink-0" style={{ backgroundColor: f.farge }} />
            <span>i stedet for under — kontur kan ende opp under fyllet.</span>
          </p>
        )}
      </div>
    )
  }

  let lopenummer = 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-600">
          <span className="font-medium text-stone-800">{omtredninger}</span> omtredning{omtredninger === 1 ? '' : 'er'}
        </p>
        <div className="text-right">
          <button
            disabled={!faseStatus.kan}
            title={faseStatus.kan ? 'Bygg om rekkefølgen: kjøring 1 fra alle motiver, så kjøring 2 fra alle, osv.' : faseStatus.grunn}
            onClick={() => onChange(fasesorter(sekvens, ctx))}
            className={`h-9 px-3 rounded-xl border text-sm transition-colors ${
              faseStatus.kan
                ? 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                : 'bg-stone-50 text-stone-300 border-stone-100 cursor-not-allowed'
            }`}
          >
            Fasesorter
          </button>
          {!faseStatus.kan && <p className="text-[10px] text-stone-400 mt-1 max-w-[220px]">{faseStatus.grunn}</p>}
        </div>
      </div>

      {forslag.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-stone-400 uppercase tracking-wide">Forslag til sammenslåing</p>
          {alleRisikable && (
            <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 mb-2">
              ⚠ Motivet er lagdelt — alle sammenslåingsforslag endrer rekkefølgen som fargene sys i.
            </div>
          )}
          {tryggForslag.map(f => <ForslagKort key={`${f.iId}-${f.jId}`} f={f} />)}
          {risikableForslag.length > 0 && (
            <details className="mt-1">
              <summary className="text-xs text-stone-400 cursor-pointer mb-2">
                {risikableForslag.length} forslag endrer lagrekkefølgen (klikk for å se)
              </summary>
              {risikableForslag.map(f => <ForslagKort key={`${f.iId}-${f.jId}`} f={f} />)}
            </details>
          )}
          {flereEnnVist > 0 && <p className="text-xs text-stone-400">+ {flereEnnVist} flere forslag ikke vist</p>}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sekvens.map(el => el.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-stone-100 bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            {sekvens.map(el => {
              if (el.type === 'pause') {
                return <PauseRad key={el.id} el={el} onSlett={() => slettElement(el.id)} />
              }
              lopenummer++
              return (
                <KjoringRad
                  key={el.id}
                  el={el}
                  nummer={lopenummer}
                  ctx={ctx}
                  fokusert={fokusKjoringId === el.id}
                  onClick={() => setFokusKjoringId(fokusKjoringId === el.id ? null : el.id)}
                  onMouseEnter={() => onHoverEndret(el.id)}
                  onMouseLeave={() => onHoverEndret(null)}
                  onFargeClick={() => setFargePickerForId(el.id)}
                  onPauseEtter={() => leggPauseEtter(el.id)}
                />
              )
            })}
          </ul>
        </SortableContext>
      </DndContext>

      {fargePickerEl && fargePickerFunn && (
        <FargePicker
          nuvarendeHex={fargePickerEl.fargeOverrideHex ?? fargePickerFunn.kjoring.farge_hex}
          originalHex={fargePickerFunn.kjoring.farge_hex}
          onVelg={hex => settFarge(fargePickerEl.id, hex)}
          onNullstill={() => nullstillFarge(fargePickerEl.id)}
          onClose={() => setFargePickerForId(null)}
        />
      )}

      {forhåndsvisForslag && (
        <ForhåndsvisModal
          forslag={forhåndsvisForslag}
          sekvens={sekvens}
          ctx={ctx}
          rasterCache={rasterCache}
          kjoringsNummer={kjoringsNummer}
          onClose={() => setForhåndsvisForslag(null)}
        />
      )}
    </div>
  )
}

function KjoringRad({
  el, nummer, ctx, fokusert, onClick, onMouseEnter, onMouseLeave, onFargeClick, onPauseEtter,
}: {
  el: SekvensKjoring
  nummer: number
  ctx: SekvensKontekst
  fokusert: boolean
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFargeClick: () => void
  onPauseEtter: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const funn = finnFargekjoring(ctx, el)
  const farge = effektivFarge(ctx, el)

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${fokusert ? 'bg-stone-100' : 'bg-white hover:bg-stone-50'}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-stone-300 hover:text-stone-500 cursor-grab flex-shrink-0 touch-none"
        onClick={e => e.stopPropagation()}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 6h8M8 12h8M8 18h8" />
        </svg>
      </button>
      <span className="text-xs text-stone-400 w-5 text-right flex-shrink-0">{nummer}</span>
      {!funn ? (
        <span className="flex-1 text-xs text-stone-400 italic">Tolker…</span>
      ) : (
        <>
          <button
            onClick={e => { e.stopPropagation(); onFargeClick() }}
            className="w-6 h-6 rounded-md border border-stone-200 flex-shrink-0"
            style={{ backgroundColor: farge }}
            title="Endre trådfarge"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-stone-700 truncate">{funn.pm.navn}</p>
            <p className="text-xs text-stone-400">
              {farge}{el.fargeOverrideHex ? ' (endret)' : ''} · {funn.kjoring.antall_blokker} del{funn.kjoring.antall_blokker === 1 ? '' : 'er'}
            </p>
          </div>
          <span className="text-xs text-stone-500 flex-shrink-0">{funn.kjoring.antall_sting} sting</span>
        </>
      )}
      <button
        onClick={e => { e.stopPropagation(); onPauseEtter() }}
        title="Legg inn pause etter denne"
        className="text-stone-300 hover:text-stone-600 flex-shrink-0 text-xs px-1.5"
      >
        + pause
      </button>
    </li>
  )
}

function PauseRad({ el, onSlett }: { el: SekvensElement; onSlett: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 px-3 py-2 bg-stone-50 border-y border-dashed border-stone-300">
      <button {...attributes} {...listeners} className="text-stone-300 hover:text-stone-500 cursor-grab flex-shrink-0 touch-none">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 6h8M8 12h8M8 18h8" />
        </svg>
      </button>
      <svg className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 9v6m4-6v6M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="flex-1 text-xs text-stone-500 italic">Pause — maskinen stopper her</span>
      <button onClick={onSlett} className="text-stone-300 hover:text-red-400 flex-shrink-0" aria-label="Slett pause">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </li>
  )
}

// ── ForhåndsvisModal helpers ──────────────────────────────────────────────────

const MODAL_CANVAS_PX = 280
const MODAL_STING_PER_SEK = 5000
const MODAL_PAD = 50 // tenths of mm padding around the zoom area

interface AvspSegment {
  elId: string
  farge: string
  berørt: boolean
  stingFra: number
  stingTil: number
  punkter: [number, number][]
}

function byggAvspSegmenter(
  seq: SekvensElement[],
  ctx: SekvensKontekst,
  berørteIder: Set<string>,
): AvspSegment[] {
  const out: AvspSegment[] = []
  let cum = 0
  for (const el of seq) {
    if (el.type === 'pause') continue
    const funn = finnFargekjoring(ctx, el)
    if (!funn) continue
    const { pm, data, kjoring } = funn
    if (!data.bbox) continue
    const farge = effektivFarge(ctx, el) ?? kjoring.farge_hex
    const pts: [number, number][] = []
    for (let i = kjoring.fra_index; i <= kjoring.til_index; i++) {
      const b = data.stingblokker[i]
      if (!b || b.sting.length === 0) continue
      const abs = plassertPunkter(b.sting, data.bbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm)
      for (const p of abs) pts.push(p)
    }
    if (pts.length === 0) continue
    out.push({
      elId: el.id, farge,
      berørt: berørteIder.has(el.id),
      stingFra: cum, stingTil: cum + pts.length,
      punkter: pts,
    })
    cum += pts.length
  }
  return out
}

function tegnModalCanvas(
  canvas: HTMLCanvasElement,
  segments: AvspSegment[],
  pos: number,
  vp: { cx: number; cy: number; halv: number },
  kollisjonsRaster: Set<string> | null,
) {
  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) return
  const SCALE = MODAL_CANVAS_PX / (vp.halv * 2)
  const OX = MODAL_CANVAS_PX / 2
  const OY = MODAL_CANVAS_PX / 2
  const toC = (x: number, y: number): [number, number] => [
    (x - vp.cx) * SCALE + OX,
    (y - vp.cy) * SCALE + OY,
  ]

  ctx2d.clearRect(0, 0, MODAL_CANVAS_PX, MODAL_CANVAS_PX)
  ctx2d.fillStyle = '#fafaf9'
  ctx2d.fillRect(0, 0, MODAL_CANVAS_PX, MODAL_CANVAS_PX)

  // Hoop outline
  ctx2d.strokeStyle = '#C9A57A'
  ctx2d.lineWidth = 0.5
  ctx2d.setLineDash([3, 3])
  const [hx0, hy0] = toC(-500, -500)
  const [hx1, hy1] = toC(500, 500)
  ctx2d.strokeRect(hx0, hy0, hx1 - hx0, hy1 - hy0)
  ctx2d.setLineDash([])

  const curPos = Math.floor(pos)
  for (const seg of segments) {
    if (seg.stingFra >= curPos) break
    const take = seg.stingTil <= curPos
      ? seg.punkter
      : seg.punkter.slice(0, curPos - seg.stingFra)
    if (take.length < 2) continue
    ctx2d.globalAlpha = seg.berørt ? 1 : 0.1
    ctx2d.strokeStyle = seg.farge
    ctx2d.lineWidth = seg.berørt ? 1 : 0.6
    ctx2d.lineJoin = 'round'
    ctx2d.lineCap = 'round'
    ctx2d.beginPath()
    const [x0, y0] = toC(take[0][0], take[0][1])
    ctx2d.moveTo(x0, y0)
    for (let i = 1; i < take.length; i++) {
      const [xi, yi] = toC(take[i][0], take[i][1])
      ctx2d.lineTo(xi, yi)
    }
    ctx2d.stroke()
  }
  ctx2d.globalAlpha = 1

  // Collision cells drawn on top of stitches
  if (kollisjonsRaster) {
    const cellPx = Math.max(2, Math.ceil(SCALE * 10))
    ctx2d.fillStyle = 'rgba(220,38,38,0.6)'
    for (const celle of kollisjonsRaster) {
      const [col, row] = celle.split(',').map(Number)
      const [px, py] = toC(col * 10, row * 10)
      ctx2d.fillRect(px, py, cellPx, cellPx)
    }
  }
}

function ForhåndsvisModal({
  forslag, sekvens, ctx, rasterCache, kjoringsNummer, onClose,
}: {
  forslag: SammenslaingForslag
  sekvens: SekvensElement[]
  ctx: SekvensKontekst
  rasterCache: Map<string, Set<string> | null>
  kjoringsNummer: Map<string, number>
  onClose: () => void
}) {
  const iNr = kjoringsNummer.get(forslag.iId) ?? '?'
  const jNr = kjoringsNummer.get(forslag.jId) ?? '?'

  const berørteIder = useMemo(
    () => new Set([forslag.iId, forslag.jId, ...forslag.mellomKjoringIder]),
    [forslag],
  )

  const sekvensEtter = useMemo(
    () => flyttElementEtter(sekvens, forslag.jId, forslag.iId),
    [sekvens, forslag],
  )

  const segmenterFør = useMemo(
    () => byggAvspSegmenter(sekvens, ctx, berørteIder),
    [sekvens, ctx, berørteIder],
  )
  const segmenterEtter = useMemo(
    () => byggAvspSegmenter(sekvensEtter, ctx, berørteIder),
    [sekvensEtter, ctx, berørteIder],
  )

  const totalSting = segmenterFør.length > 0 ? segmenterFør[segmenterFør.length - 1].stingTil : 0

  const jEl = sekvens.find(el => el.id === forslag.jId) as SekvensKjoring | undefined
  const jRaster = jEl ? plassertFargekjoringRaster(ctx, jEl, rasterCache) : undefined

  const kollisjonsRaster = useMemo(() => {
    if (!jRaster) return null
    const union = new Set<string>()
    for (const mId of forslag.mellomKjoringIder) {
      const mEl = sekvens.find(el => el.id === mId) as SekvensKjoring | undefined
      if (!mEl) continue
      const mRaster = plassertFargekjoringRaster(ctx, mEl, rasterCache)
      if (!mRaster) continue
      for (const celle of mRaster) {
        if (jRaster.has(celle)) union.add(celle)
      }
    }
    return union.size > 0 ? union : null
  }, [forslag, jRaster, rasterCache, sekvens, ctx])

  const [visHelhet, setVisHelhet] = useState(false)

  const zoomViewport = useMemo(() => {
    if (kollisjonsRaster && kollisjonsRaster.size > 0) {
      let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity
      for (const celle of kollisjonsRaster) {
        const [c, r] = celle.split(',').map(Number)
        if (c < minCol) minCol = c
        if (c > maxCol) maxCol = c
        if (r < minRow) minRow = r
        if (r > maxRow) maxRow = r
      }
      const minX = minCol * 10 - MODAL_PAD
      const maxX = (maxCol + 1) * 10 + MODAL_PAD
      const minY = minRow * 10 - MODAL_PAD
      const maxY = (maxRow + 1) * 10 + MODAL_PAD
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const halv = Math.max((maxX - minX) / 2, (maxY - minY) / 2)
      return { cx, cy, halv }
    }
    // Fallback: bbox of affected segments
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const seg of segmenterFør) {
      if (!seg.berørt) continue
      for (const [x, y] of seg.punkter) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (!isFinite(minX)) return { cx: 0, cy: 0, halv: 600 }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const halv = Math.max((maxX - minX) / 2, (maxY - minY) / 2) + MODAL_PAD
    return { cx, cy, halv }
  }, [kollisjonsRaster, segmenterFør])

  const viewport = useMemo(
    () => visHelhet ? { cx: 0, cy: 0, halv: 600 } : zoomViewport,
    [visHelhet, zoomViewport],
  )

  const [pos, setPos] = useState(0)
  const [spiller, setSpiller] = useState(false)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const canvasForRef = useRef<HTMLCanvasElement>(null)
  const canvasEtterRef = useRef<HTMLCanvasElement>(null)

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
        const neste = p + dt * MODAL_STING_PER_SEK
        if (neste >= totalSting) { setSpiller(false); return totalSting }
        return neste
      })
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [spiller, totalSting])

  useEffect(() => {
    if (canvasForRef.current)
      tegnModalCanvas(canvasForRef.current, segmenterFør, pos, viewport, kollisjonsRaster)
    if (canvasEtterRef.current)
      tegnModalCanvas(canvasEtterRef.current, segmenterEtter, pos, viewport, kollisjonsRaster)
  }, [pos, segmenterFør, segmenterEtter, viewport, kollisjonsRaster])

  // Plain-language description
  const jFunn = jEl ? finnFargekjoring(ctx, jEl) : undefined
  const jMotivNavn = jFunn?.pm.navn ?? ''
  const mellomCount = forslag.mellomKjoringIder.length

  const beskrivelse = (() => {
    const jLabel = jMotivNavn ? ` (${jMotivNavn})` : ''
    if (forslag.endrerLagrekkefolge && kollisjonsRaster) {
      const unike = [
        ...new Set(
          forslag.mellomKjoringIder
            .map(mid => {
              const el = sekvens.find(e => e.id === mid) as SekvensKjoring | undefined
              if (!el) return null
              return finnFargekjoring(ctx, el)?.pm.navn ?? effektivFarge(ctx, el) ?? null
            })
            .filter((n): n is string => n !== null),
        ),
      ].join(' og ')
      return `Kjøring ${jNr}${jLabel} flyttes FØR ${unike || `kjøring ${iNr}`} i stedet for ETTER. De overlapper i ca. ${kollisjonsRaster.size} mm² — der kan kjøring ${jNr} ende opp under i stedet for over.`
    }
    if (forslag.endrerLagrekkefolge) {
      return `Kjøring ${jNr}${jLabel} flyttes FØR ${mellomCount} kjøring${mellomCount !== 1 ? 'er' : ''} — de kan overlappe der de krysser.`
    }
    return `Kjøring ${iNr} og ${jNr} kan slås trygt sammen. Kjøring ${jNr}${jLabel} flyttes FØR ${mellomCount} kjøring${mellomCount !== 1 ? 'er' : ''} uten overlapp med noen av dem.`
  })()

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <h3 className="font-serif text-lg text-stone-800">
            Kjøring {iNr} + {jNr}: forhåndsvisning
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
            aria-label="Lukk"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
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
            <span className="text-xs text-stone-400">{Math.floor(pos)} / {totalSting} sting</span>
            <button
              onClick={() => setVisHelhet(v => !v)}
              className="ml-auto text-xs px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:bg-stone-50 transition-colors"
            >
              {visHelhet ? 'Zoom til overlapp' : 'Vis hel komposisjon'}
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={totalSting}
            step={1}
            value={Math.floor(pos)}
            onChange={e => { setSpiller(false); setPos(+e.target.value) }}
            className="w-full accent-[#C9A57A]"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-stone-500 text-center mb-1.5">Nå</p>
              <canvas
                ref={canvasForRef}
                width={MODAL_CANVAS_PX}
                height={MODAL_CANVAS_PX}
                className="w-full aspect-square rounded-xl border border-stone-200"
              />
            </div>
            <div>
              <p className="text-xs font-medium text-stone-500 text-center mb-1.5">Etter sammenslåing</p>
              <canvas
                ref={canvasEtterRef}
                width={MODAL_CANVAS_PX}
                height={MODAL_CANVAS_PX}
                className="w-full aspect-square rounded-xl border border-stone-200"
              />
            </div>
          </div>

          <div className={`rounded-xl px-4 py-3 text-sm leading-snug ${forslag.endrerLagrekkefolge ? 'bg-amber-50 text-amber-900' : 'bg-stone-50 text-stone-700'}`}>
            {beskrivelse}
          </div>

          {kollisjonsRaster && (
            <p className="text-xs text-red-700 flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: 'rgba(220,38,38,0.6)' }}
              />
              Røde celler viser overlapp (~{kollisjonsRaster.size} mm²) — begge visninger zoomer inn på dette området.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            Lukk
          </button>
        </div>
      </div>
    </div>
  )
}
