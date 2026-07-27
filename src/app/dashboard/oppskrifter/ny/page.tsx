'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { MAAL, type MaalDef } from '@/lib/monster/maal'
import { BLOKKER, type Blokk } from '@/lib/monster/plagg'
import {
  stoerrelserFor, damestoerrelser, naermesteStoerrelse, naermesteDame,
  type StandardRad,
} from '@/lib/monster/stoerrelser'
import { tilSvg, lastNed } from '@/lib/monster/generator'
import { konstruer, valider as validerBlokk, tilDel, type Passform } from '@/lib/monster/bukseblokk'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfilRow {
  id: string
  navn: string
  type: 'barn' | 'voksen'
  kjonn: 'jente' | 'gutt' | 'dame' | null
  hoyde_cm: number | null
  maal: Record<string, number>
  opprettet: string
}

interface NyProfilDraft {
  navn: string
  type: 'barn' | 'voksen'
  kjonn: 'jente' | 'gutt' | 'dame' | ''
  hoyde_cm: string
  maal: Record<string, string>
}

// ─── Helpers (outside component) ─────────────────────────────────────────────

function maalFiltrert(type: 'barn' | 'voksen'): MaalDef[] {
  return MAAL.filter(m => m.gjelder === type || m.gjelder === 'begge')
}

function blokkPasserProfil(b: Blokk, p: ProfilRow): boolean {
  if (p.type === 'voksen') return b.malgruppe === 'dame'
  if (b.malgruppe === 'dame') return false
  if (b.malgruppe === 'ungjente' && p.kjonn !== 'jente') return false
  return true
}

function resolvedMaalFra(
  profil: ProfilRow | null,
  kilde: 'personlig' | 'standard',
  stdRad: StandardRad | null,
  inlineMaal: Record<string, string>,
): Record<string, number | undefined> {
  const base: Record<string, number | undefined> = {}
  if (kilde === 'personlig' && profil) Object.assign(base, profil.maal)
  else if (kilde === 'standard' && stdRad) Object.assign(base, stdRad.maal)
  for (const [k, v] of Object.entries(inlineMaal)) {
    const n = parseFloat(v)
    if (!isNaN(n) && n > 0) base[k] = n
  }
  return base
}

function countDekket(blokk: Blokk | null, maal: Record<string, number | undefined>): number {
  if (!blokk) return 0
  return blokk.maal.filter(id => {
    const v = maal[id]
    return v !== undefined && !isNaN(v)
  }).length
}

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition'
const labelCls = 'block text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5'

