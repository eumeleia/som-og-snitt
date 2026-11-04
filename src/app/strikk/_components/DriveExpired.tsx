// Shown when Strikk has no Drive connection or Google has revoked it. The button runs
// Strikk's own OAuth flow, which lands back on Strikk › Oppskrifter.
export default function DriveExpired() {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-stone-800">
        Strikk er ikke koblet til Disk, eller tilgangen har utløpt. Koble til og velg
        kontoen mariawasmuth.claude@gmail.com.
      </p>
      <a
        href="/api/strikk/drive/auth"
        className="h-11 px-4 rounded-xl bg-[#2E5339] text-white text-sm flex items-center justify-center"
      >
        Koble til Disk for Strikk
      </a>
    </div>
  )
}
