import { redirect } from 'next/navigation'
import { STRIKK_SECTIONS } from '../sections'

export default function StrikkIndex() {
  redirect(STRIKK_SECTIONS[0].href)
}
