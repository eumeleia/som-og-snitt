import DashboardLayout from '@/app/dashboard/layout'
import StrikkSubnav from '../_components/StrikkSubnav'

// The (shell) group gives the Strikk list pages the app's header and side menu. The PDF
// view in (viewer), /strikk/prosjekt/[id] and /strikk/prototype stay outside it and run
// full screen.
export default function StrikkShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout>
      <StrikkSubnav />
      {children}
    </DashboardLayout>
  )
}
