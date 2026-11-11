'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PROJECT_LIST_SELECT, STATUSES, STATUS_LABEL, type ProjectListRow, type ProjectStatus } from '../../_lib/projects'
import ProjectRecipePicker from '../../_components/ProjectRecipePicker'
import type { KnitRecipe } from '../../_lib/recipes'
import { coverUrl } from '../../_lib/cover'

const STATUS_STYLE: Record<ProjectStatus, string> = {
  planned: 'bg-amber-50 text-amber-700 border-amber-200',
  in_progress: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  done: 'bg-sky-50 text-sky-700 border-sky-200',
}

function statusFromQuery(v: string | null): ProjectStatus | null {
  return v && (STATUSES as readonly string[]).includes(v) ? v as ProjectStatus : null
}

async function createFromRecipe(recipe: KnitRecipe): Promise<ProjectListRow> {
  const res = await fetch('/api/strikk/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oppskriftId: recipe.id }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Oppretting feilet (${res.status})`)
  return body as ProjectListRow
}

async function createBlank(name: string): Promise<ProjectListRow> {
  const res = await fetch('/api/strikk/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Oppretting feilet (${res.status})`)
  return body as ProjectListRow
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageInner />
    </Suspense>
  )
}

// useSearchParams() krever en Suspense-grense, samme som på sy-siden.
function ProjectsPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [projects, setProjects] = useState<ProjectListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatusState] = useState<ProjectStatus>(() => statusFromQuery(searchParams.get('status')) ?? 'in_progress')
  const [newOpen, setNewOpen] = useState(false)

  useEffect(() => {
    const fromUrl = statusFromQuery(searchParams.get('status'))
    if (fromUrl && fromUrl !== status) setStatusState(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function setStatus(s: ProjectStatus) {
    setStatusState(s)
    router.replace(`${pathname}?status=${encodeURIComponent(s)}`)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('strikk_project').select(PROJECT_LIST_SELECT).order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setProjects((data ?? []) as unknown as ProjectListRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
  )

  const filtered = projects.filter(p => p.status === status)
  const sorted = [...filtered].sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at))
  const counts = Object.fromEntries(STATUSES.map(s => [s, projects.filter(p => p.status === s).length])) as Record<ProjectStatus, number>

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sorted.findIndex(p => p.id === active.id)
    const newIdx = sorted.findIndex(p => p.id === over.id)
    const newOrder = arrayMove(sorted, oldIdx, newIdx)
    const updates = new Map(newOrder.map((p, i) => [p.id, (i + 1) * 1000]))
    setProjects(ps => ps.map(p => (updates.has(p.id) ? { ...p, sort_order: updates.get(p.id)! } : p)))
    await Promise.all([...updates].map(([id, sort_order]) =>
      fetch(`/api/strikk/projects/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort_order }),
      }),
    ))
  }

  async function onCreatedFromRecipe(recipe: KnitRecipe) {
    try {
      const p = await createFromRecipe(recipe)
      router.push(`/strikk/prosjekt/${p.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunne ikke starte prosjektet')
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-stone-200 shadow-sm overflow-x-auto">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                status === s ? 'bg-stone-800 text-white shadow-sm' : 'text-stone-500 hover:text-stone-700'
              }`}>
              {STATUS_LABEL[s]}
              <span className={`ml-1 text-xs ${status === s ? 'text-white/60' : 'text-stone-400'}`}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <button onClick={() => setNewOpen(true)}
          className="shrink-0 h-10 px-4 rounded-xl bg-[#2E5339] text-white text-sm font-medium">
          Nytt prosjekt
        </button>
      </div>

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}
      {loading && <p className="text-sm text-stone-500">Laster …</p>}

      {!loading && sorted.length === 0 && (
        <p className="text-sm text-stone-500 py-8 text-center">Ingen prosjekter her ennå.</p>
      )}

      {!loading && sorted.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sorted.map(p => p.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {sorted.map(p => <ProjectCard key={p.id} project={p} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {newOpen && (
        <NewProjectModal
          onClose={() => setNewOpen(false)}
          onPickRecipe={() => setNewOpen(false)}
          onCreatedFromRecipe={onCreatedFromRecipe}
          onCreateBlank={async (name) => {
            try {
              const p = await createBlank(name)
              router.push(`/strikk/prosjekt/${p.id}`)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Kunne ikke starte prosjektet')
            }
          }}
        />
      )}
    </div>
  )
}

// Planned and ongoing projects show their cover: Maria's own photo, or the recipe's first page.
const SHOWS_COVER: ProjectStatus[] = ['planned', 'in_progress']

function ProjectCard({ project }: { project: ProjectListRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  const cover = SHOWS_COVER.includes(project.status)
  const url = cover ? coverUrl(project) : null
  return (
    <div ref={setNodeRef}
      className="relative"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes} {...listeners}>
      <Link href={`/strikk/prosjekt/${project.id}`}
        className="block bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow p-3 h-full">
        {cover && (
          <div className="-mx-3 -mt-3 mb-2 aspect-[3/4] rounded-t-xl bg-stone-100 overflow-hidden">
            {url && (
              // eslint-disable-next-line @next/next/no-img-element -- a small public file; next/image would only add a resize step
              <img src={url} alt="" loading="lazy" decoding="async" draggable={false} className="w-full h-full object-cover object-top" />
            )}
          </div>
        )}
        <h3 className="font-serif text-base text-stone-800 truncate">
          {project.name || <span className="text-stone-300 italic font-light">Uten navn</span>}
        </h3>
        {project.strikk_oppskrift?.title && (
          <p className="text-xs text-stone-500 truncate mt-0.5">{project.strikk_oppskrift.title}</p>
        )}
        {project.size_label && <p className="text-xs text-stone-400 truncate">{project.size_label}</p>}
        <span className={`inline-flex mt-2 items-center px-2 py-0.5 rounded border text-xs font-medium ${STATUS_STYLE[project.status]}`}>
          {STATUS_LABEL[project.status]}
        </span>
      </Link>
      {/* Straight to the recipe in the project, next to the status. A sibling of the card
          link, since one link cannot hold another. */}
      {project.oppskrift_id && (
        <Link href={`/strikk/prosjekt/${project.id}?view=pdf`} aria-label={`Åpne oppskriften til ${project.name || 'prosjektet'}`}
          className="absolute right-3 bottom-3 h-8 pl-2 pr-2.5 rounded-full bg-[#2E5339] text-white text-xs font-medium flex items-center gap-1 shadow-sm">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5z" /><path d="M4 20.5A2.5 2.5 0 006.5 23H20v-5" />
          </svg>
          Oppskrift
        </Link>
      )}
    </div>
  )
}

function NewProjectModal({ onClose, onPickRecipe, onCreatedFromRecipe, onCreateBlank }: {
  onClose: () => void
  onPickRecipe: () => void
  onCreatedFromRecipe: (recipe: KnitRecipe) => void
  onCreateBlank: (name: string) => void
}) {
  const [mode, setMode] = useState<'choose' | 'recipe' | 'blank'>('choose')
  const [name, setName] = useState('')

  if (mode === 'recipe') {
    return (
      <ProjectRecipePicker
        onSelect={recipe => { onPickRecipe(); onCreatedFromRecipe(recipe) }}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {mode === 'choose' && (
          <>
            <div className="px-6 pt-6 pb-2">
              <h3 className="font-serif text-2xl text-stone-800">Nytt prosjekt</h3>
            </div>
            <div className="p-6 space-y-3">
              <button onClick={() => setMode('recipe')}
                className="w-full border-2 border-stone-200 rounded-2xl p-5 text-left hover:border-[#C9A57A] hover:bg-amber-50/30 transition-colors">
                <p className="font-medium text-stone-800 text-sm">Fra en oppskrift</p>
                <p className="text-xs text-stone-400 mt-0.5">Starter fra et prosjekt i biblioteket</p>
              </button>
              <button onClick={() => setMode('blank')}
                className="w-full border-2 border-dashed border-stone-200 rounded-2xl p-5 text-left hover:border-[#C9A57A] hover:bg-amber-50/30 transition-colors">
                <p className="font-medium text-stone-800 text-sm">Tomt prosjekt</p>
                <p className="text-xs text-stone-400 mt-0.5">Uten oppskrift, bare et navn</p>
              </button>
              <button onClick={onClose} className="w-full py-1.5 text-sm text-stone-300 hover:text-stone-500">Avbryt</button>
            </div>
          </>
        )}
        {mode === 'blank' && (
          <>
            <div className="px-6 pt-6 pb-2">
              <h3 className="font-serif text-2xl text-stone-800 mb-0.5">Tomt prosjekt</h3>
            </div>
            <div className="p-6 space-y-4">
              <input autoFocus value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && name.trim() && onCreateBlank(name.trim())}
                placeholder="Navn på prosjektet"
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-stone-300" />
              <button onClick={() => onCreateBlank(name.trim())} disabled={!name.trim()}
                className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl disabled:opacity-40">
                Opprett prosjekt
              </button>
              <button onClick={() => setMode('choose')} className="w-full py-2 text-sm text-stone-400 hover:text-stone-600">
                Tilbake
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
