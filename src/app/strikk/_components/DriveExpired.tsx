// Shown when /api/strikk/token answers DRIVE_AUTH_EXPIRED. The button runs the existing
// OAuth flow, which lands on Innstillinger when it is done.
export default function DriveExpired() {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-stone-800">
        Disk-tilgangen har utløpt. Koble til på nytt for å laste opp og åpne oppskrifter.
      </p>
      <a
        href="/api/drive/auth"
        className="h-11 px-4 rounded-xl bg-[#2E5339] text-white text-sm flex items-center justify-center"
      >
        Koble til Disk på nytt
      </a>
    </div>
  )
}
