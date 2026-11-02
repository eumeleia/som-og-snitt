import type { Viewport } from 'next'
import RecipeViewer from '../../../_components/RecipeViewer'

// viewport-fit=cover so the page can use the full screen and env(safe-area-inset-*).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function KnitRecipeViewPage({ params }: PageProps<'/strikk/oppskrifter/[id]'>) {
  const { id } = await params
  return <RecipeViewer id={id} />
}
