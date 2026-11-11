import type { Viewport } from 'next'
import ProjectView from '../../_components/ProjectView'

// viewport-fit=cover, samme som prototypen hadde: env(safe-area-inset-*) blir ikke null,
// så verktøyknappene og tellerbaren kan stå like over hjem-indikatoren.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function StrikkProjectPage({ params }: PageProps<'/strikk/prosjekt/[id]'>) {
  const { id } = await params
  return <ProjectView id={id} />
}
