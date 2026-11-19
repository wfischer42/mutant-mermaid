/**
 * Node-only entry: rasterizes diagrams to PNG with resvg, using the bundled fonts so the output
 * matches what a browser with those fonts draws.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'
import { EMOJI_FAMILY } from './core/svg.ts'
import { embedFonts } from './fonts.ts'
import { type Diagnostic, detect, type RenderOptions, render, resolveTheme } from './index.ts'

export { embedFonts, type FontFamily, fontFaceCss } from './fonts.ts'
export * from './index.ts'

const require = createRequire(import.meta.url)

/** Every weight of a fontsource package, in its latin and latin-ext subsets. */
const fontsource = ({ pkg, weights }: { pkg: string; weights: number[] }) =>
  weights.flatMap((w) =>
    ['latin', 'latin-ext'].map((s) => `@fontsource/${pkg}/files/${pkg}-${s}-${w}-normal.woff`),
  )

const FONT_FILES = [
  ...fontsource({ pkg: 'nunito', weights: [400, 500, 600, 700, 800] }),
  ...[...Array.from({ length: 11 }, (_, i) => String(i)), 'emoji'].map(
    (subset) => `@fontsource/noto-emoji/files/noto-emoji-${subset}-400-normal.woff`,
  ),
  ...['inter', 'ibm-plex-sans', 'dm-sans', 'source-sans-3', 'figtree'].flatMap((pkg) =>
    fontsource({ pkg, weights: [400, 500, 600, 700] }),
  ),
]

/**
 * Unpacks a WOFF 1 file into the TrueType/OpenType tables resvg reads. WOFF is the sfnt with each
 * table optionally zlib-compressed, plus a different header.
 */
export function woffToSfnt(woff: Buffer): Buffer {
  const numTables = woff.readUInt16BE(12)
  const flavor = woff.readUInt32BE(4)
  const tables = Array.from({ length: numTables }, (_, i) => {
    const at = 44 + i * 20
    const tag = woff.readUInt32BE(at)
    const offset = woff.readUInt32BE(at + 4)
    const compLength = woff.readUInt32BE(at + 8)
    const origLength = woff.readUInt32BE(at + 12)
    const checksum = woff.readUInt32BE(at + 16)
    const raw = woff.subarray(offset, offset + compLength)
    const data = compLength < origLength ? inflateSync(raw) : raw
    return { tag, checksum, data }
  })
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16
  const header = Buffer.alloc(12 + numTables * 16)
  header.writeUInt32BE(flavor, 0)
  header.writeUInt16BE(numTables, 4)
  header.writeUInt16BE(searchRange, 6)
  header.writeUInt16BE(Math.floor(Math.log2(numTables)), 8)
  header.writeUInt16BE(numTables * 16 - searchRange, 10)
  const chunks: Buffer[] = [header]
  let offset = header.length
  tables.forEach((table, i) => {
    const at = 12 + i * 16
    header.writeUInt32BE(table.tag, at)
    header.writeUInt32BE(table.checksum, at + 4)
    header.writeUInt32BE(offset, at + 8)
    header.writeUInt32BE(table.data.length, at + 12)
    const padded = Buffer.alloc((table.data.length + 3) & ~3)
    table.data.copy(padded)
    chunks.push(padded)
    offset += padded.length
  })
  return Buffer.concat(chunks)
}

let fonts: string[] | null = null
/** resvg reads fonts from files, so the unpacked fonts are cached as .ttf in the temp directory. */
function loadFonts(): string[] {
  if (fonts) return fonts
  const dir = join(tmpdir(), 'mutant-mermaid-fonts')
  mkdirSync(dir, { recursive: true })
  fonts = FONT_FILES.map((file) => {
    const out = join(dir, basename(file).replace(/\.woff$/, '.ttf'))
    if (!existsSync(out)) writeFileSync(out, woffToSfnt(readFileSync(require.resolve(file))))
    return out
  })
  return fonts
}

export interface PngOptions {
  /** Pixel density; 2 gives crisp images on high-DPI screens. */
  scale?: number
}

/** Rasterizes an SVG string to PNG bytes. */
export function svgToPng(svg: string, { scale = 2 }: PngOptions = {}): Buffer {
  const resvg = new Resvg(svg.replaceAll(EMOJI_FAMILY, "'Noto Emoji'"), {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles: loadFonts(), loadSystemFonts: true, defaultFontFamily: 'Nunito' },
  })
  return Buffer.from(resvg.render().asPng())
}

export type Engine = 'ours' | 'mermaid'

/**
 * Renders any source: with our renderer when a type claims its keyword, otherwise with Mermaid in a
 * jsdom page (no browser needed). Throws with a fix-it message on bad input.
 */
export async function renderAuto(
  source: string,
  options: RenderOptions & { embedFonts?: boolean } = {},
): Promise<{ svg: string; engine: Engine; diagnostics: Diagnostic[] }> {
  if (detect(source)) {
    const { svg, diagnostics } = await render(source, options)
    return { svg: options.embedFonts ? embedFonts(svg) : svg, engine: 'ours', diagnostics }
  }
  const { renderMermaidJsdom } = await import('./mermaid/jsdom.ts')
  const tokens = resolveTheme({ theme: options.theme, dark: options.dark })
  const result = await renderMermaidJsdom({
    source,
    tokens,
    background: !options.transparent,
  })
  if ('error' in result) throw new Error(result.error)
  const svg = options.embedFonts ? embedFonts(result.svg) : result.svg
  return { svg, engine: 'mermaid', diagnostics: [] }
}

/** PNG bytes for a rendered SVG; Mermaid's stylesheet is first resolved onto its elements for resvg. */
export async function engineToPng({
  svg,
  engine,
  scale = 2,
}: {
  svg: string
  engine: Engine
  scale?: number
}): Promise<Buffer> {
  if (engine === 'ours') return svgToPng(svg, { scale })
  const { rasterizeJsdom } = await import('./mermaid/jsdom.ts')
  return rasterizeJsdom({ svg, scale })
}

/** Renders a source straight to PNG bytes. */
export async function renderPng(
  source: string,
  options: RenderOptions & PngOptions = {},
): Promise<Buffer> {
  const { svg } = await render(source, options)
  return svgToPng(svg, options)
}