function SeksjonOverskrift({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-4 mb-6 ${className}`}>
      <h2 className="font-serif text-xl text-stone-600 whitespace-nowrap">{children}</h2>
      <div className="flex-1 border-t border-stone-200" />
    </div>
  )
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70" />
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

// ─── MaalFelt: ett målfelt med instruksjon og bokstav ─────────────────────────

function MaalFelt({
  def,
  value,
  onChange,
  readOnly = false,
}: {
  def: MaalDef
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <label className="text-xs font-semibold text-stone-600">{def.navn}</label>
        {def.bokstav && (
          <Badge
            label={def.bokstav}
            cls="bg-[#F5EFE6] text-[#8B6340] border-[#D4A574] font-mono text-[10px]"
          />
        )}
        <span className="text-xs text-stone-400">{def.engelsk}</span>
      </div>
      <p className="text-xs text-stone-400 mb-1.5 leading-relaxed">{def.slik}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.1"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder="cm"
          className={`w-28 px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition ${readOnly ? 'bg-stone-50 text-stone-400 cursor-not-allowed' : ''}`}
        />
        <span className="text-xs text-stone-400">cm</span>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NyOppskriftPage() {
  // Profiles
  const [profiles, setProfiles] = useState<ProfilRow[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [selectedProfilId, setSelectedProfilId] = useState<string | null>(null)

  // New profile form
  const [showNyProfil, setShowNyProfil] = useState(false)
  const [nyDraft, setNyDraft] = useState<NyProfilDraft>({
    navn: '', type: 'barn', kjonn: 'jente', hoyde_cm: '', maal: {},
  })
  const [savingProfil, setSavingProfil] = useState(false)
  const [savingProfilError, setSavingProfilError] = useState<string | null>(null)

  // Measurement source
  const [maalKilde, setMaalKilde] = useState<'personlig' | 'standard'>('personlig')
  const [stdRad, setStdRad] = useState<StandardRad | null>(null)

  // Pattern block
  const [selectedBlokkId, setSelectedBlokkId] = useState<string | null>(null)
  const [passform, setPassform] = useState<Passform>('basis')
  const [sommonnCm, setSommonnCm] = useState<number>(1)
  const [inlineMaal, setInlineMaal] = useState<Record<string, string>>({})
  const [savingInline, setSavingInline] = useState(false)

  // Generation
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [validerFeil, setValiderFeil] = useState<string[]>([])
  const [diagramOpen, setDiagramOpen] = useState(false)

  // ── Computed ──────────────────────────────────────────────────────────────

  const selectedProfil = useMemo(
    () => profiles.find(p => p.id === selectedProfilId) ?? null,
    [profiles, selectedProfilId],
  )

  const barnStdOptions = useMemo(() => {
    if (!selectedProfil || selectedProfil.type !== 'barn') return []
    const kj = selectedProfil.kjonn === 'gutt' ? 'gutt' : 'jente'
    return stoerrelserFor(kj)
  }, [selectedProfil])

  const dameStdOptions = useMemo(() => {
    if (!selectedProfil || selectedProfil.type !== 'voksen') return []
    return damestoerrelser()
  }, [selectedProfil])

  const filteredBlokker = useMemo(() => {
    if (!selectedProfil) return []
    return BLOKKER.filter(b => b.status === 'verifisert' && blokkPasserProfil(b, selectedProfil))
  }, [selectedProfil])

  const selectedBlokk = useMemo(
    () => BLOKKER.find(b => b.id === selectedBlokkId) ?? null,
    [selectedBlokkId],
  )

  const resolvedMaal = useMemo(
    () => resolvedMaalFra(selectedProfil, maalKilde, stdRad, inlineMaal),
    [selectedProfil, maalKilde, stdRad, inlineMaal],
  )

  const missingMaal = useMemo(() => {
    if (!selectedBlokk) return []
    return selectedBlokk.maal.filter(id => {
      const v = resolvedMaal[id]
      return v === undefined || isNaN(v as number)
    })
  }, [selectedBlokk, resolvedMaal])

  const dekPersonlig = useMemo(() => {
    if (!selectedBlokk || !selectedProfil) return { har: 0, total: 0 }
    const pm: Record<string, number | undefined> = {
      ...selectedProfil.maal,
      ...Object.fromEntries(
        Object.entries(inlineMaal)
          .map(([k, v]) => [k, parseFloat(v)])
          .filter(([, n]) => !isNaN(n as number) && (n as number) > 0),
      ),
    }
    return { har: countDekket(selectedBlokk, pm), total: selectedBlokk.maal.length }
  }, [selectedBlokk, selectedProfil, inlineMaal])

  const dekStandard = useMemo(() => {
    if (!selectedBlokk || !stdRad) return { har: 0, total: 0 }
    return {
      har: countDekket(selectedBlokk, stdRad.maal as Record<string, number | undefined>),
      total: selectedBlokk.maal.length,
    }
  }, [selectedBlokk, stdRad])

  const hoydeCmForBlokk = useMemo(() => {
    if (maalKilde === 'standard' && stdRad) return Number(stdRad.nokkel)
    if (selectedProfil?.hoyde_cm) return selectedProfil.hoyde_cm
    const h = resolvedMaal['hoyde']
    return h ?? 104
  }, [maalKilde, stdRad, selectedProfil, resolvedMaal])

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiler')
      .select('*')
      .order('opprettet', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (!error && data) setProfiles(data as ProfilRow[])
        setLoadingProfiles(false)
      })
    return () => { cancelled = true }
  }, [])

  // Auto-select std size when profile changes
  useEffect(() => {
    if (!selectedProfil) { setStdRad(null); return }
    if (selectedProfil.type === 'barn') {
      const kj = selectedProfil.kjonn === 'gutt' ? 'gutt' : 'jente'
      const rad = selectedProfil.hoyde_cm
        ? naermesteStoerrelse(selectedProfil.hoyde_cm, kj)
        : barnStdOptions[0]
      setStdRad(rad ?? null)
    } else {
      const byste = selectedProfil.maal?.bryst
      const rad = byste ? naermesteDame(byste) : dameStdOptions[0]
      setStdRad(rad ?? null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfilId])

  // Reset block + SVG when profile changes
  useEffect(() => {
    setSelectedBlokkId(null)
    setSvgContent(null)
    setValiderFeil([])
    setInlineMaal({})
  }, [selectedProfilId])

  // Reset SVG when generation inputs change
  useEffect(() => {
    setSvgContent(null)
    setValiderFeil([])
  }, [selectedBlokkId, passform, sommonnCm, maalKilde, stdRad])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleProfilSelect = useCallback((id: string) => {
    setSelectedProfilId(prev => prev === id ? null : id)
    setShowNyProfil(false)
  }, [])

  const handleNyProfilSave = useCallback(async () => {
    if (!nyDraft.navn.trim()) return
    setSavingProfil(true)
    setSavingProfilError(null)

    const maalParsed: Record<string, number> = {}
    for (const [k, v] of Object.entries(nyDraft.maal)) {
      const n = parseFloat(v)
      if (!isNaN(n) && n > 0) maalParsed[k] = n
    }

    const payload = {
      navn: nyDraft.navn.trim(),
      type: nyDraft.type,
      kjonn: nyDraft.kjonn || null,
      hoyde_cm: nyDraft.hoyde_cm ? parseFloat(nyDraft.hoyde_cm) : null,
      maal: maalParsed,
    }

    const { data, error } = await supabase.from('profiler').insert(payload).select().single()
    setSavingProfil(false)

    if (error) {
      setSavingProfilError(error.message)
      return
    }
    const ny = data as ProfilRow
    setProfiles(prev => [ny, ...prev])
    setSelectedProfilId(ny.id)
    setShowNyProfil(false)
    setNyDraft({ navn: '', type: 'barn', kjonn: 'jente', hoyde_cm: '', maal: {} })
  }, [nyDraft])

  const handleSaveInlineMaal = useCallback(async () => {
    if (!selectedProfil) return
    const toAdd: Record<string, number> = {}
    for (const [k, v] of Object.entries(inlineMaal)) {
      const n = parseFloat(v)
      if (!isNaN(n) && n > 0) toAdd[k] = n
    }
    if (!Object.keys(toAdd).length) return

    setSavingInline(true)
    const updatedMaal = { ...selectedProfil.maal, ...toAdd }
    const { error } = await supabase
      .from('profiler')
      .update({ maal: updatedMaal, oppdatert: new Date().toISOString() })
      .eq('id', selectedProfil.id)
    setSavingInline(false)

    if (!error) {
      setProfiles(prev => prev.map(p =>
        p.id === selectedProfil.id ? { ...p, maal: updatedMaal } : p,
      ))
      setInlineMaal({})
    }
  }, [selectedProfil, inlineMaal])

  const handleGenerer = useCallback(() => {
    if (!selectedBlokk || !selectedProfil) return
    if (missingMaal.length > 0) {
      setValiderFeil(missingMaal.map(id => {
        const m = MAAL.find(x => x.id === id)
        return `Mangler: ${m?.navn ?? id}`
      }))
      setSvgContent(null)
      return
    }

    if (selectedBlokk.id === 'barn-bukse-1') {
      const hofte = resolvedMaal['hofte']!
      const bodyRise = resolvedMaal['bodyRise']!
      const innsideBen = resolvedMaal['innsideBen']!

      const k = konstruer(
        { hoydeCm: hoydeCmForBlokk, hofte, bodyRise, innsideBen },
        passform,
      )
      const feil = validerBlokk(k)
      if (feil.length) {
        setValiderFeil(feil)
        setSvgContent(null)
        return
      }

      const del = tilDel(k)
      const dato = new Date().toISOString().slice(0, 10)
      const svg = tilSvg([del], {
        sommonnCm,
        undertekst: `${selectedBlokk.navn} · ${selectedProfil.navn} · ${dato}`,
      })
      setSvgContent(svg)
      setValiderFeil([])
    }
  }, [selectedBlokk, selectedProfil, resolvedMaal, missingMaal, passform, sommonnCm, hoydeCmForBlokk])

  const handleLastNed = useCallback(() => {
    if (!svgContent || !selectedBlokk || !selectedProfil) return
    const dato = new Date().toISOString().slice(0, 10)
    const plagNavn = selectedBlokk.id.replace(/^(barn|dame|baby)-/, '').replace(/-\d+$/, '')
    const profNavn = selectedProfil.navn
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    lastNed(svgContent, `${plagNavn}-${profNavn}-${dato}.svg`)
  }, [svgContent, selectedBlokk, selectedProfil])

  // ── Render helpers ────────────────────────────────────────────────────────

  const nyProfilMaalDefs = useMemo(
    () => maalFiltrert(nyDraft.type),
    [nyDraft.type],
  )

  // ─────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F4' }}>
      {/* ── Topp-nav ─────────────────────────────────────────────────── */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/dashboard/recipes"
            className="flex items-center gap-1 text-sm text-stone-400 hover:text-stone-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
            Oppskrifter
          </Link>
          <span className="text-stone-300">/</span>
          <span className="text-sm text-stone-600 font-medium">Ny oppskrift fra mønster</span>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            STEG 1 — HVEM
        ═══════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SeksjonOverskrift>1 — Hvem skal plagget til?</SeksjonOverskrift>

          {loadingProfiles ? (
            <div className="flex items-center gap-2 text-stone-400 text-sm py-4">
              <Spinner /> Laster profiler…
            </div>
          ) : (
            <>
              {/* Profilkort */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                {profiles.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleProfilSelect(p.id)}
                    className={`text-left p-3 rounded-xl border transition-all ${
                      selectedProfilId === p.id
                        ? 'border-[#C9A57A] bg-[#F5EFE6] shadow-sm'
                        : 'border-stone-200 bg-white hover:border-stone-300'
                    }`}
                  >
                    <p className="font-medium text-stone-800 text-sm">{p.navn}</p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {p.type === 'barn' ? 'Barn' : 'Voksen'}
                      {p.kjonn ? ` · ${p.kjonn}` : ''}
                      {p.hoyde_cm ? ` · ${p.hoyde_cm} cm` : ''}
                    </p>
                  </button>
                ))}

                {/* Ny profil-knapp */}
                <button
                  onClick={() => { setShowNyProfil(o => !o); setSelectedProfilId(null) }}
                  className={`text-left p-3 rounded-xl border-2 border-dashed transition-all ${
                    showNyProfil
                      ? 'border-[#C9A57A] bg-[#F5EFE6]'
                      : 'border-stone-200 hover:border-stone-300 bg-white'
                  }`}
                >
                  <p className="text-sm text-stone-500 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Ny profil
                  </p>
                </button>
              </div>

              {/* Ny profil-skjema */}
              {showNyProfil && (
                <div className="bg-white rounded-xl border border-stone-200 p-5 mb-6">
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="font-medium text-stone-700">Ny profil</h3>
                    <button
                      onClick={() => setDiagramOpen(true)}
                      className="flex items-center gap-1 text-xs text-[#8B6340] hover:underline"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Vis måldiagram
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                    <div>
                      <label className={labelCls}>Navn</label>
                      <input
                        type="text"
                        value={nyDraft.navn}
                        onChange={e => setNyDraft(d => ({ ...d, navn: e.target.value }))}
                        placeholder="f.eks. Ellinor"
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <label className={labelCls}>Type</label>
                      <div className="flex gap-2">
                        {(['barn', 'voksen'] as const).map(t => (
                          <button
                            key={t}
                            onClick={() => setNyDraft(d => ({
                              ...d, type: t,
                              kjonn: t === 'voksen' ? 'dame' : 'jente',
                              maal: {},
                            }))}
                            className={`flex-1 py-2 rounded-lg border text-sm transition-all capitalize ${
                              nyDraft.type === t
                                ? 'border-[#C9A57A] bg-[#F5EFE6] text-[#8B6340] font-medium'
                                : 'border-stone-200 text-stone-500 hover:border-stone-300'
                            }`}
                          >
                            {t === 'barn' ? 'Barn' : 'Voksen'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {nyDraft.type === 'barn' && (
                      <div>
                        <label className={labelCls}>Kjønn</label>
                        <div className="flex gap-2">
                          {(['jente', 'gutt'] as const).map(kj => (
                            <button
                              key={kj}
                              onClick={() => setNyDraft(d => ({ ...d, kjonn: kj }))}
                              className={`flex-1 py-2 rounded-lg border text-sm transition-all capitalize ${
                                nyDraft.kjonn === kj
                                  ? 'border-[#C9A57A] bg-[#F5EFE6] text-[#8B6340] font-medium'
                                  : 'border-stone-200 text-stone-500 hover:border-stone-300'
                              }`}
                            >
                              {kj.charAt(0).toUpperCase() + kj.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {nyDraft.type === 'voksen' && (
                      <div>
                        <label className={labelCls}>Kjønn</label>
                        <div className="flex gap-2">
                          <button
                            disabled
                            className="flex-1 py-2 rounded-lg border text-sm border-[#C9A57A] bg-[#F5EFE6] text-[#8B6340] font-medium"
                          >
                            Dame
                          </button>
                        </div>
                      </div>
                    )}

                    {nyDraft.type === 'barn' && (
                      <div>
                        <label className={labelCls}>Høyde (cm)</label>
                        <input
                          type="number"
                          step="1"
                          min="40"
                          max="200"
                          value={nyDraft.hoyde_cm}
                          onChange={e => setNyDraft(d => ({ ...d, hoyde_cm: e.target.value }))}
                          placeholder="f.eks. 104"
                          className={inputCls}
                        />
                        <p className="text-xs text-stone-400 mt-1">Brukes til å forhåndsvelge standardstørrelse</p>
                      </div>
                    )}
                  </div>

                  {/* Målfelter */}
                  <div className="border-t border-stone-100 pt-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold tracking-widest uppercase text-stone-400">
                        Mål ({nyProfilMaalDefs.length} felt)
                      </p>
                      <button
                        onClick={() => setDiagramOpen(true)}
                        className="text-xs text-[#8B6340] hover:underline"
                      >
                        Vis måldiagram
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                      {nyProfilMaalDefs.map(def => (
                        <MaalFelt
                          key={def.id}
                          def={def}
                          value={nyDraft.maal[def.id] ?? ''}
                          onChange={v => setNyDraft(d => ({ ...d, maal: { ...d.maal, [def.id]: v } }))}
                        />
                      ))}
                    </div>
                  </div>

                  {savingProfilError && (
                    <p className="text-xs text-red-600 mb-3">{savingProfilError}</p>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleNyProfilSave}
                      disabled={!nyDraft.navn.trim() || savingProfil}
                      className="flex items-center gap-2 px-4 py-2 bg-stone-700 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {savingProfil ? <Spinner /> : null}
                      Lagre profil
                    </button>
                    <button
                      onClick={() => setShowNyProfil(false)}
                      className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 transition-colors"
                    >
                      Avbryt
                    </button>
                  </div>
                </div>
              )}

              {/* ── Målkilde (når profil er valgt) ─────────────────── */}
              {selectedProfil && (
                <div className="bg-white rounded-xl border border-stone-200 p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-medium text-stone-700">
                      Mål for <span className="text-[#8B6340]">{selectedProfil.navn}</span>
                    </p>
                    <button
                      onClick={() => setDiagramOpen(true)}
                      className="flex items-center gap-1 text-xs text-[#8B6340] hover:underline"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Vis måldiagram
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    {/* Personlige mål */}
                    <label className={`flex-1 flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      maalKilde === 'personlig'
                        ? 'border-[#C9A57A] bg-[#F5EFE6]'
                        : 'border-stone-200 hover:border-stone-300'
                    }`}>
                      <input
                        type="radio"
                        name="maalKilde"
                        value="personlig"
                        checked={maalKilde === 'personlig'}
                        onChange={() => setMaalKilde('personlig')}
                        className="mt-0.5 accent-[#C9A57A]"
                      />
                      <div>
                        <p className="text-sm font-medium text-stone-700">Personlige mål</p>
                        {selectedBlokk ? (
                          <p className="text-xs text-stone-400 mt-0.5">
                            {dekPersonlig.har} av {dekPersonlig.total} registrert
                          </p>
                        ) : (
                          <p className="text-xs text-stone-400 mt-0.5">
                            {Object.keys(selectedProfil.maal).length} mål lagret
                          </p>
                        )}
                      </div>
                    </label>

                    {/* Standardmål */}
                    <label className={`flex-1 flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      maalKilde === 'standard'
                        ? 'border-[#C9A57A] bg-[#F5EFE6]'
                        : 'border-stone-200 hover:border-stone-300'
                    }`}>
                      <input
                        type="radio"
                        name="maalKilde"
                        value="standard"
                        checked={maalKilde === 'standard'}
                        onChange={() => setMaalKilde('standard')}
                        className="mt-0.5 accent-[#C9A57A]"
                      />
                      <div>
                        <p className="text-sm font-medium text-stone-700">Standardmål</p>
                        {selectedBlokk && stdRad ? (
                          <p className="text-xs text-stone-400 mt-0.5">
                            {dekStandard.har} av {dekStandard.total} dekket
                          </p>
                        ) : (
                          <p className="text-xs text-stone-400 mt-0.5">Velg størrelse nedenfor</p>
                        )}
                      </div>
                    </label>
                  </div>

                  {/* Standard-størrelsesvelger */}
                  {maalKilde === 'standard' && (
                    <div className="mt-4 pt-4 border-t border-stone-100">
                      {selectedProfil.type === 'barn' && (
                        <>
                          <label className={labelCls}>Standardstørrelse (barn)</label>
                          <select
                            value={stdRad ? `${stdRad.kjonn ?? 'unisex'}-${stdRad.nokkel}` : ''}
                            onChange={e => {
                              const key = e.target.value
                              const rad = barnStdOptions.find(
                                r => `${r.kjonn ?? 'unisex'}-${r.nokkel}` === key,
                              )
                              setStdRad(rad ?? null)
                            }}
                            className={inputCls}
                          >
                            <option value="">— velg størrelse —</option>
                            {barnStdOptions.map(r => (
                              <option
                                key={`${r.kjonn ?? 'unisex'}-${r.nokkel}`}
                                value={`${r.kjonn ?? 'unisex'}-${r.nokkel}`}
                              >
                                {r.nokkel} cm{r.alder ? ` — ${r.alder}` : ''}
                                {r.kjonn === 'unisex' ? ' (unisex)' : ''}
                                {r.vektKg ? ` · ${r.vektKg} kg` : ''}
                              </option>
                            ))}
                          </select>

                          {stdRad && (
                            <div className="mt-2 space-y-1">
                              {stdRad.kjonn === 'unisex' && (
                                <p className="text-xs text-stone-500 flex items-center gap-1">
                                  <svg className="w-3.5 h-3.5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  Benytter unisex babytabell (str. {stdRad.nokkel})
                                </p>
                              )}
                              <p className="text-xs text-stone-400 italic">Kilde: {stdRad.kilde}</p>
                            </div>
                          )}
                        </>
                      )}

                      {selectedProfil.type === 'voksen' && (
                        <>
                          <label className={labelCls}>Standardstørrelse (dame)</label>
                          <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Tabellen gjelder kvinner 160–172 cm. Justering for andre høyder er ikke lagt inn.
                          </p>
                          <select
                            value={stdRad ? `dame-${stdRad.nokkel}` : ''}
                            onChange={e => {
                              const key = e.target.value
                              const rad = dameStdOptions.find(r => `dame-${r.nokkel}` === key)
                              setStdRad(rad ?? null)
                            }}
                            className={inputCls}
                          >
                            <option value="">— velg størrelse —</option>
                            {dameStdOptions.map(r => (
                              <option key={`dame-${r.nokkel}`} value={`dame-${r.nokkel}`}>
                                {r.nokkel} — byste {r.maal.bryst} cm
                              </option>
                            ))}
                          </select>
                          {stdRad && (
                            <p className="text-xs text-stone-400 italic mt-2">Kilde: {stdRad.kilde}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════
            STEG 2 — HVA
        ═══════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SeksjonOverskrift>2 — Hva skal lages?</SeksjonOverskrift>

          {!selectedProfil ? (
            <p className="text-sm text-stone-400 italic">Velg eller opprett en profil i steg 1 for å fortsette.</p>
          ) : filteredBlokker.length === 0 ? (
            <p className="text-sm text-stone-400 italic">
              Ingen verifiserte blokker tilgjengelig for denne profilen ennå.
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-5">
              {/* Blokkvelger */}
              <div>
                <label className={labelCls}>Plagg / blokk</label>
                <select
                  value={selectedBlokkId ?? ''}
                  onChange={e => {
                    setSelectedBlokkId(e.target.value || null)
                    setPassform('basis')
                    setInlineMaal({})
                  }}
                  className={inputCls}
                >
                  <option value="">— velg plagg —</option>
                  {filteredBlokker.map(b => (
                    <option key={b.id} value={b.id}>{b.navn}</option>
                  ))}
                </select>
              </div>

              {selectedBlokk && (
                <>
                  {/* Blokkinfo */}
                  <div className="text-xs text-stone-400 space-y-1 bg-stone-50 rounded-lg p-3">
                    <p><span className="text-stone-500 font-medium">Stoff:</span>{' '}
                      {selectedBlokk.stoff === 'jersey' ? 'Jersey' : selectedBlokk.stoff === 'vevd' ? 'Vevd' : 'Jersey eller vevd'}
                    </p>
                    <p><span className="text-stone-500 font-medium">Størrelse:</span> {selectedBlokk.stroelse}</p>
                    {selectedBlokk.merknad && (
                      <p><span className="text-stone-500 font-medium">Merknad:</span> {selectedBlokk.merknad}</p>
                    )}
                    <p>
                      <span className="text-stone-500 font-medium">Krever:</span>{' '}
                      {selectedBlokk.maal.map(id => {
                        const def = MAAL.find(m => m.id === id)
                        const harMaal = resolvedMaal[id] !== undefined && !isNaN(resolvedMaal[id] as number)
                        return (
                          <span
                            key={id}
                            className={`inline-block mr-1 ${harMaal ? 'text-stone-500' : 'text-red-500 font-medium'}`}
                          >
                            {def?.navn ?? id}
                          </span>
                        )
                      })}
                    </p>
                  </div>

                  {/* Manglende mål */}
                  {missingMaal.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold tracking-widest uppercase text-red-500 mb-3">
                        Manglende mål ({missingMaal.length})
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                        {missingMaal.map(id => {
                          const def = MAAL.find(m => m.id === id)
                          if (!def) return null
                          const stdVal = stdRad?.maal[id]
                          const erIkkeRegistrert = stdVal === undefined && maalKilde === 'standard'

                          return (
                            <div key={id} className="mb-4">
                              <div className="flex items-center gap-2 mb-1">
                                <label className="text-xs font-semibold text-stone-600">{def.navn}</label>
                                {def.bokstav && (
                                  <Badge label={def.bokstav} cls="bg-[#F5EFE6] text-[#8B6340] border-[#D4A574] font-mono text-[10px]" />
                                )}
                              </div>
                              <p className="text-xs text-stone-400 mb-1.5 leading-relaxed">{def.slik}</p>
                              {erIkkeRegistrert ? (
                                <p className="text-xs text-stone-400 italic">ikke registrert i standardtabellen</p>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    value={inlineMaal[id] ?? ''}
                                    onChange={e => setInlineMaal(prev => ({ ...prev, [id]: e.target.value }))}
                                    placeholder="cm"
                                    className="w-28 px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
                                  />
                                  <span className="text-xs text-stone-400">cm</span>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {Object.values(inlineMaal).some(v => parseFloat(v) > 0) && (
                        <button
                          onClick={handleSaveInlineMaal}
                          disabled={savingInline}
                          className="flex items-center gap-2 mt-2 px-3 py-1.5 text-xs bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg transition-colors disabled:opacity-40"
                        >
                          {savingInline ? <Spinner /> : null}
                          Lagre mål til profil
                        </button>
                      )}
                    </div>
                  )}

                  {/* Passform (bare for bukseblokken) */}
                  {selectedBlokk.id === 'barn-bukse-1' && (
                    <div>
                      <label className={labelCls}>Passform</label>
                      <div className="flex gap-2">
                        {(['leggings', 'basis', 'romslig'] as Passform[]).map(pf => (
                          <button
                            key={pf}
                            onClick={() => setPassform(pf)}
                            className={`flex-1 py-2 rounded-lg border text-sm transition-all capitalize ${
                              passform === pf
                                ? 'border-[#C9A57A] bg-[#F5EFE6] text-[#8B6340] font-medium'
                                : 'border-stone-200 text-stone-500 hover:border-stone-300'
                            }`}
                          >
                            {pf.charAt(0).toUpperCase() + pf.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sømmonn */}
                  <div>
                    <label className={labelCls}>Sømmonn</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="5"
                        value={sommonnCm}
                        onChange={e => setSommonnCm(parseFloat(e.target.value) || 0)}
                        className="w-24 px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
                      />
                      <span className="text-sm text-stone-500">cm (0 = ingen sømmonn)</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════
            STEG 3 — GENERER
        ═══════════════════════════════════════════════════════════ */}
        <section className="mb-16">
          <SeksjonOverskrift>3 — Generer mønster</SeksjonOverskrift>

          {!selectedProfil || !selectedBlokk ? (
            <p className="text-sm text-stone-400 italic">
              Fullfør steg 1 og 2 for å generere mønster.
            </p>
          ) : (
            <div className="space-y-5">
              {/* Generer-knapp */}
              <button
                onClick={handleGenerer}
                disabled={missingMaal.some(id => {
                  const stdVal = stdRad?.maal[id]
                  const erIkkeRegistrert = stdVal === undefined && maalKilde === 'standard'
                  const harInline = inlineMaal[id] && parseFloat(inlineMaal[id]) > 0
                  return erIkkeRegistrert || (!harInline && resolvedMaal[id] === undefined)
                })}
                className="flex items-center gap-2 px-5 py-2.5 bg-stone-700 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generer mønster
              </button>

              {/* Valideringsfeil */}
              {validerFeil.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-red-700 mb-2">
                    Kan ikke generere mønster:
                  </p>
                  <ul className="space-y-1">
                    {validerFeil.map((f, i) => (
                      <li key={i} className="text-xs text-red-600 flex items-start gap-1.5">
                        <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* SVG-forhåndsvisning */}
              {svgContent && (
                <div>
                  <p className="text-xs font-semibold tracking-widest uppercase text-stone-400 mb-3">
                    Forhåndsvisning
                  </p>
                  <div
                    className="border border-stone-200 rounded-xl overflow-auto bg-white p-4 max-h-[70vh]"
                    dangerouslySetInnerHTML={{ __html: svgContent }}
                  />

                  {/* Nedlasting */}
                  <div className="mt-4">
                    <button
                      onClick={handleLastNed}
                      className="flex items-center gap-2 px-5 py-2.5 bg-[#C9A57A] text-white rounded-lg text-sm font-medium hover:bg-[#b8925f] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Last ned SVG
                    </button>
                    <p className="text-xs text-stone-400 mt-2">
                      Filen lastes ned til nedlastingsmappen. Kalibreringsruten i mønsteret skal måle 5 cm ved projisering.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Måldiagram-overlegg ─────────────────────────────────────────────── */}
      {diagramOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setDiagramOpen(false)}
        >
          <div
            className="relative max-w-3xl w-full max-h-[90vh] overflow-auto bg-white rounded-2xl p-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-serif text-lg text-stone-700">Aldrichs måldiagram</h3>
              <button
                onClick={() => setDiagramOpen(false)}
                className="text-stone-400 hover:text-stone-600 transition-colors"
                aria-label="Lukk"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-stone-400 mb-3">
              Bokstavene i diagrammet svarer til «bokstav»-feltet ved hvert målfelt.
            </p>
            <Image
              src="/monster/Body_measurement_method.png"
              alt="Aldrichs måldiagram"
              width={800}
              height={600}
              className="w-full h-auto rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  )
}
