import { arrowHead, cubicAt, cubicPath, type Point, roundedRect } from '../../core/geometry.ts'
import { clickSyntax, hitAreas, TREE_IDS, treeIds } from '../../core/hooks.ts'
import type { Diagnostic } from '../../core/parse.ts'
import { h, text } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { corner, OUTLINE, type Swatch, swatchFor, type Tokens, WEIGHT } from '../../theme/index.ts'
import { Bounds } from './canvas.ts'
import { label, wrapEven } from './label.ts'
import { type OutlineNode, readOutline, rootOf } from './outline.ts'
import { type Tidy, tidy, walk } from './tidy.ts'

/**
 * An argument map, after Argdown: a claim at the top, reasons that support (`+`) or attack (`-`)
 * it below, and reasons for and against those reasons below them. `?` marks an open question.
 *
 *   argue "We should move to a four-day week"
 *     + Rested teams ship better work
 *       - The studies are small and self-selected
 *     - Customers expect five-day support
 *       ? Could staggered rotas cover Fridays?
 */
export type Relation = 'claim' | 'support' | 'attack' | 'question' | 'note'

export interface ArgNode {
  label: string
  /** From an `id=` option, for click lines; otherwise the label names it. */
  id?: string
  relation: Relation
  color?: string
  line: number
  children: ArgNode[]
}

export interface ArgueModel {
  root: ArgNode
}

const MARKS: Record<string, Relation> = {
  '+': 'support',
  '-': 'attack',
  '−': 'attack',
  '–': 'attack',
  '?': 'question',
}

function toArg({ node, diagnostics }: { node: OutlineNode; diagnostics: Diagnostic[] }): ArgNode {
  const relation = (node.mark && MARKS[node.mark]) || 'note'
  if (!node.mark)
    diagnostics.push({
      line: node.line,
      message: `"${node.label}" has no + or - in front, so it's drawn as a neutral note. Start it with "+ " to support or "- " to attack.`,
      severity: 'warning',
    })
  return {
    label: node.label,
    id: node.attrs.id,
    relation,
    color: node.color,
    line: node.line,
    children: node.children.map((child) => toArg({ node: child, diagnostics })),
  }
}

export function parseArgue(source: string): Parsed<ArgueModel> {
  const outline = readOutline({ source, mark: /^([+\-−–?])\s+/ })
  const { root, diagnostics } = rootOf({ outline, what: 'argue' })
  if (!root) return { model: null, diagnostics }
  const problems = [...diagnostics]
  const children = root.children.map((node) => toArg({ node, diagnostics: problems }))
  return {
    model: {
      root: { label: root.label, relation: 'claim', color: root.color, line: root.line, children },
    },
    diagnostics: problems,
  }
}

interface Card extends Tidy<Card> {
  node: ArgNode
  depth: number
  swatch: Swatch
  lines: string[]
  fontSize: number
  weight: number
  w: number
  h: number
  x: number
  y: number
}

const ROW_GAP = 76
const PAD_X = 16
const STRIPE = 4

function swatchOf({ node, tokens }: { node: ArgNode; tokens: Tokens }): Swatch {
  const own = node.color ? swatchFor({ tokens, color: node.color }) : null
  if (own) return own
  const bySemantic: Record<Relation, Swatch> = {
    claim: tokens.accent,
    support: tokens.semantic.positive,
    attack: tokens.semantic.negative,
    question: tokens.semantic.caution,
    note: tokens.semantic.neutral,
  }
  return bySemantic[node.relation]
}

function measure({ node, depth, ctx }: { node: ArgNode; depth: number; ctx: Context }): Card {
  const claim = depth === 0
  const style = { size: claim ? 16 : 14, weight: claim ? WEIGHT.title : WEIGHT.body }
  const lines = wrapEven({ kit: ctx.text, text: node.label, style, max: claim ? 300 : 220 })
  const textW = Math.max(...lines.map((l) => ctx.text.width(l, style)))
  const inset = claim ? 0 : STRIPE + 10
  const w = Math.max(claim ? 160 : 120, textW + PAD_X * 2 + inset)
  const hh = lines.length * ctx.text.lineHeight(style) + (claim ? 30 : 24)
  return {
    node,
    depth,
    swatch: swatchOf({ node, tokens: ctx.tokens }),
    lines,
    fontSize: style.size,
    weight: style.weight,
    w,
    h: hh,
    size: w,
    x: 0,
    y: 0,
    lo: 0,
    hi: 0,
    offset: 0,
    center: 0,
    children: node.children.map((child) => measure({ node: child, depth: depth + 1, ctx })),
  }
}

