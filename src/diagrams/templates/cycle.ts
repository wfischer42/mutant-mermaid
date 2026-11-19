import { arrowHead, type Point, polar, roundedRect } from '../../core/geometry.ts'
import { type Diagnostic, readLines } from '../../core/parse.ts'
import { g, h, n } from '../../core/svg.ts'
import { balance } from '../../core/text.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { OUTLINE, type Swatch, swatchFor, WEIGHT } from '../../theme/index.ts'
import {
  Bounds,
  blockHeight,
  frame,
  type Item,
  jitter,
  NOTE,
  readHead,
  readItem,
  sayer,
} from './common.ts'

/**
 * Stages around a ring, each flowing into the next:
 *
 *   cycle "PDCA"
 *     Plan : set goals and a hypothesis
 *     Do : run the experiment
 *     Check : compare results to the plan
 *     Act : adopt, adapt or abandon
 *
 * `flywheel` draws the same stages as pills on a heavy wheel around one hub label, given with
 * `center="Growth"` in the header or a `center Growth` line.
 */
export interface CycleModel {
  title: string
  stages: Item[]
  center?: string
  flywheel: boolean
  numbered: boolean
}

export function parseCycle(source: string): Parsed<CycleModel> {
  const [first, ...rest] = readLines(source)
  const head = readHead(first)
  const diagnostics: Diagnostic[] = []
  let center = head.attrs.center
  const stages: Item[] = []
  for (const line of rest) {
    const hub = /^(?:center|hub)(?=[\s:])\s*:?\s*(.+)$/.exec(line.text)
    if (hub) center = readItem({ ...line, text: hub[1] }).label
    else stages.push(readItem(line))
  }
  if (stages.length < 2)
    diagnostics.push({
      line: first?.no ?? 1,
      message: 'A cycle needs at least two stages, each on its own indented line.',
      severity: 'error',
    })
  if (stages.length > 8)
    diagnostics.push({
      line: stages[8].line,
      message: 'A cycle reads best with 3–8 stages; consider grouping some.',
      severity: 'warning',
    })
  const flywheel = head.keyword === 'flywheel'
  return {
    model: {
      title: head.title,
      stages,
      center,
      flywheel,
      numbered: head.flags.has('numbered') || (!flywheel && !head.flags.has('plain')),
    },
    diagnostics,
  }
}

interface Box {
  item: Item
  swatch: Swatch
  lines: string[]
  w: number
  h: number
}

interface Node extends Box {
  angle: number
  at: Point
}

const STAGE = 14

/** Half the extent of a w×h box along a unit direction at `angle`. */
function reach({ w, h: height, angle }: { w: number; h: number; angle: number }): number {
  return (w / 2) * Math.abs(Math.cos(angle)) + (height / 2) * Math.abs(Math.sin(angle))
}

/** Stage boxes: pills for a flywheel, equal circles (as their bounding squares) for a cycle. */
function measure({ model, ctx }: { model: CycleModel; ctx: Context }): Box[] {
  const kit = ctx.text
  const style = { size: STAGE, weight: WEIGHT.body }
  const raw = model.stages.map((item, i) => {
    const lines = balance({ kit, text: item.label, style, max: model.flywheel ? 130 : 92 })
    const textW = Math.max(...lines.map((l) => kit.width(l, style)))
    const textH = blockHeight({ kit, count: lines.length, size: STAGE })
    const own = item.color && swatchFor({ tokens: ctx.tokens, color: item.color })
    const swatch = own || ctx.tokens.accent
    if (model.flywheel) return { item, swatch, lines, w: textW + 34, h: textH + 22 }
    const r = Math.hypot(textW / 2, textH / 2) + 11
    return { item, swatch, lines, w: r * 2, h: r * 2 }
  })
  if (model.flywheel) return raw
  const radius = Math.min(70, Math.max(44, ...raw.map((s) => s.w / 2)))
  return raw.map((s) => ({ ...s, w: radius * 2, h: radius * 2 }))
}

interface Hub {
  lines: string[]
  size: number
  need: number
}

