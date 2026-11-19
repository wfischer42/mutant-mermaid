import { roundedRect } from '../../core/geometry.ts'
import { type Diagnostic, indentTree, readLines } from '../../core/parse.ts'
import { g, h, n } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { corner, OUTLINE, type Swatch, WEIGHT } from '../../theme/index.ts'
import {
  Bounds,
  blockHeight,
  type ChipSize,
  chipSize,
  drawChip,
  flow,
  frame,
  type Hues,
  type Item,
  LABEL,
  NOTE,
  plainChip,
  ramp,
  readHead,
  readHues,
  readItem,
  sayer,
} from './common.ts'

/**
 * A stack of layers, top to bottom, each a crisp band with a label, a note and optional chips:
 *
 *   layers "Web stack" !numbered
 *     Presentation : what users touch
 *       React
 *       CSS
 *     Application : business rules
 *     Data : storage and caches
 *
 * `style=onion` draws concentric rings instead, the first layer outermost and the last at the
 * core. `numbered=reverse` counts from the bottom, as the OSI model does.
 */
export interface Layer extends Item {
  items: Item[]
}

export interface LayersModel {
  title: string
  layers: Layer[]
  onion: boolean
  numbering: 'none' | 'down' | 'up'
  hues?: Hues
}

export function parseLayers(source: string): Parsed<LayersModel> {
  const [first, ...rest] = readLines(source)
  const head = readHead(first)
  const diagnostics: Diagnostic[] = []
  const layers = indentTree(rest).map((node) => ({
    ...readItem(node.line),
    items: node.children.map((child) => readItem(child.line)),
  }))
  if (!layers.length)
    diagnostics.push({
      line: head.line,
      message: 'A layer stack needs layers, one per indented line, top layer first.',
      severity: 'error',
    })
  const style = head.attrs.style ?? (head.keyword === 'onion' ? 'onion' : 'stack')
  let numbering: LayersModel['numbering'] = 'none'
  if (head.flags.has('numbered') || head.attrs.numbered) numbering = 'down'
  if (/^(reverse|up|bottom)/.test(head.attrs.numbered ?? '')) numbering = 'up'
  const { hues, diagnostic } = readHues(head)
  if (diagnostic) diagnostics.push(diagnostic)
  return {
    model: { title: head.title, layers, onion: style === 'onion', numbering, hues },
    diagnostics,
  }
}

const GAP = 6

interface Band {
  layer: Layer
  swatch: Swatch
  note: string[]
  chips: ChipSize[]
  chipAt: { x: number; y: number }[]
  chipsH: number
  height: number
}

/** The number shown on a layer, if any. */
function numberOf({ model, index }: { model: LayersModel; index: number }): string {
  if (model.numbering === 'down') return String(index + 1)
  if (model.numbering === 'up') return String(model.layers.length - index)
  return ''
}

function measureBands({ model, ctx }: { model: LayersModel; ctx: Context }) {
  const kit = ctx.text
  const labelStyle = { size: LABEL + 1, weight: WEIGHT.heading }
  const badge = model.numbering === 'none' ? 0 : 34
  const labelW = Math.max(...model.layers.map((l) => kit.width(l.label, labelStyle))) + badge + 40
  const contentW = Math.max(
    300,
    ...model.layers.map((l) => (l.note ? Math.min(380, kit.width(l.note, { size: NOTE })) : 0)),
  )
  const bands: Band[] = model.layers.map((layer, index) => {
    const note = layer.note ? kit.wrap(layer.note, { size: NOTE, max: contentW }) : []
    const chips = layer.items.map((item) =>
      chipSize({ kit, label: item.label, size: 13, max: contentW }),
    )
    const packed = flow({ sizes: chips, max: contentW, gap: 8 })
    const noteH = blockHeight({ kit, count: note.length, size: NOTE })
    const content = noteH + (note.length && chips.length ? 10 : 0) + packed.h
    return {
      layer,
      swatch: ramp({
        tokens: ctx.tokens,
        color: layer.color,
        index,
        count: model.layers.length,
        hues: model.hues,
      }),
      note,
      chips,
      chipAt: packed.at,
      chipsH: packed.h,
      height: Math.max(56, content + 28),
    }
  })
  return { bands, labelW, contentW, badge }
}