/** Rows by depth, each as tall as its tallest card, then a tidy layout across. */
function place(root: Card): Card[] {
  const cards = walk(root)
  const depths = Math.max(...cards.map((c) => c.depth)) + 1
  const rowH = Array.from({ length: depths }, (_, d) =>
    Math.max(...cards.filter((c) => c.depth === d).map((c) => c.h)),
  )
  const rowTop = rowH.map((_, d) => rowH.slice(0, d).reduce((sum, rh) => sum + rh + ROW_GAP, 0))
  for (const card of cards) {
    card.lo = rowTop[card.depth]
    card.hi = rowTop[card.depth] + rowH[card.depth]
  }
  tidy({ root, gap: (depth) => (depth === 0 ? 44 : 22) })
  for (const card of cards) {
    card.x = card.center - card.w / 2
    card.y = card.lo
  }
  return cards
}

function drawCard({ card, ctx }: { card: Card; ctx: Context }): string {
  const { tokens, text: kit } = ctx
  const claim = card.depth === 0
  const dashed = card.node.relation === 'question'
  const r = (base: number) => corner({ tokens, r: base })
  const box = roundedRect({ x: card.x, y: card.y, w: card.w, h: card.h, r: r(claim ? 14 : 10) })
  const inset = claim ? 0 : STRIPE + 10
  return [
    h('path', {
      d: box,
      fill: tokens.surface,
      stroke: claim ? card.swatch.stroke : card.swatch.soft,
      'stroke-width': claim ? OUTLINE.strong : OUTLINE.thin,
      'stroke-dasharray': dashed ? '5 4' : undefined,
      filter: 'url(#mm-shadow)',
    }),
    !claim &&
      h('path', {
        d: roundedRect({
          x: card.x + 9,
          y: card.y + 9,
          w: STRIPE,
          h: card.h - 18,
          r: r(STRIPE / 2),
        }),
        fill: card.swatch.stroke,
      }),
    label({
      kit,
      x: claim ? card.x + card.w / 2 : card.x + PAD_X + inset,
      y: card.y + card.h / 2,
      lines: card.lines,
      size: card.fontSize,
      weight: card.weight,
      fill: tokens.fg,
      anchor: claim ? 'middle' : 'start',
    }),
  ]
    .filter(Boolean)
    .join('')
}

/** A small round badge on a connector: +, − or ?. */
function badge({ at, card, tokens }: { at: Point; card: Card; tokens: Tokens }): string {
  const { relation } = card.node
  if (relation === 'note') return ''
  const disc = h('circle', {
    cx: at.x,
    cy: at.y,
    r: 10,
    fill: card.swatch.strong,
    stroke: tokens.bg,
    'stroke-width': 2.5,
  })
  const mark = { stroke: tokens.bg, 'stroke-width': 2.2, 'stroke-linecap': 'round' as const }
  const minus = h('path', { d: `M${at.x - 4.5} ${at.y}H${at.x + 4.5}`, ...mark })
  const plus = h('path', { d: `M${at.x} ${at.y - 4.5}V${at.y + 4.5}`, ...mark })
  if (relation === 'support') return disc + minus + plus
  if (relation === 'attack') return disc + minus
  return (
    disc +
    text({
      x: at.x,
      y: at.y,
      lines: ['?'],
      size: 13,
      weight: WEIGHT.heading,
      fill: tokens.bg,
      lineHeight: 13,
      shift: 13 * 0.36,
    })
  )
}