function hubLabel({ model, ctx }: { model: CycleModel; ctx: Context }): Hub {
  const kit = ctx.text
  const size = model.flywheel ? 17 : 15
  const style = { size, weight: WEIGHT.title }
  if (!model.center) return { lines: [], size, need: 0 }
  const lines = balance({ kit, text: model.center, style, max: 120 })
  const need =
    Math.hypot(
      Math.max(...lines.map((l) => kit.width(l, style))) / 2,
      blockHeight({ kit, count: lines.length, size }) / 2,
    ) + 18
  return { lines, size, need }
}

export function renderCycle(model: CycleModel, ctx: Context): Drawing {
  const count = model.stages.length
  const boxes = measure({ model, ctx })
  const angles = boxes.map((_, i) => -Math.PI / 2 + (i / count) * Math.PI * 2)
  const step = Math.sin(Math.PI / count)
  const spacing = model.flywheel ? 50 : 62
  const hubText = hubLabel({ model, ctx })
  const intrusion = Math.max(...boxes.map((b, i) => reach({ ...b, angle: angles[i] })))
  const gap = model.flywheel ? 34 : 26
  const ring = Math.max(
    model.flywheel ? 150 : 118,
    hubText.need + intrusion + gap,
    ...boxes.map((b, i) => {
      const next = boxes[(i + 1) % count]
      const mid = angles[i] + Math.PI / count + Math.PI / 2
      return (reach({ ...b, angle: mid }) + reach({ ...next, angle: mid }) + spacing) / (2 * step)
    }),
  )
  const wobble = jitter({ ctx, amount: 1.2 })
  const nodes: Node[] = boxes.map((b, i) => {
    const at = polar({ cx: 0, cy: 0, r: ring, angle: angles[i] })
    return { ...b, angle: angles[i], at: { x: at.x + wobble(), y: at.y + wobble() } }
  })
  const bounds = new Bounds()
  bounds.add({ x: -ring - 4, y: -ring - 4, w: ring * 2 + 8, h: ring * 2 + 8 })
  const track = h('circle', {
    cx: 0,
    cy: 0,
    r: ring,
    fill: 'none',
    stroke: ctx.tokens.border,
    'stroke-width': 1.2,
    'stroke-dasharray': '2 6',
    'stroke-linecap': 'round',
  })
  const back = [
    model.flywheel ? wheel({ ctx, nodes, ring }) : track,
    ...nodes.map((node, i) => link({ ctx, model, from: node, to: nodes[(i + 1) % count], ring })),
    hub({ ctx, model, label: hubText, radius: ring - intrusion - gap }),
  ]
  const front = nodes.map((node, i) => stage({ ctx, model, node, index: i, bounds }))
  return frame({ ctx, title: model.title, body: g({}, ...back, ...front), bounds })
}

