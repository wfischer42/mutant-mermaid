/**
 * One svg that follows the viewer's light or dark setting, made from a light and a dark render of
 * the same diagram. The two differ only in colors and opacities, so the nth color in one pairs with
 * the nth in the other; each pair that differs becomes a CSS variable, with the light value by
 * default and the dark one under `prefers-color-scheme: dark`.
 */

/** A color, or an opacity attribute's value: the slots that differ between light and dark. */
const SLOT =
  /(?<!url\(|href=")(#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|(?:rgba?|hsla?|oklch)\([^)]*\))|(\b(?:fill-|stroke-|flood-|stop-)?opacity=")([^"]*)/g

const slots = (svg: string) => Array.from(svg.matchAll(SLOT), (m) => m[1] ?? m[3])

export interface Palettes {
  light: Record<string, string>
  dark: Record<string, string>
}

export type Mode = 'auto' | 'light' | 'dark'

const declarations = (palette: Record<string, string>) =>
  Object.entries(palette)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')

/**
 * The stylesheet that sets the variables on the svg with class `scope` (so two diagrams on one
 * page don't mix): one palette, or with `auto` the light one and the dark one for dark viewers.
 */
export function paletteSheet({
  palettes,
  scope,
  mode,
}: {
  palettes: Palettes
  scope: string
  mode: Mode
}): string {
  const rule = (palette: Record<string, string>) => `svg.${scope}{${declarations(palette)}}`
  const css =
    mode === 'auto'
      ? `${rule(palettes.light)}@media (prefers-color-scheme: dark){${rule(palettes.dark)}}`
      : rule(palettes[mode])
  return `<style class="mm-palette">${css}</style>`
}

function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i)
  return (h >>> 0).toString(36)
}

export interface Adaptive {
  /** The svg with its palette sheet in `auto` mode. */
  svg: string
  palettes: Palettes
  scope: string
}

/**
 * The light svg with every color that differs in `dark` turned into a variable. Returns null when
 * the renders don't line up slot for slot, or nothing differs (as when the source's frontmatter
 * fixes the scheme).
 */
export function adaptive({ light, dark }: { light: string; dark: string }): Adaptive | null {
  const a = slots(light)
  const b = slots(dark)
  if (a.length !== b.length) return null
  const names = new Map<string, string>()
  const palettes: Palettes = { light: {}, dark: {} }
  let i = 0
  const body = light.replace(SLOT, (...m: string[]) => {
    const j = i++
    if (a[j] === b[j]) return m[0]
    const key = `${a[j]}\n${b[j]}`
    let name = names.get(key)
    if (!name) {
      name = `--mm-c${names.size}`
      names.set(key, name)
      palettes.light[name] = a[j]
      palettes.dark[name] = b[j]
    }
    return m[1] ? `var(${name})` : `${m[2]}var(${name})`
  })
  if (!names.size) return null
  const scope = `mm-p${hash(JSON.stringify(palettes))}`
  const svg = body.replace(/<svg\b[^>]*>/, (tag) => {
    const classed = / class="/.test(tag)
      ? tag.replace(/ class="/, ` class="${scope} `)
      : tag.replace(/^<svg/, `<svg class="${scope}"`)
    return classed + paletteSheet({ palettes, scope, mode: 'auto' })
  })
  return { svg, palettes, scope }
}