/** From a reason's top up to its parent's bottom, ending in an arrowhead: reasons bear on claims. */
function connector({
  parent,
  card,
  index,
  tokens,
}: {
  parent: Card
  card: Card
  index: number
  tokens: Tokens
}): string {
  const count = parent.children.length
  const spacing = count > 1 ? Math.min(28, (parent.w - 36) / (count - 1)) : 0
  const ax = parent.x + parent.w / 2 + (index - (count - 1) / 2) * spacing
  const tip = { x: ax, y: parent.y + parent.h + 2 }
  const from = { x: card.x + card.w / 2, y: card.y }
  const to = { x: ax, y: tip.y + 7 }
  const dy = from.y - to.y
  const curve = {
    from,
    c1: { x: from.x, y: from.y - dy * 0.5 },
    c2: { x: to.x, y: to.y + dy * 0.5 },
    to,
  }
  return [
    h('path', {
      d: cubicPath(curve),
      fill: 'none',
      stroke: card.swatch.stroke,
      'stroke-width': 2,
      'stroke-dasharray': card.node.relation === 'question' ? '5 4' : undefined,
    }),
    h('path', { d: arrowHead({ tip, angle: -Math.PI / 2, size: 10 }), fill: card.swatch.stroke }),
    badge({ at: cubicAt({ curve, t: 0.5 }), card, tokens }),
  ].join('')
}

export function renderArgue(model: ArgueModel, ctx: Context): Drawing {
  const root = measure({ node: model.root, depth: 0, ctx })
  const cards = place(root)
  const bounds = new Bounds()
  for (const card of cards) bounds.add(card)
  const links = cards.flatMap((parent) =>
    parent.children.map((card, index) => connector({ parent, card, index, tokens: ctx.tokens })),
  )
  const ids = treeIds(model.root)
  const body = [
    h('g', { class: 'mm-links' }, ...links),
    h('g', { class: 'mm-cards' }, ...cards.map((card) => drawCard({ card, ctx }))),
    hitAreas(
      cards.map((card) => ({
        id: ids.get(card.node) ?? '',
        kind: card.node.relation,
        tint: card.swatch.stroke,
        box: card,
      })),
    ),
  ].join('')
  return bounds.drawing({ body, margin: 28, title: model.root.label })
}

export const argue: DiagramType<ArgueModel> = {
  id: 'argue',
  keywords: ['argue'],
  title: 'Argument map',
  summary:
    'A claim with reasons for (+) and against (-) it, and reasons about those reasons, as a top-down tree of cards.',
  guide: {
    useWhen: 'a claim is being weighed and the reasons for and against it are the point.',
    syntax: `
The claim is the title. Each reason is an indented line that starts with what it does to its parent:

\`\`\`
argue "We should move to a four-day week"
  + Rested teams do better work        %% + supports the line it's under
    - The studies are small            %% - attacks it
      + But one covered 2,500 workers  %% reasons about reasons, any depth
  - Customers expect five-day support
    ? Could staggered rotas cover it?  %% ? an open question
\`\`\`

- **Marks:** \`+\` supports, \`-\` attacks (\`−\` and \`–\` work too), \`?\` asks an open question.
  The mark needs a space after it: \`+Reason\` has no mark.
- **Every line under the claim needs a mark.** One without gets a warning and is drawn as a grey
  neutral note, with the text kept as written. Don't write Markdown bullets: \`- Point\` is an attack.
- **A mark is relative to the parent line**, not the claim: \`+\` under a \`-\` backs up the attack.
- **Nesting:** a line is the child of the nearest line above it that is indented less. Any amount
  of indent works; a tab counts as 4 spaces. It draws top-down, the claim at the top, so many
  siblings make it wide: keep each level to a few reasons, and each reason to one short sentence.
- **Colors** come from the mark: green supports, red attacks, amber dashed for questions. \`#name\`
  or \`#hex\` at the end of a line recolors just that card (names as in other types: \`#teal\`,
  \`#violet\`…). A \`#color\` on the header colors the claim.
- **Trailing words that look like options are taken as options:** at the end of a line, a
  \`#color\` (palette name or hex), \`!word\` and \`key=value\` are removed from the text (and
  ignored, except the color). Any other \`#word\` stays: \`+ It answers #support\`. Quote the
  reason to keep a trailing \`!word\` or \`key=value\`.
- \`<br>\` in a reason breaks the line; long reasons wrap on their own.
- **Without a title** (\`argue\` alone), the first indented line is the claim, and a second
  top-level line warns and is moved under it. Prefer the title.
${clickSyntax(TREE_IDS)}`,
    example: `
argue "Rewrite the billing service in Rust"
  + Memory safety removes a class of outages
    - Our last three outages were config errors, not memory bugs
  + The hot path is CPU-bound
    - Profiling says most time is spent waiting on the database
  - Nobody on the team has shipped Rust in production
    + Two engineers are keen to learn it
  ? Is a targeted rewrite of the invoicing module enough?`,
  },
  parse: parseArgue,
  render: renderArgue,
}
