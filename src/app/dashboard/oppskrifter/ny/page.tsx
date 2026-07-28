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
import { tilSvg, lastNed, plasser } from '@/lib/monster/generator'
import {
  konstruer as konstruerBukse, valider as validerBukse, tilDel as tilDelBukse,
  type Passform,
} from '@/lib/monster/bukseblokk'
import {
  konstruer as konstruerBaby, valider as validerBaby,
  del as delBaby, ermDel as ermDelBaby, sjekkHode as sjekkHodeBaby,
  VID_HALS,
  type BabyVariant, type Stoff as BabyStoff,
} from '@/lib/monster/babyblokk'
import {
  konstruer as konstruerT, valider as validerT,
  kroppsDel, ermDel as ermDelT, sjekkHode as sjekkHodeT,
  type TVariant,
} from '@/lib/monster/tskjorte'
import {
  konstruer as konstruerKropp, valider as validerKropp,
  del as delKropp, ermDel as ermDelKropp,
  type Blokktype,
} from '@/lib/monster/kroppsblokk'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maalFiltrert(type: 'barn' | 'voksen'): MaalDef[] {
  return MAAL.filter(m => m.gjelder === type || m.gjelder === 'begge')
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
    const v = maal[id]; return v !== undefined && !isNaN(v)
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

function MaalFelt({ def, value, onChange }: { def: MaalDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <label className="text-xs font-semibold text-stone-600">{def.navn}</label>
        {def.bokstav && (
          <Badge label={def.bokstav} cls="bg-[#F5EFE6] text-[#8B6340] border-[#D4A574] font-mono text-[10px]" />
        )}
        <span className="text-xs text-stone-400">{def.engelsk}</span>
      </div>
      <p className="text-xs text-stone-400 mb-1.5 leading-relaxed">{def.slik}</p>
      <div className="flex items-center gap-2">
        <input
          type="number" step="0.1" min="0"
          value={value} onChange={e => onChange(e.target.value)}
          placeholder="cm"
          className="w-28 px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
        />
        <span className="text-xs text-stone-400">cm</span>
      </div>
    </div>
  )
}

function ToggleKnapper<T extends string>({
  options, value, onChange, label,
}: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div>
      {label && <label className={labelCls}>{label}</label>}
      <div className="flex gap-2">
        {options.map(o => (
          <button key={o.v} onClick={() => onChange(o.v)}
            className={`flex-1 py-2 rounded-lg border text-sm transition-all ${
              value === o.v
                ? 'border-[#C9A57A] bg-[#F5EFE6] text-[#8B6340] font-medium'
                : 'border-stone-200 text-stone-500 hover:border-stone-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NyOppskriftPage() {
  // ── Top mode ─────────────────────────────────────────────────────────────
  const [topMode, setTopMode] = useState<'profil' | 'standard'>('profil')

  // Standard mode extra
  const [stdType, setStdType] = useState<'barn' | 'voksen'>('barn')
  const [stdKjonn, setStdKjonn] = useState<'jente' | 'gutt'>('jente')

  // Profile mode
  const [profiles, setProfiles] = useState<ProfilRow[]>([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [selectedProfilId, setSelectedProfilId] = useState<string | null>(null)
  const [showNyProfil, setShowNyProfil] = useState(false)
  const [nyDraft, setNyDraft] = useState<NyProfilDraft>({
    navn: '', type: 'barn', kjonn: 'jente', hoyde_cm: '', maal: {},
  })
  const [savingProfil, setSavingProfil] = useState(false)
  const [savingProfilError, setSavingProfilError] = useState<string | null>(null)

  // Measurement source (profil mode)
  const [maalKilde, setMaalKilde] = useState<'personlig' | 'standard'>('personlig')
  const [stdRad, setStdRad] = useState<StandardRad | null>(null)

  // Block
  const [selectedBlokkId, setSelectedBlokkId] = useState<string | null>(null)
  const [sommonnCm, setSommonnCm] = useState<number>(1)
  // Av som standard — dette er et verktøy for å måle mønsteret mot boka med
  // målebånd via projektor, ikke noe som skal med på et klippeklart ark.
  const [visPunkter, setVisPunkter] = useState(false)
  const [inlineMaal, setInlineMaal] = useState<Record<string, string>>({})
  const [savingInline, setSavingInline] = useState(false)

  // Block-specific options
  const [passform, setPassform] = useState<Passform>('basis')
  const [babyStoff, setBabyStoff] = useState<BabyStoff>('jersey')
  const [babyVariant, setBabyVariant] = useState<BabyVariant>('basis')
  const [babyVidHals, setBabyVidHals] = useState(false)
  const [babyFerdigLengde, setBabyFerdigLengde] = useState('')
  const [tVariant, setTVariant] = useState<TVariant>('basis')
  const [tFerdigLengde, setTFerdigLengde] = useState('')
  const [kroppBlokktype, setKroppBlokktype] = useState<Blokktype>('kropp')
  const [kroppJersey, setKroppJersey] = useState(false)
  const [kroppTilHofte, setKroppTilHofte] = useState(true)

  // Generation
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [validerFeil, setValiderFeil] = useState<string[]>([])
  const [hodeAdvarsel, setHodeAdvarsel] = useState<string | null>(null)
  const [diagramOpen, setDiagramOpen] = useState(false)
  const [diagramSide, setDiagramSide] = useState<'barn' | 'voksen'>('barn')

  // Drive upload
  const [driveStatus, setDriveStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [driveLink, setDriveLink] = useState<string | null>(null)
  const [driveError, setDriveError] = useState<string | null>(null)

  // Size-filter message (shown when selected block becomes invalid after size change)
  const [stoerrelseMsg, setStoerrelseMsg] = useState<string | null>(null)

  // Reference image overlay
  const [refOpen, setRefOpen] = useState(false)
  const [refImages, setRefImages] = useState<string[]>([])

  // ── Computed ──────────────────────────────────────────────────────────────

  const selectedProfil = useMemo(
    () => profiles.find(p => p.id === selectedProfilId) ?? null,
    [profiles, selectedProfilId],
  )

  const effectiveType = useMemo(
    () => topMode === 'standard' ? stdType : (selectedProfil?.type ?? null),
    [topMode, stdType, selectedProfil],
  )

  const effectiveKjonn = useMemo(() => {
    if (topMode === 'standard') return stdType === 'voksen' ? 'dame' : stdKjonn
    return selectedProfil?.kjonn ?? null
  }, [topMode, stdType, stdKjonn, selectedProfil])

  const barnStdOptions = useMemo(() => {
    const kj = topMode === 'standard' ? stdKjonn : (selectedProfil?.kjonn === 'gutt' ? 'gutt' : 'jente')
    return stoerrelserFor(kj)
  }, [topMode, stdKjonn, selectedProfil])

  const dameStdOptions = useMemo(() => damestoerrelser(), [])

  const effectiveHoeyde = useMemo(() => {
    if (stdRad) return Number(stdRad.nokkel)
    return selectedProfil?.hoyde_cm ?? 0
  }, [stdRad, selectedProfil])

  const filteredBlokker = useMemo(() => {
    if (topMode === 'standard' && !stdRad) return []
    if (topMode === 'profil' && !selectedProfil) return []
    const type = effectiveType
    const kjonn = effectiveKjonn
    if (!type) return []
    return BLOKKER.filter(b => {
      if (b.status !== 'verifisert') return false
      if (type === 'voksen') return b.malgruppe === 'dame'
      if (b.malgruppe === 'dame') return false
      if (b.malgruppe === 'ungjente' && kjonn !== 'jente') return false
      if (b.minStr !== null && b.maksStr !== null && effectiveHoeyde > 0) {
        if (effectiveHoeyde < b.minStr || effectiveHoeyde > b.maksStr) return false
      }
      return true
    })
  }, [topMode, stdRad, selectedProfil, effectiveType, effectiveKjonn, effectiveHoeyde])

  const selectedBlokk = useMemo(
    () => BLOKKER.find(b => b.id === selectedBlokkId) ?? null,
    [selectedBlokkId],
  )

  const resolvedMaal = useMemo(() => {
    if (topMode === 'standard') return resolvedMaalFra(null, 'standard', stdRad, inlineMaal)
    return resolvedMaalFra(selectedProfil, maalKilde, stdRad, inlineMaal)
  }, [topMode, stdRad, selectedProfil, maalKilde, inlineMaal])

  const missingMaal = useMemo(() => {
    if (!selectedBlokk) return []
    return selectedBlokk.maal.filter(id => {
      const v = resolvedMaal[id]; return v === undefined || isNaN(v as number)
    })
  }, [selectedBlokk, resolvedMaal])

  const dekPersonlig = useMemo(() => {
    if (!selectedBlokk || !selectedProfil) return { har: 0, total: 0 }
    const pm: Record<string, number | undefined> = { ...selectedProfil.maal }
    for (const [k, v] of Object.entries(inlineMaal)) {
      const n = parseFloat(v); if (!isNaN(n) && n > 0) pm[k] = n
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

  const hoydeCm = useMemo(() => {
    if (topMode === 'standard' && stdRad) return Number(stdRad.nokkel)
    if (maalKilde === 'standard' && stdRad) return Number(stdRad.nokkel)
    if (selectedProfil?.hoyde_cm) return selectedProfil.hoyde_cm
    const h = resolvedMaal['hoeyde']; return h ?? 104
  }, [topMode, stdRad, maalKilde, selectedProfil, resolvedMaal])

  const needsFerdigLengde = selectedBlokk?.id === 'baby-kropp' || selectedBlokk?.id === 'barn-tskjorte'
  const ferdigLengdeVal = selectedBlokk?.id === 'baby-kropp' ? babyFerdigLengde : tFerdigLengde
  // Empty field uses the formula default — no longer blocks generation
  const ferdigLengdeOk = true

  const suggestedFerdigLengde = useMemo(() => {
    if (!selectedBlokk?.plaggmaal?.ferdigLengde) return null
    const fl = selectedBlokk.plaggmaal.ferdigLengde(resolvedMaal as Record<string, number>)
    return isNaN(fl) || fl <= 0 ? null : fl
  }, [selectedBlokk, resolvedMaal])

  const isSteg1Complete = topMode === 'standard' ? stdRad !== null : selectedProfil !== null

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    supabase.from('profiler').select('*').order('opprettet', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (!error && data) setProfiles(data as ProfilRow[])
        setLoadingProfiles(false)
      })
    return () => { cancelled = true }
  }, [])

  // Auto-select std size for profil mode when profile changes
  useEffect(() => {
    if (topMode !== 'profil' || !selectedProfil) { setStdRad(null); return }
    if (selectedProfil.type === 'barn') {
      const kj = selectedProfil.kjonn === 'gutt' ? 'gutt' : 'jente'
      const rad = selectedProfil.hoyde_cm
        ? naermesteStoerrelse(selectedProfil.hoyde_cm, kj)
        : stoerrelserFor(kj)[0]
      setStdRad(rad ?? null)
    } else {
      const byste = selectedProfil.maal?.bryst
      const rad = byste ? naermesteDame(byste) : dameStdOptions[0]
      setStdRad(rad ?? null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfilId, topMode])

  // Reset block + SVG when step 1 changes
  useEffect(() => {
    setSelectedBlokkId(null); setSvgContent(null); setValiderFeil([]); setInlineMaal({})
    setHodeAdvarsel(null); setDriveStatus('idle'); setDriveLink(null); setDriveError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfilId, topMode, stdRad])

  // Reset SVG when generation inputs change
  useEffect(() => {
    setSvgContent(null); setValiderFeil([]); setHodeAdvarsel(null)
    setDriveStatus('idle'); setDriveLink(null); setDriveError(null)
  }, [selectedBlokkId, passform, babyStoff, babyVariant, babyVidHals, tVariant, kroppBlokktype, kroppJersey, kroppTilHofte, sommonnCm, visPunkter, maalKilde])

  // Sync diagram side with effective type
  useEffect(() => {
    if (effectiveType) setDiagramSide(effectiveType)
  }, [effectiveType])

  // Auto-reset block when it's no longer valid for the selected size
  useEffect(() => {
    if (!selectedBlokkId) { setStoerrelseMsg(null); return }
    if (!filteredBlokker.find(b => b.id === selectedBlokkId)) {
      const prevBlokk = BLOKKER.find(b => b.id === selectedBlokkId)
      if (prevBlokk) setStoerrelseMsg(`«${prevBlokk.navn}» (${prevBlokk.stroelse}) er ikke tilgjengelig for valgt størrelse.`)
      resetBlock()
    } else {
      setStoerrelseMsg(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredBlokker])

  // Pre-fill ferdigLengde from plaggmaal formula
  useEffect(() => {
    if (!selectedBlokk?.plaggmaal?.ferdigLengde) return
    const fl = selectedBlokk.plaggmaal.ferdigLengde(resolvedMaal as Record<string, number>)
    if (!isNaN(fl) && fl > 0) {
      if (selectedBlokk.id === 'baby-kropp' || selectedBlokk.id === 'baby-yttertoy') {
        setBabyFerdigLengde(prev => prev || fl.toFixed(1))
      } else if (selectedBlokk.id === 'barn-tskjorte') {
        setTFerdigLengde(prev => prev || fl.toFixed(1))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBlokkId, stdRad])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function resetBlock() {
    setSelectedBlokkId(null); setSvgContent(null); setValiderFeil([]); setInlineMaal({})
    setHodeAdvarsel(null); setDriveStatus('idle'); setDriveLink(null); setDriveError(null)
  }

  const handleNyProfilSave = useCallback(async () => {
    if (!nyDraft.navn.trim()) return
    setSavingProfil(true); setSavingProfilError(null)
    const maalParsed: Record<string, number> = {}
    for (const [k, v] of Object.entries(nyDraft.maal)) {
      const n = parseFloat(v); if (!isNaN(n) && n > 0) maalParsed[k] = n
    }
    const { data, error } = await supabase.from('profiler').insert({
      navn: nyDraft.navn.trim(), type: nyDraft.type,
      kjonn: nyDraft.kjonn || null,
      hoyde_cm: nyDraft.hoyde_cm ? parseFloat(nyDraft.hoyde_cm) : null,
      maal: maalParsed,
    }).select().single()
    setSavingProfil(false)
    if (error) { setSavingProfilError(error.message); return }
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
      const n = parseFloat(v); if (!isNaN(n) && n > 0) toAdd[k] = n
    }
    if (!Object.keys(toAdd).length) return
    setSavingInline(true)
    const updatedMaal = { ...selectedProfil.maal, ...toAdd }
    const { error } = await supabase.from('profiler')
      .update({ maal: updatedMaal, oppdatert: new Date().toISOString() })
      .eq('id', selectedProfil.id)
    setSavingInline(false)
    if (!error) {
      setProfiles(prev => prev.map(p => p.id === selectedProfil.id ? { ...p, maal: updatedMaal } : p))
      setInlineMaal({})
    }
  }, [selectedProfil, inlineMaal])

  const handleGenerer = useCallback(() => {
    if (!selectedBlokk) return

    const m = resolvedMaal
    const navnStr = topMode === 'profil' ? (selectedProfil?.navn ?? '') : `str. ${stdRad?.nokkel ?? ''}`
    const dato = new Date().toISOString().slice(0, 10)
    const undertekst = `${selectedBlokk.navn} · ${navnStr} · ${dato}`
    let hodeMsg: string | null = null

    // Resolve ferdig lengde: use field value if provided, else formula default
    const resolvedFl = (feltVal: string, blokk: typeof selectedBlokk) => {
      const v = parseFloat(feltVal)
      if (!isNaN(v) && v > 0) return v
      return blokk.plaggmaal?.ferdigLengde?.(m as Record<string, number>) ?? 0
    }

    try {
      if (selectedBlokk.id === 'barn-bukse-1') {
        const k = konstruerBukse(
          { hoydeCm, hofte: m['hofte']!, skrittdybde: m['skrittdybde']!, innsideBen: m['innsideBen']! },
          passform,
        )
        const feil = validerBukse(k)
        if (feil.length) { setValiderFeil(feil); setSvgContent(null); return }
        const svg = tilSvg([tilDelBukse(k)], { sommonnCm, undertekst, visPunkter })
        setSvgContent(svg)

      } else if (selectedBlokk.id === 'baby-kropp') {
        const fl = resolvedFl(babyFerdigLengde, selectedBlokk)
        const k = konstruerBaby(
          {
            bryst: m['bryst']!, ryggbredde: m['ryggbredde']!, halsvidde: m['halsvidde']!,
            skulder: m['skulder']!, ermegapDybde: m['ermegapDybde']!,
            nakkeTilMidje: m['nakkeTilMidje']!, ermelengde: m['ermelengde']!,
            haandledd: m['haandledd']!, ferdigLengde: fl,
          },
          babyVariant, babyStoff, babyVidHals ? VID_HALS : null,
        )
        const feil = validerBaby(k)
        if (feil.length) { setValiderFeil(feil); setSvgContent(null); return }

        const hode = m['hodeomkrets']
        if (hode) {
          const res = sjekkHodeBaby(k, hode)
          if (!res.ok) hodeMsg = res.melding
        }

        const deler = plasser([delBaby(k, 'bak'), delBaby(k, 'front'), ermDelBaby(k)])
        setSvgContent(tilSvg(deler, { sommonnCm, undertekst, visPunkter }))

      } else if (selectedBlokk.id === 'barn-tskjorte') {
        const fl = resolvedFl(tFerdigLengde, selectedBlokk)
        // Bok s.48: P[1] = nakkeTilMidje + 3 — advar om lengden er kortere
        const minLengde = (m['nakkeTilMidje'] ?? 0) + 3
        if (fl < minLengde) {
          setValiderFeil([`Ferdig lengde (${fl} cm) er kortere enn bokas nedre grense (${minLengde.toFixed(1)} cm = nakke til midje + 3).`])
          setSvgContent(null); return
        }
        const k = konstruerT(
          {
            hoydeCm, bryst: m['bryst']!, ryggbredde: m['ryggbredde']!, halsvidde: m['halsvidde']!,
            ermegapDybde: m['ermegapDybde']!, nakkeTilMidje: m['nakkeTilMidje']!,
            ermelengde: m['ermelengde']!, haandledd: m['haandledd']!, ferdigLengde: fl,
          },
          tVariant,
        )
        const feil = validerT(k)
        if (feil.length) { setValiderFeil(feil); setSvgContent(null); return }

        const hode = m['hodeomkrets']
        if (hode) {
          const res = sjekkHodeT(k, hode)
          if (!res.ok) hodeMsg = res.melding
        }

        const deler = plasser([kroppsDel(k), ermDelT(k)])
        setSvgContent(tilSvg(deler, { sommonnCm, undertekst, visPunkter }))

      } else if (selectedBlokk.id === 'barn-kropp') {
        const k = konstruerKropp(
          {
            hoydeCm, bryst: m['bryst']!, ryggbredde: m['ryggbredde']!, halsvidde: m['halsvidde']!,
            skulder: m['skulder']!, ermegapDybde: m['ermegapDybde']!,
            nakkeTilMidje: m['nakkeTilMidje']!, midjeTilHofte: m['midjeTilHofte']!,
            ermelengde: m['ermelengde']!, jersey: kroppJersey,
          },
          kroppBlokktype,
        )
        const feil = validerKropp(k)
        if (feil.length) { setValiderFeil(feil); setSvgContent(null); return }

        const deler = plasser([
          delKropp(k, 'bak', kroppTilHofte),
          delKropp(k, 'front', kroppTilHofte),
          ermDelKropp(k),
        ])
        setSvgContent(tilSvg(deler, { sommonnCm, undertekst, visPunkter }))

      } else {
        setValiderFeil([`Blokken «${selectedBlokk.id}» er ikke implementert ennå.`])
        setSvgContent(null); return
      }

      setValiderFeil([])
      setHodeAdvarsel(hodeMsg)
      setDriveStatus('idle'); setDriveLink(null); setDriveError(null)

    } catch (e) {
      setValiderFeil([e instanceof Error ? e.message : String(e)])
      setSvgContent(null)
    }
  }, [
    selectedBlokk, resolvedMaal, ferdigLengdeOk, topMode, selectedProfil, stdRad,
    hoydeCm, passform, babyVariant, babyStoff, babyVidHals, babyFerdigLengde,
    tVariant, tFerdigLengde, kroppBlokktype, kroppJersey, kroppTilHofte, sommonnCm, visPunkter,
  ])

  const svgFilnavn = useCallback(() => {
    if (!selectedBlokk) return 'monster.svg'
    const dato = new Date().toISOString().slice(0, 10)
    const plagNavn = selectedBlokk.id.replace(/^(barn|dame|baby)-/, '').replace(/-\d+$/, '')
    const navnStr = topMode === 'profil'
      ? (selectedProfil?.navn ?? 'profil').toLowerCase().normalize('NFD')
          .replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      : `str${stdRad?.nokkel ?? ''}`
    return `${plagNavn}-${navnStr}-${dato}.svg`
  }, [selectedBlokk, topMode, selectedProfil, stdRad])

  const handleLastNed = useCallback(() => {
    if (!svgContent || !selectedBlokk) return
    lastNed(svgContent, svgFilnavn())
  }, [svgContent, selectedBlokk, svgFilnavn])

  const handleLagreDrive = useCallback(async () => {
    if (!svgContent || !selectedBlokk) return
    const filnavn = svgFilnavn()
    setDriveStatus('uploading'); setDriveLink(null); setDriveError(null)
    try {
      const blob = new Blob([svgContent], { type: 'image/svg+xml' })
      const fil = new File([blob], filnavn, { type: 'image/svg+xml' })
      const fd = new FormData()
      fd.append('file', fil, filnavn)
      fd.append('folderName', 'Egne oppskrifter')
      const res = await fetch('/api/drive/upload', { method: 'POST', body: fd })
      const json = await res.json() as { fileId?: string; webViewLink?: string; error?: string }
      if (!res.ok || json.error) {
        setDriveStatus('error')
        setDriveError(json.error ?? 'Opplasting mislyktes')
      } else {
        setDriveStatus('done')
        setDriveLink(json.webViewLink ?? null)
      }
    } catch (e) {
      setDriveStatus('error')
      setDriveError(e instanceof Error ? e.message : 'Nettverksfeil')
    }
  }, [svgContent, selectedBlokk, svgFilnavn])

  const nyProfilMaalDefs = useMemo(() => maalFiltrert(nyDraft.type), [nyDraft.type])

  // ─────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F4' }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">

        {/* ── Topp-nav ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/dashboard/recipes"
            className="flex items-center gap-1 text-sm text-stone-400 hover:text-stone-600 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
            Oppskrifter
          </Link>
          <span className="text-stone-300">/</span>
          <span className="text-sm text-stone-600 font-medium">Ny oppskrift fra mønster</span>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            STEG 1 — HVEM
        ═══════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SeksjonOverskrift>1 — Hvem skal plagget til?</SeksjonOverskrift>

          {/* Mode toggle */}
          <div className="flex gap-2 mb-6">
            {([
              { v: 'profil', label: 'Egen profil' },
              { v: 'standard', label: 'Standardstørrelse' },
            ] as const).map(o => (
              <button key={o.v}
                onClick={() => { setTopMode(o.v); resetBlock() }}
                className={`flex-1 py-2.5 rounded-xl border text-sm transition-all font-medium ${
                  topMode === o.v
                    ? 'border-[#C9A57A] bg-[#F5EFE6] text-[#8B6340]'
                    : 'border-stone-200 text-stone-500 hover:border-stone-300 bg-white'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* ── Standardstørrelse ────────────────────────────────────── */}
          {topMode === 'standard' && (
            <div className="bg-white rounded-xl border border-stone-200 p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <ToggleKnapper
                  label="Type"
                  options={[{ v: 'barn', label: 'Barn' }, { v: 'voksen', label: 'Voksen' }]}
                  value={stdType}
                  onChange={v => { setStdType(v); setStdRad(null); resetBlock() }}
                />
                {stdType === 'barn' && (
                  <ToggleKnapper
                    label="Kjønn"
                    options={[{ v: 'jente', label: 'Jente' }, { v: 'gutt', label: 'Gutt' }]}
                    value={stdKjonn}
                    onChange={v => { setStdKjonn(v); setStdRad(null); resetBlock() }}
                  />
                )}
              </div>

              {stdType === 'barn' && (
                <>
                  <label className={labelCls}>Størrelse</label>
                  <select
                    value={stdRad ? `${stdRad.kjonn ?? 'unisex'}-${stdRad.nokkel}` : ''}
                    onChange={e => {
                      const key = e.target.value
                      setStdRad(barnStdOptions.find(r => `${r.kjonn ?? 'unisex'}-${r.nokkel}` === key) ?? null)
                    }}
                    className={inputCls}
                  >
                    <option value="">— velg størrelse —</option>
                    {barnStdOptions.map(r => (
                      <option key={`${r.kjonn ?? 'unisex'}-${r.nokkel}`}
                        value={`${r.kjonn ?? 'unisex'}-${r.nokkel}`}>
                        {r.nokkel} cm{r.alder ? ` — ${r.alder}` : ''}{r.kjonn === 'unisex' ? ' (unisex)' : ''}{r.vektKg ? ` · ${r.vektKg} kg` : ''}
                      </option>
                    ))}
                  </select>
                  {stdRad?.kjonn === 'unisex' && (
                    <p className="text-xs text-stone-500 mt-1.5 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5 flex-shrink-0 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Benytter unisex babytabell (str. {stdRad.nokkel})
                    </p>
                  )}
                </>
              )}

              {stdType === 'voksen' && (
                <>
                  <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Tabellen gjelder kvinner 160–172 cm. Justering for andre høyder er ikke lagt inn.
                  </p>
                  <label className={labelCls}>Størrelse</label>
                  <select
                    value={stdRad ? `dame-${stdRad.nokkel}` : ''}
                    onChange={e => {
                      const key = e.target.value
                      setStdRad(dameStdOptions.find(r => `dame-${r.nokkel}` === key) ?? null)
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
                </>
              )}

              {stdRad && (
                <p className="text-xs text-stone-400 italic mt-2">Kilde: {stdRad.kilde}</p>
              )}
            </div>
          )}

          {/* ── Profil-modus ─────────────────────────────────────────── */}
          {topMode === 'profil' && (
            <>
              {loadingProfiles ? (
                <div className="flex items-center gap-2 text-stone-400 text-sm py-4">
                  <Spinner /> Laster profiler…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    {profiles.map(p => (
                      <button key={p.id} onClick={() => { setSelectedProfilId(prev => prev === p.id ? null : p.id); setShowNyProfil(false) }}
                        className={`text-left p-3 rounded-xl border transition-all ${
                          selectedProfilId === p.id
                            ? 'border-[#C9A57A] bg-[#F5EFE6] shadow-sm'
                            : 'border-stone-200 bg-white hover:border-stone-300'
                        }`}
                      >
                        <p className="font-medium text-stone-800 text-sm">{p.navn}</p>
                        <p className="text-xs text-stone-400 mt-0.5">
                          {p.type === 'barn' ? 'Barn' : 'Voksen'}{p.kjonn ? ` · ${p.kjonn}` : ''}{p.hoyde_cm ? ` · ${p.hoyde_cm} cm` : ''}
                        </p>
                      </button>
                    ))}
                    <button
                      onClick={() => { setShowNyProfil(o => !o); setSelectedProfilId(null) }}
                      className={`text-left p-3 rounded-xl border-2 border-dashed transition-all ${
                        showNyProfil ? 'border-[#C9A57A] bg-[#F5EFE6]' : 'border-stone-200 hover:border-stone-300 bg-white'
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

                  {/* Ny profil form */}
                  {showNyProfil && (
                    <div className="bg-white rounded-xl border border-stone-200 p-5 mb-6">
                      <h3 className="font-medium text-stone-700 mb-5">Ny profil</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                        <div>
                          <label className={labelCls}>Navn</label>
                          <input type="text" value={nyDraft.navn}
                            onChange={e => setNyDraft(d => ({ ...d, navn: e.target.value }))}
                            placeholder="f.eks. Ellinor" className={inputCls} />
                        </div>
                        <ToggleKnapper
                          label="Type"
                          options={[{ v: 'barn', label: 'Barn' }, { v: 'voksen', label: 'Voksen' }]}
                          value={nyDraft.type}
                          onChange={v => setNyDraft(d => ({ ...d, type: v, kjonn: v === 'voksen' ? 'dame' : 'jente', maal: {} }))}
                        />
                        {nyDraft.type === 'barn' && (
                          <>
                            <ToggleKnapper
                              label="Kjønn"
                              options={[{ v: 'jente', label: 'Jente' }, { v: 'gutt', label: 'Gutt' }]}
                              value={nyDraft.kjonn as 'jente' | 'gutt'}
                              onChange={v => setNyDraft(d => ({ ...d, kjonn: v }))}
                            />
                            <div>
                              <label className={labelCls}>Høyde (cm)</label>
                              <input type="number" step="1" min="40" max="200"
                                value={nyDraft.hoyde_cm}
                                onChange={e => setNyDraft(d => ({ ...d, hoyde_cm: e.target.value }))}
                                placeholder="f.eks. 104" className={inputCls} />
                              <p className="text-xs text-stone-400 mt-1">Brukes til å forhåndsvelge standardstørrelse</p>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Målfelter */}
                      <div className="border-t border-stone-100 pt-4 mb-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-semibold tracking-widest uppercase text-stone-400">
                            Mål ({nyProfilMaalDefs.length} felt)
                          </p>
                          <button onClick={() => setDiagramOpen(true)}
                            className="text-xs text-[#8B6340] hover:underline">
                            Vis måldiagram
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                          {nyProfilMaalDefs.map(def => (
                            <MaalFelt key={def.id} def={def}
                              value={nyDraft.maal[def.id] ?? ''}
                              onChange={v => setNyDraft(d => ({ ...d, maal: { ...d.maal, [def.id]: v } }))} />
                          ))}
                        </div>
                      </div>

                      {savingProfilError && <p className="text-xs text-red-600 mb-3">{savingProfilError}</p>}
                      <div className="flex items-center gap-3">
                        <button onClick={handleNyProfilSave} disabled={!nyDraft.navn.trim() || savingProfil}
                          className="flex items-center gap-2 px-4 py-2 bg-stone-700 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40">
                          {savingProfil && <Spinner />} Lagre profil
                        </button>
                        <button onClick={() => setShowNyProfil(false)}
                          className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 transition-colors">
                          Avbryt
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Målkilde */}
                  {selectedProfil && (
                    <div className="bg-white rounded-xl border border-stone-200 p-5">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm font-medium text-stone-700">
                          Mål for <span className="text-[#8B6340]">{selectedProfil.navn}</span>
                        </p>
                        <button onClick={() => setDiagramOpen(true)}
                          className="flex items-center gap-1 text-xs text-[#8B6340] hover:underline">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Vis måldiagram
                        </button>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 mb-4">
                        {(['personlig', 'standard'] as const).map(k => (
                          <label key={k} className={`flex-1 flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                            maalKilde === k ? 'border-[#C9A57A] bg-[#F5EFE6]' : 'border-stone-200 hover:border-stone-300'
                          }`}>
                            <input type="radio" name="maalKilde" value={k} checked={maalKilde === k}
                              onChange={() => setMaalKilde(k)} className="mt-0.5 accent-[#C9A57A]" />
                            <div>
                              <p className="text-sm font-medium text-stone-700">
                                {k === 'personlig' ? 'Personlige mål' : 'Standardmål'}
                              </p>
                              {selectedBlokk ? (
                                <p className="text-xs text-stone-400 mt-0.5">
                                  {k === 'personlig'
                                    ? `${dekPersonlig.har} av ${dekPersonlig.total} registrert`
                                    : stdRad ? `${dekStandard.har} av ${dekStandard.total} dekket` : 'Velg størrelse nedenfor'}
                                </p>
                              ) : (
                                <p className="text-xs text-stone-400 mt-0.5">
                                  {k === 'personlig'
                                    ? `${Object.keys(selectedProfil.maal).length} mål lagret`
                                    : 'Velg størrelse nedenfor'}
                                </p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>

                      {maalKilde === 'standard' && (
                        <div className="pt-4 border-t border-stone-100">
                          {selectedProfil.type === 'barn' ? (
                            <>
                              <label className={labelCls}>Standardstørrelse (barn)</label>
                              <select
                                value={stdRad ? `${stdRad.kjonn ?? 'unisex'}-${stdRad.nokkel}` : ''}
                                onChange={e => {
                                  const key = e.target.value
                                  setStdRad(barnStdOptions.find(r => `${r.kjonn ?? 'unisex'}-${r.nokkel}` === key) ?? null)
                                }}
                                className={inputCls}
                              >
                                <option value="">— velg størrelse —</option>
                                {barnStdOptions.map(r => (
                                  <option key={`${r.kjonn ?? 'unisex'}-${r.nokkel}`}
                                    value={`${r.kjonn ?? 'unisex'}-${r.nokkel}`}>
                                    {r.nokkel} cm{r.alder ? ` — ${r.alder}` : ''}{r.kjonn === 'unisex' ? ' (unisex)' : ''}
                                  </option>
                                ))}
                              </select>
                              {stdRad?.kjonn === 'unisex' && (
                                <p className="text-xs text-stone-500 mt-1.5">Benytter unisex babytabell (str. {stdRad.nokkel})</p>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-amber-600 mb-2">
                                Tabellen gjelder kvinner 160–172 cm.
                              </p>
                              <label className={labelCls}>Standardstørrelse (dame)</label>
                              <select
                                value={stdRad ? `dame-${stdRad.nokkel}` : ''}
                                onChange={e => {
                                  const key = e.target.value
                                  setStdRad(dameStdOptions.find(r => `dame-${r.nokkel}` === key) ?? null)
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
                            </>
                          )}
                          {stdRad && (
                            <p className="text-xs text-stone-400 italic mt-2">Kilde: {stdRad.kilde}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            STEG 2 — HVA
        ═══════════════════════════════════════════════════════════════ */}
        <section className="mb-10">
          <SeksjonOverskrift>2 — Hva skal lages?</SeksjonOverskrift>

          {!isSteg1Complete ? (
            <p className="text-sm text-stone-400 italic">
              {topMode === 'standard' ? 'Velg størrelse i steg 1 for å fortsette.' : 'Velg eller opprett en profil i steg 1 for å fortsette.'}
            </p>
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
                    resetBlock()
                    setSelectedBlokkId(e.target.value || null)
                  }}
                  className={inputCls}
                >
                  <option value="">— velg plagg —</option>
                  {filteredBlokker.map(b => (
                    <option key={b.id} value={b.id}>{b.navn}</option>
                  ))}
                </select>
              </div>

              {stoerrelseMsg && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
                  {stoerrelseMsg}
                </div>
              )}

              {selectedBlokk && (
                <>
                  {/* Blokkinfo */}
                  <div className="text-xs text-stone-400 space-y-1 bg-stone-50 rounded-lg p-3">
                    <p className="text-stone-500 font-medium">{selectedBlokk.undertittel}</p>
                    <p><span className="font-medium text-stone-500">Stoff:</span>{' '}
                      {selectedBlokk.stoff === 'jersey' ? 'Jersey' : selectedBlokk.stoff === 'vevd' ? 'Vevd' : 'Jersey eller vevd'}
                    </p>
                    <p><span className="font-medium text-stone-500">Størrelse:</span> {selectedBlokk.stroelse}</p>
                    {selectedBlokk.merknad && <p><span className="font-medium text-stone-500">Merknad:</span> {selectedBlokk.merknad}</p>}
                    <p>
                      <span className="font-medium text-stone-500">Krever:</span>{' '}
                      {selectedBlokk.maal.map(id => {
                        const def = MAAL.find(m => m.id === id)
                        const harMaal = resolvedMaal[id] !== undefined && !isNaN(resolvedMaal[id] as number)
                        return (
                          <span key={id} className={`inline-block mr-1 ${harMaal ? 'text-stone-500' : 'text-red-500 font-medium'}`}>
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
                          const erIkkeRegistrert = stdRad && !stdRad.maal[id]
                          return (
                            <div key={id} className="mb-4">
                              <div className="flex items-center gap-2 mb-1">
                                <label className="text-xs font-semibold text-stone-600">{def.navn}</label>
                                {def.bokstav && <Badge label={def.bokstav} cls="bg-[#F5EFE6] text-[#8B6340] border-[#D4A574] font-mono text-[10px]" />}
                              </div>
                              <p className="text-xs text-stone-400 mb-1.5 leading-relaxed">{def.slik}</p>
                              {erIkkeRegistrert ? (
                                <p className="text-xs text-stone-400 italic">ikke registrert i standardtabellen</p>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <input type="number" step="0.1" min="0"
                                    value={inlineMaal[id] ?? ''} placeholder="cm"
                                    onChange={e => setInlineMaal(prev => ({ ...prev, [id]: e.target.value }))}
                                    className="w-28 px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition" />
                                  <span className="text-xs text-stone-400">cm</span>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      {topMode === 'profil' && selectedProfil && Object.values(inlineMaal).some(v => parseFloat(v) > 0) && (
                        <button onClick={handleSaveInlineMaal} disabled={savingInline}
                          className="flex items-center gap-2 mt-2 px-3 py-1.5 text-xs bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-lg transition-colors disabled:opacity-40">
                          {savingInline && <Spinner />} Lagre mål til profil
                        </button>
                      )}
                    </div>
                  )}

                  {/* ── Blokkspesifikke valg ──────────────────────── */}

                  {/* Bukseblokk */}
                  {selectedBlokk.id === 'barn-bukse-1' && (
                    <ToggleKnapper
                      label="Passform"
                      options={[
                        { v: 'leggings', label: 'Leggings' },
                        { v: 'basis', label: 'Basis' },
                        { v: 'romslig', label: 'Romslig' },
                      ]}
                      value={passform}
                      onChange={setPassform}
                    />
                  )}

                  {/* Babyblokk */}
                  {selectedBlokk.id === 'baby-kropp' && (
                    <div className="space-y-4">
                      <ToggleKnapper
                        label="Stofftype"
                        options={[{ v: 'jersey', label: 'Jersey' }, { v: 'vevd', label: 'Vevd' }]}
                        value={babyStoff}
                        onChange={setBabyStoff}
                      />
                      <ToggleKnapper
                        label="Variant"
                        options={[{ v: 'basis', label: 'Basis' }, { v: 'romslig', label: 'Romslig' }]}
                        value={babyVariant}
                        onChange={setBabyVariant}
                      />
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={babyVidHals}
                            onChange={e => setBabyVidHals(e.target.checked)}
                            className="w-4 h-4 accent-[#C9A57A]" />
                          <span className="text-sm text-stone-700">
                            <button
                              type="button"
                              onClick={() => { setRefImages(['/pattern/skulderklaff.jpg']); setRefOpen(true) }}
                              className="underline underline-offset-2 text-[#8B6340] hover:text-[#6d4d2c] transition-colors"
                            >
                              Vid hals (bok s.38)
                            </button>
                          </span>
                        </label>
                      </div>
                      <div>
                        <label className={labelCls}>Ferdig lengde (cm)</label>
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.5" min="0"
                            value={babyFerdigLengde}
                            placeholder={suggestedFerdigLengde ? `${suggestedFerdigLengde.toFixed(1)} (forslag)` : 'cm'}
                            onChange={e => setBabyFerdigLengde(e.target.value)}
                            className="w-36 px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition" />
                          <span className="text-xs text-stone-400">cm fra nakke til fald</span>
                        </div>
                        <p className="text-xs text-stone-400 mt-1">Aldrich oppgir ingen standardlengde — fallet er et designvalg. Forslaget er utledet fra størrelsen.</p>
                      </div>
                    </div>
                  )}

                  {/* T-skjorte */}
                  {selectedBlokk.id === 'barn-tskjorte' && (
                    <div className="space-y-4">
                      <ToggleKnapper
                        label="Variant"
                        options={[
                          { v: 'ribbet', label: 'Ribbet' },
                          { v: 'basis', label: 'Basis' },
                          { v: 'romslig', label: 'Romslig' },
                        ]}
                        value={tVariant}
                        onChange={setTVariant}
                      />
                      <div>
                        <label className={labelCls}>Ferdig lengde (cm)</label>
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.5" min="0"
                            value={tFerdigLengde}
                            placeholder={suggestedFerdigLengde ? `${suggestedFerdigLengde.toFixed(1)} (forslag)` : 'cm'}
                            onChange={e => setTFerdigLengde(e.target.value)}
                            className="w-36 px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition" />
                          <span className="text-xs text-stone-400">cm fra nakke til fald</span>
                        </div>
                        <p className="text-xs text-stone-400 mt-1">Aldrich oppgir ingen standardlengde — fallet er et designvalg. Forslaget er utledet fra størrelsen.</p>
                      </div>
                    </div>
                  )}

                  {/* Kroppsblokk */}
                  {selectedBlokk.id === 'barn-kropp' && (
                    <div className="space-y-4">
                      <ToggleKnapper
                        label="Blokktype"
                        options={[{ v: 'kropp', label: 'Kroppsblokk' }, { v: 'skjorte', label: 'Skjorteblokk' }]}
                        value={kroppBlokktype}
                        onChange={setKroppBlokktype}
                      />
                      <ToggleKnapper
                        label="Lengde"
                        options={[{ v: true as unknown as string, label: 'Til hofte' }, { v: false as unknown as string, label: 'Til midje' }]}
                        value={String(kroppTilHofte)}
                        onChange={v => setKroppTilHofte(v === 'true')}
                      />
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={kroppJersey}
                            onChange={e => setKroppJersey(e.target.checked)}
                            className="w-4 h-4 accent-[#C9A57A]" />
                          <span className="text-sm text-stone-700">Jersey (forkorter ermet 3 cm)</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Sømmonn */}
                  <div>
                    <label className={labelCls}>Sømmonn</label>
                    <div className="flex items-center gap-3">
                      <input type="number" step="0.5" min="0" max="5"
                        value={sommonnCm}
                        onChange={e => setSommonnCm(parseFloat(e.target.value) || 0)}
                        className="w-24 px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition" />
                      <span className="text-sm text-stone-500">cm (0 = ingen sømmonn)</span>
                    </div>
                  </div>

                  {/* Verifiseringspunkter */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={visPunkter}
                        onChange={e => setVisPunkter(e.target.checked)}
                        className="w-4 h-4 accent-[#C9A57A]" />
                      <span className="text-sm text-stone-700">Vis konstruksjonspunkter (verifisering)</span>
                    </label>
                    <span className="text-xs text-stone-400">
                      Aldrichs egne punktnumre, til måling mot boka via projektor — ikke for et klippeklart ark
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════
            STEG 3 — GENERER
        ═══════════════════════════════════════════════════════════════ */}
        <section className="mb-16">
          <SeksjonOverskrift>3 — Generer mønster</SeksjonOverskrift>

          {!isSteg1Complete || !selectedBlokk ? (
            <p className="text-sm text-stone-400 italic">Fullfør steg 1 og 2 for å generere mønster.</p>
          ) : (
            <div className="space-y-5">
              <button
                onClick={handleGenerer}
                disabled={missingMaal.some(id =>
                  !stdRad?.maal[id] && !(inlineMaal[id] && parseFloat(inlineMaal[id]) > 0)
                )}
                className="flex items-center gap-2 px-5 py-2.5 bg-stone-700 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generer mønster
              </button>

              {validerFeil.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-red-700 mb-2">Kan ikke generere mønster:</p>
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

              {hodeAdvarsel && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-xs font-semibold text-amber-700 mb-1 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Halsåpningsadvarsel
                  </p>
                  <p className="text-xs text-amber-700">{hodeAdvarsel}</p>
                  <p className="text-xs text-amber-500 mt-1 italic">Strekkfaktoren er et anslag, ikke fra boka.</p>
                </div>
              )}

              {svgContent && (
                <div>
                  <p className="text-xs font-semibold tracking-widest uppercase text-stone-400 mb-3">Forhåndsvisning</p>
                  <div className="border border-stone-200 rounded-xl overflow-auto bg-white p-4 max-h-[70vh]"
                    dangerouslySetInnerHTML={{ __html: svgContent }} />
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <button onClick={handleLastNed}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#C9A57A] text-white rounded-lg text-sm font-medium hover:bg-[#b8925f] transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Last ned
                      </button>
                      <button
                        onClick={handleLagreDrive}
                        disabled={driveStatus === 'uploading'}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white border border-stone-200 text-stone-700 rounded-lg text-sm font-medium hover:border-stone-300 hover:bg-stone-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        {driveStatus === 'uploading' ? (
                          <><Spinner />Laster opp…</>
                        ) : (
                          <>
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6.28 3l5.72 9.9L17.72 3H6.28zM2 17.5L5.14 12h13.72L22 17.5H2zm4.06 0L8 21h8l1.94-3.5H6.06z"/>
                            </svg>
                            Lagre til Drive
                          </>
                        )}
                      </button>
                    </div>

                    {driveStatus === 'done' && driveLink && (
                      <div className="flex items-center gap-2 mt-3 text-sm text-emerald-700">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Lagret til Drive —{' '}
                        <a href={driveLink} target="_blank" rel="noopener noreferrer"
                          className="underline underline-offset-2 hover:text-emerald-900 transition-colors">
                          Åpne fila
                        </a>
                      </div>
                    )}
                    {driveStatus === 'done' && !driveLink && (
                      <p className="mt-3 text-sm text-emerald-700 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Lagret til Drive (Søm og Snitt / Egne oppskrifter)
                      </p>
                    )}
                    {driveStatus === 'error' && (
                      <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                        <p className="text-xs font-semibold text-red-700 mb-0.5">Drive-opplasting mislyktes</p>
                        <p className="text-xs text-red-600">{driveError}</p>
                        <p className="text-xs text-stone-400 mt-1">Du kan fortsatt laste ned fila lokalt.</p>
                      </div>
                    )}
                    <p className="text-xs text-stone-400 mt-2">
                      Kalibreringsruten i mønsteret skal måle 5 cm ved projisering.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Måldiagram-overlegg ──────────────────────────────────────────────── */}
      {diagramOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setDiagramOpen(false)}>
          <div className="relative max-w-3xl w-full max-h-[90vh] overflow-auto bg-white rounded-2xl p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-serif text-lg text-stone-700">
                {diagramSide === 'barn' ? 'Måldiagram — barn 0–14 år' : 'Måldiagram — dame'}
              </h3>
              <button onClick={() => setDiagramOpen(false)} aria-label="Lukk"
                className="text-stone-400 hover:text-stone-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-stone-400 mb-3">Bokstavene svarer til merkelappene ved målfeltene.</p>

            {/* Bytt mellom diagrammer */}
            <div className="flex gap-2 mb-4">
              {(['barn', 'voksen'] as const).map(s => (
                <button key={s} onClick={() => setDiagramSide(s)}
                  className={`px-3 py-1 rounded-lg text-xs border transition-all ${
                    diagramSide === s ? 'border-[#C9A57A] bg-[#F5EFE6] text-[#8B6340] font-medium' : 'border-stone-200 text-stone-500'
                  }`}>
                  {s === 'barn' ? 'Barn' : 'Dame'}
                </button>
              ))}
            </div>

            <Image
              src={diagramSide === 'barn'
                ? '/monster/Body_measurement_method_child.png'
                : '/monster/Body_measurement_method_woman.png'}
              alt={diagramSide === 'barn' ? 'Måldiagram barn' : 'Måldiagram dame'}
              width={800} height={600}
              className="w-full h-auto rounded-lg"
            />
          </div>
        </div>
      )}

      {/* ── Referansebilde-overlegg ──────────────────────────────────────────── */}
      {refOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setRefOpen(false)}>
          <div className="relative max-w-2xl w-full max-h-[90vh] overflow-auto bg-white rounded-2xl p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-serif text-lg text-stone-700">Vid hals — referansefoto</h3>
              <button onClick={() => setRefOpen(false)} aria-label="Lukk"
                className="text-stone-400 hover:text-stone-600 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4">
              {refImages.map((src, i) => (
                <Image key={i} src={src} alt={`Referansebilde ${i + 1}`}
                  width={800} height={600} className="w-full h-auto rounded-lg" />
              ))}
            </div>
            <p className="text-xs text-stone-400 mt-3">Kilde: Aldrich, barneboka s.38. Skulderklaff er ikke implementert i generatoren ennå.</p>
          </div>
        </div>
      )}
    </div>
  )
}