function renderStack(model: LayersModel, ctx: Context): Drawing {
  const { tokens, text: kit } = ctx
  const say = sayer(kit)
  const { bands, labelW, contentW, badge } = measureBands({ model, ctx })
  const width = labelW + contentW + 40
  const bounds = new Bounds()
  const parts: string[] = []
  let y = 0
  const r = corner({ tokens, r: 10 })
  bands.forEach((band, i) => {
    const { swatch } = band
    const mid = y + band.height / 2
    parts.push(
      h('path', {
        d: roundedRect({ x: 0, y, w: width, h: band.height, r }),
        fill: tokens.surface,
      }),
      h('path', {
        d: roundedRect({ x: 0, y, w: labelW, h: band.height, r }),
        fill: swatch.fill,
      }),
      h('path', {
        d: `M${n(labelW)} ${n(y + 0.7)}V${n(y + band.height - 0.7)}`,
        stroke: tokens.border,
        'stroke-width': 1,
      }),
      h('path', {
        d: roundedRect({ x: 0, y, w: width, h: band.height, r }),
        fill: 'none',
        stroke: tokens.border,
        'stroke-width': OUTLINE.thin,
      }),
    )
    const number = numberOf({ model, index: i })
    if (number)
      parts.push(
        h('circle', { cx: 28, cy: mid, r: 11, fill: 'none', stroke: swatch.stroke }),
        say({ x: 28, y: mid, lines: [number], size: 12, weight: WEIGHT.heading, fill: swatch.strong }),
      )
    parts.push(
      say({
        x: 20 + badge,
        y: mid,
        lines: [band.layer.label],
        size: LABEL + 1,
        weight: WEIGHT.heading,
        fill: tokens.fg,
        anchor: 'start',
      }),
    )
    parts.push(bandContent({ ctx, band, x: labelW + 20, y }))
    y += band.height + GAP
  })
  bounds.add({ x: 0, y: 0, w: width, h: y - GAP })
  return frame({ ctx, title: model.title, body: g({}, ...parts), bounds })
}

/** A band's note and chips, vertically centered in the band. */
function bandContent({
  ctx,
  band,
  x,
  y,
}: {
  ctx: Context
  band: Band
  x: number
  y: number
}): string {
  const { tokens, text: kit } = ctx
  const noteH = blockHeight({ kit, count: band.note.length, size: NOTE })
  const gap = band.note.length && band.chips.length ? 10 : 0
  const top = y + (band.height - (noteH + gap + band.chipsH)) / 2
  const note = band.note.length
    ? sayer(kit)({
        x,
        y: top + noteH / 2,
        lines: band.note,
        size: NOTE,
        fill: tokens.muted,
        anchor: 'start',
      })
    : ''
  const chips = band.chips.map((size, i) =>
    drawChip({
      ctx,
      x: x + band.chipAt[i].x,
      y: top + noteH + gap + band.chipAt[i].y,
      size,
      swatch: plainChip(tokens),
    }),
  )
  return g({}, note, ...chips)
}

/** Concentric rings, the first layer outermost; notes sit in a column to the right. */
function renderOnion(model: LayersModel, ctx: Context): Drawing {
  const { tokens, text: kit } = ctx
  const say = sayer(kit)
  const count = model.layers.length
  const labelStyle = { size: LABEL, weight: WEIGHT.heading }
  const core = model.layers[count - 1]
  const coreR = Math.max(52, kit.width(core.label, labelStyle) / 2 + 20)
  const notes = model.layers.map((layer) => {
    const text = [layer.note, layer.items.map((i) => i.label).join(' · ')]
      .filter(Boolean)
      .join(' — ')
    return text ? kit.wrap(text, { size: NOTE, max: 240 }) : []
  })
  const longest = Math.max(1, ...notes.map((l) => l.length))
  const ring = Math.max(52, longest * kit.lineHeight({ size: NOTE }) + 18)
  const widths = model.layers.map((l) => kit.width(l.label, labelStyle) + 24)
  const fits = (base: number) =>
    widths.every((w, i) => {
      const r = base + (count - 1 - i) * ring
      const y = r - ring / 2
      return i === count - 1 || 2 * Math.sqrt(r * r - y * y) >= w
    })
  let base = coreR
  while (!fits(base) && base < 600) base += 6
  const radii = model.layers.map((_, i) => base + (count - 1 - i) * ring)
  const outer = radii[0]
  const hasNotes = notes.some((l) => l.length)
  const noteX = outer + 48
  const bounds = new Bounds()
  bounds.add({ x: -outer, y: -outer, w: outer * 2, h: outer * 2 })
  const parts: string[] = []
  model.layers.forEach((layer, i) => {
    const swatch = ramp({ tokens, color: layer.color, index: i, count, hues: model.hues })
    parts.push(
      h('circle', {
        cx: 0,
        cy: 0,
        r: radii[i],
        fill: swatch.fill,
        stroke: swatch.stroke,
        'stroke-width': OUTLINE.thin,
      }),
    )
  })
  model.layers.forEach((layer, i) => {
    const swatch = ramp({ tokens, color: layer.color, index: i, count, hues: model.hues })
    const labelY = i === count - 1 ? 0 : -(radii[i] - ring / 2)
    const number = numberOf({ model, index: i })
    const label = number ? `${number}  ${layer.label}` : layer.label
    parts.push(
      say({
        x: 0,
        y: labelY,
        lines: [label],
        size: LABEL,
        weight: WEIGHT.heading,
        fill: tokens.fg,
      }),
    )
    if (!hasNotes || !notes[i].length) return
    const from = kit.width(label, labelStyle) / 2 + 10
    parts.push(
      h('path', {
        d: `M${n(from)} ${n(labelY)}H${n(noteX - 22)}`,
        stroke: swatch.stroke,
        'stroke-width': 1,
        'stroke-dasharray': '1.5 3',
        'stroke-linecap': 'round',
      }),
      h('circle', { cx: noteX - 14, cy: labelY, r: 4, fill: swatch.stroke }),
      say({
        x: noteX,
        y: labelY,
        lines: notes[i],
        size: NOTE,
        fill: tokens.muted,
        anchor: 'start',
      }),
    )
    bounds.addText({ kit, x: noteX, y: labelY, lines: notes[i], size: NOTE, anchor: 'start' })
  })
  return frame({ ctx, title: model.title, body: g({}, ...parts), bounds })
}

