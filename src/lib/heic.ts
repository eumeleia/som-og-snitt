import convert from 'heic-convert'
import sharp from 'sharp'

export type Bildeformat = 'heic' | 'jpeg' | 'png' | 'gif' | 'webp'

const MEDIA_TYPE: Record<Exclude<Bildeformat, 'heic'>, string> = {
  jpeg: 'image/jpeg',
  png:  'image/png',
  gif:  'image/gif',
  webp: 'image/webp',
}

const MAKS_LENGSTE_SIDE = 1568

// ISOBMFF-brands for HEIC/HEIF-familien — sniffet fra ftyp-boksen ved offset 8, ikke fra
// filnavn eller klientens mimetype som ikke kan stoles på.
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])

/**
 * Sniffer bildeformat via magic bytes. Returnerer null hvis filen ikke er et
 * gjenkjent bilde i det hele tatt (skilt fra "bilde, men format vi ikke leser").
 */
export function sniffBildeformat(buf: Buffer): Bildeformat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'gif'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii')
    if (HEIC_BRANDS.has(brand)) return 'heic'
  }
  return null
}

export class UgyldigBildeError extends Error {}

/**
 * Konverterer HEIC til JPEG (heic-convert — ImageMagick og ffmpeg klarer ikke ekte
 * iPhone-HEIC, kun et libheif-basert bibliotek gjør det), skalerer ALLE bilder ned til
 * maks 1568px på lengste side (Claude skalerer uansett ned dit) og retter EXIF-rotasjon.
 * Ikke-HEIC-formater beholder sitt opprinnelige format, bare skalert.
 */
export async function forberedBilde(
  buf: Buffer,
  format: Bildeformat,
): Promise<{ data: Buffer; mediaType: string }> {
  let arbeidsbuffer = buf

  if (format === 'heic') {
    try {
      const jpegBuffer = await convert({ buffer: buf, format: 'JPEG', quality: 0.92 })
      arbeidsbuffer = Buffer.from(jpegBuffer)
    } catch (err) {
      throw new UgyldigBildeError(
        `Klarte ikke lese HEIC-bildet: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  try {
    const resized = await sharp(arbeidsbuffer)
      .rotate() // retter EXIF-orientering før nedskalering
      .resize({ width: MAKS_LENGSTE_SIDE, height: MAKS_LENGSTE_SIDE, fit: 'inside', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true })

    const utformat = format === 'heic' ? 'jpeg' : (resized.info.format as Exclude<Bildeformat, 'heic'>)
    return { data: resized.data, mediaType: MEDIA_TYPE[utformat] ?? MEDIA_TYPE.jpeg }
  } catch (err) {
    throw new UgyldigBildeError(
      `Klarte ikke behandle bildet: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
