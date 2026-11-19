/**
 * Lucide icons in Mermaid, for the Node renderer: `:name:` in a label draws the icon inline, as in
 * our own diagrams, and architecture services and groups draw Lucide icons on a tinted tile in
 * place of Mermaid's fixed blue ones. The text kit counts icons when Mermaid measures labels, so
 * boxes already leave room for them.
 */
import { ICON_EM, iconAdvance, iconBody, mayHaveIcon, splitIcons } from '../core/icons.ts'
import type { TextKit } from '../core/text.ts'
import type { Tokens } from '../theme/index.ts'
import { bboxOf, fontOf } from './bbox.ts'
import { cascade, cascaded, type Found } from './inline.ts'
import { MERMAID_FONT_SIZE } from './theme.ts'

/** The icon pack architecture icons are drawn from. */
const PACK = 'mm-lucide'

/** Mermaid's built-in architecture icons, as their Lucide counterparts. */
const BUILT_IN: Record<string, string> = { internet: 'globe', disk: 'hard-drive' }

const ICON_CALL = /^(\s*(?:service|group)\s+[\w-]+\()([\w-]+)(\))/gm

/**
 * Architecture source with every unprefixed icon that Lucide has pointed at our pack, and the
 * icons it uses. Prefixed ones (`logos:aws`) are left to the packs Mermaid has.
 */
export function architectureIcons(source: string): { source: string; names: string[] } {
  if (!/^\s*architecture/m.test(source)) return { source, names: [] }
  const names = new Set<string>()
  const out = source.replace(ICON_CALL, (whole: string, ...groups: string[]) => {
    const [open, name, close] = groups
    const lucide = BUILT_IN[name] ?? name
    if (!iconBody(lucide)) return whole
    names.add(lucide)
    return `${open}${PACK}:${lucide}${close}`
  })
  return { source: out, names: [...names] }
}

/** The icon pack for `names`: each Lucide icon on a tile tinted from the theme's accent. */
export function architecturePack({ names, tokens }: { names: string[]; tokens: Tokens }): {
  name: string
  icons: { prefix: string; width: number; height: number; icons: Record<string, { body: string }> }
} {
  const { accent } = tokens
  const tile = `<rect x="0.5" y="0.5" width="23" height="23" rx="5" fill="${accent.fill}" stroke="${accent.stroke}" stroke-width="0.6"/>`
  const glyph = (name: string) =>
    `<g color="${accent.ink}" transform="translate(5 5) scale(0.5833)">${iconBody(name)}</g>`
  const icons = Object.fromEntries(names.map((name) => [name, { body: tile + glyph(name) }]))
  return { name: PACK, icons: { prefix: PACK, width: 24, height: 24, icons } }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

interface Placed {
  name: string
  x: number
  y: number
  size: number
  color: string
}

function iconGroup({ doc, icon }: { doc: Document; icon: Placed }): Element {
  const g = doc.createElementNS(SVG_NS, 'g')
  const place = `translate(${icon.x.toFixed(2)} ${icon.y.toFixed(2)}) scale(${(icon.size / 24).toFixed(3)})`
  g.setAttribute('class', 'mm-icon')
  g.setAttribute('color', icon.color)
  g.setAttribute('transform', place)
  g.innerHTML = iconBody(icon.name) ?? ''
  return g
}

const ANCHOR_SHARE: Record<string, number> = { start: 0, middle: 0.5, end: 1 }

/**
 * How a label draws, from the svg's cascade: Mermaid's inline font gives way to the theme's
 * `!important` rules (actor names are headings), which the plain DOM doesn't apply.
 */
function lookOf({ el, found }: { el: Element; found: Found }): {
  font: { size: number; weight: number }
  color: string
  share: number
} {
  const get = (name: string) => cascaded({ found, el, name })
  const own = fontOf({ el, fallback: MERMAID_FONT_SIZE })
  const weight = get('font-weight')
  const fill = get('fill')
  return {
    font: {
      size: Number.parseFloat(get('font-size') ?? '') || own.size,
      weight: weight === 'bold' ? 700 : Number(weight) || own.weight,
    },
    color: fill && fill !== 'none' && !fill.startsWith('url') ? fill : 'currentColor',
    share: ANCHOR_SHARE[get('text-anchor') ?? 'start'] ?? 0,
  }
}

/** A piece of text at its own anchor point: resvg leaves `dx` out of a line's anchored width. */
function placed({ doc, x, text }: { doc: Document; x: number; text: string }): Element {
  const span = doc.createElementNS(SVG_NS, 'tspan')
  span.setAttribute('x', x.toFixed(2))
  span.textContent = text
  return span
}

/**
 * One run of label text with icons in it: each piece of text placed on its own, leaving room for
 * the icons, and the icons to draw in that room.
 */
function layRun({ run, kit, found }: { run: Text; kit: TextKit; found: Found }): Element[] {
  const host = run.parentElement
  if (!host) return []
  const doc = run.ownerDocument
  const { font, color, share } = lookOf({ el: host, found })
  const box = bboxOf({ el: host, kit, fallback: MERMAID_FONT_SIZE })
  const anchor = box.x + box.width * share
  run.data = run.data.replace(/\s+/g, ' ').trim()
  const width = kit.width(run.data, font)
  const size = font.size * ICON_EM
  const baseline = box.y + fontOf({ el: host, fallback: MERMAID_FONT_SIZE }).size * kit.metrics.ascent
  const y = baseline - (font.size * kit.metrics.capHeight) / 2 - size / 2
  const parts = splitIcons(run.data)
  const icons: Element[] = []
  const nodes: Node[] = []
  let x = anchor - width * share
  for (const [i, part] of parts.entries()) {
    if ('icon' in part) {
      icons.push(iconGroup({ doc, icon: { name: part.icon, x, y, size, color } }))
      x += iconAdvance({ size: font.size, last: i === parts.length - 1 })
      continue
    }
    const advance = kit.width(part.text, font)
    nodes.push(placed({ doc, x: x + advance * share, text: part.text }))
    x += advance
  }
  run.replaceWith(...nodes)
  return icons
}

function iconRuns(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  const runs: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !node.parentElement?.closest('text')) continue
    if (mayHaveIcon(node.data) && splitIcons(node.data).some((part) => 'icon' in part)) runs.push(node)
  }
  return runs
}

/**
 * Draws `:name:` icons in a Mermaid SVG's labels. The SVG joins the page while it's laid out, so
 * its stylesheet sets each label's font and color.
 */
export function drawLabelIcons({ svg, kit }: { svg: string; kit: TextKit }): string {
  if (!mayHaveIcon(svg)) return svg
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const root = document.importNode(parsed, true)
  document.body.appendChild(root)
  const found = cascade(root)
  for (const run of iconRuns(root)) {
    const label = run.parentElement?.closest('text')
    const icons = layRun({ run, kit, found })
    if (!(label && icons.length)) continue
    const g = document.createElementNS(SVG_NS, 'g')
    const transform = label.getAttribute('transform')
    if (transform) g.setAttribute('transform', transform)
    g.append(...icons)
    label.after(g)
  }
  root.remove()
  return new XMLSerializer().serializeToString(root)
}
