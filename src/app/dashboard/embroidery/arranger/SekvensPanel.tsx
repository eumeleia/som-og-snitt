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
  finnSammenslaingsforslag, sjekkFasesortering, fasesorter, nyPause, type SekvensKontekst,
} from './sekvens'
import type { BroderiMotivData, PlassertMotiv, SekvensElement, SekvensKjoring } from './types'

export function SekvensPanel({ sekvens, onChange, motiver, resolved }: {
  sekvens: SekvensElement[]
  onChange: (ny: SekvensElement[]) => void
  motiver: PlassertMotiv[]
  resolved: Record<string, BroderiMotivData>
}) {
  const [fargePickerForId, setFargePickerForId] = useState<string | null>(null)

  const ctx: SekvensKontekst = useMemo(() => ({ motiver, resolved }), [motiver, resolved])

  // Sting-rutenettet for en kjøring avhenger bare av motivets egen geometri (motiver/resolved),
  // aldri av rekkefølgen i sekvensen — denne cachen lever derfor så lenge DE er urørt, og
  // bygges på nytt bare når motiver/resolved faktisk endrer seg (nytt motiv, flyttet, rotert),
  // ikke ved hver omrokkering i sekvenspanelet. Depsen er bevisst IKKE lest inni factory-en
  // (den bare oppretter et tomt Map) — de er en ren cache-nøkkel, ikke data useMemo skal
  // resirkulere, så exhaustive-deps sin advarsel gjelder ikke det den er ment for her.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rasterCache = useMemo(() => new Map<string, Set<string> | null>(), [motiver, resolved])

  const omtredninger = useMemo(() => tellOmtredninger(sekvens, ctx), [sekvens, ctx])
  const { forslag, flereEnnVist } = useMemo(
    () => finnSammenslaingsforslag(sekvens, ctx, rasterCache),
    [sekvens, ctx, rasterCache],
  )
  const faseStatus = useMemo(() => sjekkFasesortering(ctx), [ctx])

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
          {forslag.map(f => (
            <div
              key={`${f.iId}-${f.jId}`}
              className={`p-3 rounded-xl border text-sm ${
                f.endrerLagrekkefolge ? 'bg-amber-50 border-amber-200' : 'bg-stone-50 border-stone-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded border border-stone-300 flex-shrink-0" style={{ backgroundColor: f.farge }} />
                <span className="flex-1 text-stone-700">
                  Sparer {f.sparteOmtredninger} omtredning{f.sparteOmtredninger === 1 ? '' : 'er'}
                </span>
                <button
                  onClick={() => onChange(flyttElementEtter(sekvens, f.jId, f.iId))}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition-colors flex-shrink-0"
                >
                  Slå sammen
                </button>
              </div>
              {f.fargerMellom.length > 0 && (
                <p className="text-xs text-stone-500 mt-1.5 flex items-center gap-1">
                  Flytter forbi:
                  {f.fargerMellom.map(h => (
                    <span key={h} className="inline-block w-3 h-3 rounded-sm border border-stone-300" style={{ backgroundColor: h }} />
                  ))}
                </p>
              )}
              {f.endrerLagrekkefolge && (
                <p className="text-xs text-amber-800 mt-1.5 flex items-center gap-1 flex-wrap">
                  <span>⚠ Der stingene faktisk overlapper, legger</span>
                  {f.overlappendeFarger.map(h => (
                    <span key={h} className="inline-block w-3 h-3 rounded-sm border border-stone-300 flex-shrink-0" style={{ backgroundColor: h }} />
                  ))}
                  <span>seg over</span>
                  <span className="inline-block w-3 h-3 rounded-sm border border-stone-300 flex-shrink-0" style={{ backgroundColor: f.farge }} />
                  <span>i stedet for under, som i dag — f.eks. kan en kontur ende opp under fyllet.</span>
                </p>
              )}
            </div>
          ))}
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
    </div>
  )
}

function KjoringRad({ el, nummer, ctx, onFargeClick, onPauseEtter }: {
  el: SekvensKjoring
  nummer: number
  ctx: SekvensKontekst
  onFargeClick: () => void
  onPauseEtter: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const funn = finnFargekjoring(ctx, el)
  const farge = effektivFarge(ctx, el)

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 px-3 py-2.5 bg-white">
      <button {...attributes} {...listeners} className="text-stone-300 hover:text-stone-500 cursor-grab flex-shrink-0 touch-none">
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
            onClick={onFargeClick}
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
        onClick={onPauseEtter}
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