export function renderLayers(model: LayersModel, ctx: Context): Drawing {
  return model.onion ? renderOnion(model, ctx) : renderStack(model, ctx)
}

export const layers: DiagramType<LayersModel> = {
  id: 'layers',
  keywords: ['layers', 'onion'],
  title: 'Layers',
  summary:
    'A layer stack (OSI, tech stack) as crisp bands with notes and chips; `style=onion` draws concentric rings.',
  guide: {
    useWhen: 'a system is built in layers, each resting on or wrapping the next.',
    syntax: `
Layers on the first indent, top layer first; chips indented under a layer:

\`\`\`
layers "Title" !numbered              %% !numbered counts layers from the top
  Presentation : what users touch     %% layer : note
    React                             %% a chip in that layer
    CSS
  Application #violet                 %% #color tints the band
  Data : storage and caches           %% the last line is the bottom layer
\`\`\`

- **Order:** layers are drawn top to bottom in the order written.
- **Onion:** \`onion "Title"\` or \`layers "Title" style=onion\` draws concentric rings: the first
  layer is the outer ring and the last is the core. Write it outside in. \`style\` is \`onion\` or
  \`stack\` (the default for \`layers\`); \`onion style=stack\` draws bands.
- **Numbers:** \`!numbered\` numbers layers 1, 2, 3… from the top. \`numbered=reverse\` numbers
  from the bottom, as the OSI model does (\`numbered=up\` and \`numbered=bottom\` mean the same).
  Any other \`numbered=\` value, \`numbered=false\` included, counts from the top; leave it out
  for no numbers. Either way, write the layers top to bottom.
- **Note:** text after \`: \` (colon, then a space) is shown in the band beside the label. Keep
  layer labels short; they don't wrap.
- **Chips** are one level under a layer: one per line, drawn as pills in the band in the layer's
  color. Only the chip's label shows; a chip's note or color is ignored, and deeper indentation
  is ignored. In an onion, a layer's note and chips are joined into one note ("note — chip ·
  chip") to the right of the rings.
- **Color:** \`#name\` (\`red\`, \`coral\`, \`orange\`, \`amber\`, \`yellow\`, \`lime\`, \`green\`,
  \`moss\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`, \`indigo\`, \`violet\`, \`purple\`, \`magenta\`,
  \`pink\`, \`rose\`, \`brown\`, \`grey\`) or \`#hex\` at the end of a layer line. Without one,
  layers shade from faint to deeper while sliding between two neighboring hues, teal to blue
  unless the header says otherwise: \`colors=green-teal\`, \`colors=blue-violet\`,
  \`colors=violet-pink\`, or one name (\`colors=amber\`) to keep a single hue. Pick neighbors on
  the wheel; two far-apart hues read as a rainbow.
- **Read from the end of a line:** a trailing \`#color\` (palette name or hex), \`!word\` or
  \`key=value\` is taken as an option, not text; any other \`#word\`, like \`Ship #launch\`, stays
  in the text. Quote a label to keep a trailing \`!word\` or \`key=value\`, or a \`: \` in it.
- At least one layer is required. Four to seven read best; an onion gets crowded past five.`,
    example: `
layers "Web app stack" !numbered
  Client : what runs in the browser
    React
    TypeScript
  API : request handling and business rules
    Node.js
    GraphQL
  Data : storage, caches and queues
    Postgres
    Redis
  Infrastructure : where it all runs
    Kubernetes
    AWS`,
  },
  parse: parseLayers,
  render: renderLayers,
}
