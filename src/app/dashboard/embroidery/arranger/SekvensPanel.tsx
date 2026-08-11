'use client'

import { useMemo, useState } from 'react'
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
import { roterLokalePunkter } from './geometri'
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
  const [visning, setVisning] = useState<'for' | 'etter'>('for')

  const iNr = kjoringsNummer.get(forslag.iId) ?? '?'
  const jNr = kjoringsNummer.get(forslag.jId) ?? '?'

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

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <h3 className="font-serif text-lg text-stone-800">
            Sammenslåing: Kjøring {iNr} → Kjøring {jNr}
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

        <div className="p-5">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setVisning('for')}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${visning === 'for' ? 'bg-stone-800 text-white' : 'border border-stone-200 text-stone-600 hover:bg-stone-50'}`}
            >
              Før
            </button>
            <button
              onClick={() => setVisning('etter')}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${visning === 'etter' ? 'bg-stone-800 text-white' : 'border border-stone-200 text-stone-600 hover:bg-stone-50'}`}
            >
              Etter
            </button>
          </div>

          <div className="rounded-xl border border-stone-200 overflow-hidden bg-stone-50 aspect-square">
            <svg
              viewBox="-60 -60 120 120"
              className="w-full h-full"
              style={{ background: 'white' }}
            >
              {/* Ramme */}
              <rect x={-50} y={-50} width={100} height={100} fill="none" stroke="#C9A57A" strokeWidth={0.5} strokeDasharray="2 2" />

              {ctx.motiver.map(pm => {
                const key = `${pm.embroideryId}:${pm.sizeId}`
                const data = ctx.resolved[key]
                if (!data?.bbox) return null

                return (
                  <g
                    key={pm.id}
                    transform={`translate(${pm.posisjonXTiendedelMm / 10} ${pm.posisjonYTiendedelMm / 10})`}
                  >
                    {data.stingblokker.map((b, i) => {
                      const roterte = roterLokalePunkter(b.sting, data.bbox!, pm.rotasjonGrader)
                      return (
                        <polyline
                          key={i}
                          points={roterte.map(([x, y]) => `${x / 10},${y / 10}`).join(' ')}
                          fill="none"
                          stroke={b.farge_hex}
                          strokeWidth={0.3}
                        />
                      )
                    })}
                  </g>
                )
              })}

              {visning === 'etter' && kollisjonsRaster && Array.from(kollisjonsRaster).map(celle => {
                const parts = celle.split(',').map(Number)
                const cx = parts[0]
                const cy = parts[1]
                return (
                  <rect
                    key={celle}
                    x={cx}
                    y={cy}
                    width={1}
                    height={1}
                    fill="rgba(220,38,38,0.4)"
                  />
                )
              })}
            </svg>
          </div>

          {visning === 'etter' && kollisjonsRaster && (
            <p className="text-xs text-red-700 mt-2">
              Røde celler viser hvor kjøring {jNr} vil overlappe med mellomliggende kjøringer etter sammenslåingen.
            </p>
          )}
          {visning === 'etter' && !kollisjonsRaster && (
            <p className="text-xs text-stone-500 mt-2">
              Ingen presis overlapp funnet mellom kjøring {jNr} og mellomliggende kjøringer.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
          >
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )
}