/** The flywheel's heavy rim that the stages ride on. */
function wheel({ ctx, nodes, ring }: { ctx: Context; nodes: Node[]; ring: number }): string {
  const { tokens } = ctx
  const band = Math.max(26, Math.min(...nodes.map((nd) => nd.h)) * 0.75)
  const edge = (r: number) =>
    h('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: tokens.border, 'stroke-width': 1 })
  return g(
    {},
    h('circle', {
      cx: 0,
      cy: 0,
      r: ring,
      fill: 'none',
      stroke: tokens.accent.fill,
      'stroke-width': band,
    }),
    edge(ring + band / 2),
    edge(ring - band / 2),
  )
}

/** The curved arrow along the ring from one stage to the next. */
function link({
  ctx,
  model,
  from,
  to,
  ring,
}: {
  ctx: Context
  model: CycleModel
  from: Node
  to: Node
  ring: number
}): string {
  const { tokens } = ctx
  const span = (Math.PI * 2) / model.stages.length
  const mid = from.angle + span / 2 + Math.PI / 2
  const start = from.angle + (reach({ ...from, angle: mid }) + 9) / ring
  const end = from.angle + span - (reach({ ...to, angle: mid }) + 9) / ring
  if (end - start < 0.05) return ''
  const size = model.flywheel ? 13 : 11
  const lineEnd = end - (size * 0.55) / ring
  const a = polar({ cx: 0, cy: 0, r: ring, angle: start })
  const b = polar({ cx: 0, cy: 0, r: ring, angle: lineEnd })
  const tip = polar({ cx: 0, cy: 0, r: ring, angle: end })
  const large = lineEnd - start > Math.PI ? 1 : 0
  const stroke = model.flywheel ? tokens.accent.strong : from.swatch.stroke
  return g(
    {},
    h('path', {
      d: `M${n(a.x)} ${n(a.y)}A${n(ring)} ${n(ring)} 0 ${large} 1 ${n(b.x)} ${n(b.y)}`,
      fill: 'none',
      stroke,
      'stroke-width': model.flywheel ? 4.5 : 3,
      'stroke-linecap': 'round',
    }),
    h('path', {
      d: arrowHead({ tip, angle: end + Math.PI / 2, size }),
      fill: model.flywheel ? tokens.accent.strong : from.swatch.strong,
    }),
  )
}

/** The label in the middle: a plain disc for a cycle, the accent hub for a flywheel. */
function hub({
  ctx,
  model,
  label,
  radius,
}: {
  ctx: Context
  model: CycleModel
  label: Hub
  radius: number
}): string {
  const { tokens } = ctx
  if (!model.center) return ''
  const disc = model.flywheel ? radius : Math.min(radius, label.need + 6)
  const inner = model.flywheel
    ? h('circle', {
        cx: 0,
        cy: 0,
        r: disc - 7,
        fill: 'none',
        stroke: tokens.accent.stroke,
        'stroke-width': 1.2,
        'stroke-dasharray': '1 6',
        'stroke-linecap': 'round',
      })
    : ''
  return g(
    {},
    h('circle', {
      cx: 0,
      cy: 0,
      r: disc,
      fill: model.flywheel ? tokens.accent.fill : tokens.surface,
      stroke: model.flywheel ? tokens.accent.stroke : tokens.border,
      'stroke-width': model.flywheel ? OUTLINE.strong : OUTLINE.thin,
    }),
    inner,
    sayer(ctx.text)({
      x: 0,
      y: 0,
      lines: label.lines,
      size: label.size,
      weight: WEIGHT.title,
      fill: tokens.fg,
    }),
  )
}

/** One stage: its circle or pill, its number badge and its note. */
function stage({
  ctx,
  model,
  node,
  index,
  bounds,
}: {
  ctx: Context
  model: CycleModel
  node: Node
  index: number
  bounds: Bounds
}): string {
  const { tokens } = ctx
  const say = sayer(ctx.text)
  const { at, swatch } = node
  bounds.add({ x: at.x - node.w / 2, y: at.y - node.h / 2, w: node.w, h: node.h })
  const shape = model.flywheel
    ? h('path', {
        d: roundedRect({
          x: at.x - node.w / 2,
          y: at.y - node.h / 2,
          w: node.w,
          h: node.h,
          r: node.h / 2,
        }),
        fill: tokens.surface,
        stroke: swatch.stroke,
        'stroke-width': OUTLINE.thin,
        filter: 'url(#mm-shadow)',
      })
    : h('circle', {
        cx: at.x,
        cy: at.y,
        r: node.w / 2,
        fill: tokens.surface,
        stroke: swatch.stroke,
        'stroke-width': OUTLINE.thin,
        filter: 'url(#mm-shadow)',
      })
  const badgeAt = polar({ cx: at.x, cy: at.y, r: node.w / 2, angle: -Math.PI * 0.75 })
  const badge = model.numbered
    ? g(
        {},
        h('circle', {
          cx: badgeAt.x,
          cy: badgeAt.y,
          r: 11,
          fill: tokens.surface,
          stroke: swatch.stroke,
          'stroke-width': OUTLINE.thin,
        }),
        say({
          x: badgeAt.x,
          y: badgeAt.y,
          lines: [String(index + 1)],
          size: 11,
          weight: WEIGHT.heading,
          fill: swatch.strong,
        }),
      )
    : ''
  return g(
    {},
    shape,
    say({
      x: at.x,
      y: at.y,
      lines: node.lines,
      size: STAGE,
      weight: WEIGHT.body,
      fill: tokens.fg,
    }),
    badge,
    node.item.note ? note({ ctx, node, bounds }) : '',
  )
}

/** A stage's note just outside the ring, anchored away from the center. */
function note({ ctx, node, bounds }: { ctx: Context; node: Node; bounds: Bounds }): string {
  const kit = ctx.text
  const cos = Math.cos(node.angle)
  const sin = Math.sin(node.angle)
  const side = Math.abs(cos) > 0.35
  const lines = kit.wrap(node.item.note ?? '', { size: NOTE, max: side ? 160 : 220 })
  const height = blockHeight({ kit, count: lines.length, size: NOTE })
  const sign = Math.sign(cos)
  const x = side ? node.at.x + sign * (node.w / 2 + 14) : node.at.x
  const y = side
    ? node.at.y + sin * node.h * 0.3
    : node.at.y + Math.sign(sin) * (node.h / 2 + 12 + height / 2)
  let anchor: 'start' | 'middle' | 'end' = 'middle'
  if (side) anchor = sign > 0 ? 'start' : 'end'
  bounds.addText({ kit, x, y, lines, size: NOTE, anchor })
  return sayer(kit)({ x, y, lines, size: NOTE, fill: ctx.tokens.muted, anchor })
}

export const cycle: DiagramType<CycleModel> = {
  id: 'cycle',
  keywords: ['cycle', 'flywheel'],
  title: 'Cycle',
  summary:
    'Stages around a ring with arrows from each to the next (PDCA, water cycle); `flywheel` adds a hub label.',
  guide: {
    useWhen: 'steps repeat in a loop, each one leading into the next.',
    syntax: `
One stage per line, in the order they happen:

\`\`\`
cycle "Title" !plain                  %% !plain hides the step numbers
  Plan : set a goal                   %% the first stage sits at 12 o'clock
  Do : run it #green                  %% : note, #color
  Check
  Act                                 %% the last stage's arrow returns to the first
  center "Improve"                    %% optional label in the middle
\`\`\`

- **Order:** stages go clockwise from the top in the order written, and each gets an arrow to the
  next. The loop closes by itself; don't repeat the first stage at the end.
- **Count:** at least two stages (an error otherwise). More than eight works but warns; three to
  six read best.
- **\`flywheel "Title"\`** draws the same stages as pills riding a heavy wheel, for a loop that
  gains momentum. Give it a hub: \`flywheel "Title" center="Momentum"\` in the header, or a
  \`center Momentum\` line.
- **Center:** a line starting with lowercase \`center\` or \`hub\`, then a space or colon, sets
  the middle label instead of adding a stage; \`center="..."\` in the header does the same. The
  last one wins. A capitalized \`Hub launch\` is a stage; quote a stage that starts with
  lowercase "hub " or "center ". A plain \`cycle\` shows the center in a small disc; it's optional for both.
- **Numbers:** a \`cycle\` numbers its stages; \`!plain\` turns that off. A \`flywheel\` is
  unnumbered; \`!numbered\` turns it on.
- **Note:** text after \`: \` (colon, then a space) is a note, placed outside the ring next to the
  stage. Keep stage labels to a few words: they wrap inside a small circle. Put detail in the note.
- **Color:** \`#name\` (\`red\`, \`coral\`, \`orange\`, \`amber\`, \`yellow\`, \`lime\`, \`green\`,
  \`moss\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`, \`indigo\`, \`violet\`, \`purple\`, \`magenta\`,
  \`pink\`, \`rose\`, \`brown\`, \`grey\`) or \`#hex\` at the end of a line. Without one, stages take
  the theme's colors in turn.
- **Read from the end of a line:** a trailing \`#color\` (palette name or hex), \`!word\` or
  \`key=value\` is taken as an option, not text; any other \`#word\`, like \`Ship #launch\`, stays
  in the text. Quote a label to keep a trailing \`!word\` or \`key=value\`, or a \`: \` in it.
- **One level only.** Indenting a line further doesn't nest it; it is just another stage.`,
    example: `
cycle "Plan–Do–Check–Act"
  Plan : set a goal and a hypothesis
  Do : run a small experiment
  Check : compare results with the plan
  Act : adopt, adapt or abandon
  center "Continuous improvement"`,
  },
  parse: parseCycle,
  render: renderCycle,
}
