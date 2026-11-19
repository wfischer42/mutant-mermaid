/**
 * Node-only: the bundled fonts as inline @font-face rules, so an SVG shows in its real fonts
 * wherever it's opened, with no network and nothing installed.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const FONT_FAMILIES = [
  'Nunito',
  'Inter',
  'IBM Plex Sans',
  'DM Sans',
  'Source Sans 3',
  'Figtree',
] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

/** A fontsource package's latin file stem for a weight, such as `inter/files/inter-latin-500`. */
const fontsource =
  (pkg: string) =>
  (w: number): string =>
    `${pkg}/files/${pkg}-latin-${w}`

const FAMILIES: Record<FontFamily, { weights: number[]; file: (weight: number) => string }> = {
  Nunito: { weights: [400, 500, 600, 700, 800], file: fontsource('nunito') },
  Inter: { weights: [400, 500, 600, 700], file: fontsource('inter') },
  'IBM Plex Sans': { weights: [400, 500, 600, 700], file: fontsource('ibm-plex-sans') },
  'DM Sans': { weights: [400, 500, 600, 700], file: fontsource('dm-sans') },
  'Source Sans 3': { weights: [400, 500, 600, 700], file: fontsource('source-sans-3') },
  Figtree: { weights: [400, 500, 600, 700], file: fontsource('figtree') },
}

const cache = new Map<string, string | null>()

function fontData(path: string): string | null {
  if (!cache.has(path)) {
    try {
      const file = require.resolve(`@fontsource/${path}-normal.woff2`)
      cache.set(path, readFileSync(file).toString('base64'))
    } catch {
      cache.set(path, null)
    }
  }
  return cache.get(path) ?? null
}

/** @font-face rules for the given families, or all of them, in every bundled weight. */
export function fontFaceCss(families: readonly FontFamily[] = FONT_FAMILIES): string {
  return families
    .flatMap((family) => FAMILIES[family].weights.map((weight) => ({ family, weight })))
    .flatMap(({ family, weight }) => {
      const data = fontData(FAMILIES[family].file(weight))
      if (!data) return []
      return [
        `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: normal; src: url(data:font/woff2;base64,${data}) format('woff2'); }`,
      ]
    })
    .join('\n')
}

/**
 * Inlines the bundled fonts an SVG names (Nunito, Inter) as a `<style>` of data-URL @font-face
 * rules, for exporting a file that looks the same anywhere. Latin glyphs only; emoji and other
 * scripts fall back to the viewer's fonts.
 */
export function embedFonts(svg: string): string {
  const families = FONT_FAMILIES.filter((family) =>
    new RegExp(`font-family[=:]\\s*(?:["']|&#39;|&quot;)*${family}\\b`).test(svg),
  )
  if (families.length === 0) return svg
  const style = `<style>${fontFaceCss(families)}</style>`
  return svg.replace(/<svg\b[^>]*>/, (open) => `${open}${style}`)
}
