// Keeping the Drive file name in step with the recipe: «Oppskrift - Designer.pdf».
import { driveFileName } from './extraction'

export interface NamedRecipe {
  id: string
  title: string
  designer: string | null
  file_name: string
  drive_file_id: string
}

export interface DriveRename { id: string; fileId: string; from: string; to: string }

// driveNames: file id → name, for the files the Strikk account can see. A recipe whose
// file is not there (the private Drive) is left alone. When Drive already has the right
// name but the row does not, only the row is brought up to date.
export function planDriveRenames(rows: NamedRecipe[], driveNames: Map<string, string>): {
  rename: DriveRename[]
  rowOnly: { id: string; to: string }[]
} {
  const rename: DriveRename[] = []
  const rowOnly: { id: string; to: string }[] = []
  for (const r of rows) {
    const current = driveNames.get(r.drive_file_id)
    if (current === undefined) continue
    const to = driveFileName(r.title, r.designer, r.file_name)
    if (current !== to) rename.push({ id: r.id, fileId: r.drive_file_id, from: current, to })
    else if (r.file_name !== to) rowOnly.push({ id: r.id, to })
  }
  return { rename, rowOnly }
}
