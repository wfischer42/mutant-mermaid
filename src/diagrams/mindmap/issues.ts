import { roundedRect } from '../../core/geometry.ts'
import { clickSyntax, hitAreas, TREE_IDS, treeIds } from '../../core/hooks.ts'
import { h, n, text } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import {
  corner,
  OUTLINE,
  pick,
  type Swatch,
  swatchFor,
  type Tokens,
  WEIGHT,
} from '../../theme/index.ts'
import { Bounds, elbow } from './canvas.ts'
import { label, wrapEven } from './label.ts'
import { type OutlineNode, readOutline, rootOf } from './outline.ts'
import { type Tidy, tidy, walk } from './tidy.ts'

/**
 * A MECE issue tree, read left to right: the question on the left, broken into parts that don't
 * overlap and leave nothing out, each part broken down again to the right.
 *
 *   issues "Why are profits falling?"
 *     Revenue is down
 *       Fewer customers !hypothesis
 *       Lower prices
 *     Costs are up #teal
 *       Fixed costs
 *       Variable costs !key
 *
 * `!hypothesis` (or `!h`) marks a branch to test; `!key` marks the one that matters most.
 */
export interface IssueNode {
  label: string
  /** From an `id=` option, for click lines; otherwise the label names it. */
  id?: string
  color?: string
  hypothesis: boolean
  key: boolean
  line: number
  children: IssueNode[]
}

export interface IssuesModel {
  root: IssueNode
}

function toIssue(node: OutlineNode): IssueNode {
  return {
    label: node.label,
    id: node.attrs.id,
    color: node.color,
    hypothesis: node.flags.has('hypothesis') || node.flags.has('h'),
    key: node.flags.has('key'),
    line: node.line,
    children: node.children.map(toIssue),
  }
}

export function parseIssues(source: string): Parsed<IssuesModel> {
  const outline = readOutline({ source })
  const { root, diagnostics } = rootOf({ outline, what: 'issues' })
  if (!root) return { model: null, diagnostics }
  return { model: { root: toIssue(root) }, diagnostics }
}

interface Cell extends Tidy<Cell> {
  node: IssueNode
  depth: number
  swatch: Swatch
  lines: string[]
  fontSize: number
  weight: number
  textW: number
  w: number
  h: number
  x: number
  y: number
}

const COLUMN_GAP = 64
const STRIPE = 4
const FONTS = [
  { size: 16, weight: WEIGHT.title, max: 250 },
  { size: 15, weight: WEIGHT.heading, max: 190 },
  { size: 14, weight: WEIGHT.body, max: 200 },
]

function colorOf({
  node,
  tokens,
  fallback,
}: {
  node: IssueNode
  tokens: Tokens
  fallback: Swatch
}): Swatch {
  return (node.color && swatchFor({ tokens, color: node.color })) || fallback
}

function measure({
  node,
  depth,
  swatch,
  ctx,
}: {
  node: IssueNode
  depth: number
  swatch: Swatch
  ctx: Context
}): Cell {
  const font = FONTS[Math.min(depth, FONTS.length - 1)]
  const style = { size: font.size, weight: node.key ? WEIGHT.title : font.weight }
  const lines = wrapEven({ kit: ctx.text, text: node.label, style, max: font.max })
  const textW = Math.max(...lines.map((l) => ctx.text.width(l, style)))
  const hh = lines.length * ctx.text.lineHeight(style) + (depth === 0 ? 30 : 20)
  const tokens = ctx.tokens
  return {
    node,
    depth,
    swatch,
    lines,
    fontSize: style.size,
    weight: style.weight,
    textW,
    w: 0,
    h: hh,
    size: hh,
    x: 0,
    y: 0,
    lo: 0,
    hi: 0,
    offset: 0,
    center: 0,
    children: node.children.map((child, i) =>
      measure({
        node: child,
        depth: depth + 1,
        swatch: colorOf({
          node: child,
          tokens,
          fallback: depth === 0 ? pick({ tokens, index: i }) : swatch,
        }),
        ctx,
      }),
    ),
  }
}

/** Columns by depth, every card in a column as wide as the widest, then a tidy layout down. */
function place(root: Cell): Cell[] {
  const cells = walk(root)
  const depths = Math.max(...cells.map((c) => c.depth)) + 1
  const pad = (depth: number) => (depth === 0 ? 40 : 28 + (depth >= 2 ? STRIPE + 8 : 0))
  const colW = Array.from({ length: depths }, (_, d) =>
    Math.max(...cells.filter((c) => c.depth === d).map((c) => c.textW + pad(d))),
  )
  const colX = colW.map((_, d) => colW.slice(0, d).reduce((sum, w) => sum + w + COLUMN_GAP, 0))
  for (const cell of cells) {
    cell.w = colW[cell.depth]
    cell.lo = colX[cell.depth]
    cell.hi = cell.lo + cell.w
  }
  tidy({ root, gap: (depth) => (depth === 0 ? 26 : 10) })
  for (const cell of cells) {
    cell.x = cell.lo
    cell.y = cell.center - cell.h / 2
  }
  return cells
}

function cardFill({ cell, tokens }: { cell: Cell; tokens: Tokens }): {
  fill: string
  stroke: string
  ink: string
} {
  if (cell.depth === 0) return { fill: tokens.surface, stroke: tokens.fg, ink: tokens.fg }
  if (cell.depth === 1) return { fill: tokens.surface, stroke: cell.swatch.stroke, ink: tokens.fg }
  return { fill: tokens.surface, stroke: cell.swatch.soft, ink: tokens.fg }
}

/** A small "H" tag on the corner of a hypothesis. */
function hypothesisTag({ cell, tokens }: { cell: Cell; tokens: Tokens }): string {
  const cx = cell.x + cell.w - 2
  const cy = cell.y + 2
  return [
    h('circle', { cx, cy, r: 9, fill: cell.swatch.strong, stroke: tokens.bg, 'stroke-width': 2 }),
    text({
      x: cx,
      y: cy,
      lines: ['H'],
      size: 10.5,
      weight: WEIGHT.heading,
      fill: tokens.bg,
      lineHeight: 12,
      shift: 3.8,
    }),
  ].join('')
}

function drawCell({ cell, ctx }: { cell: Cell; ctx: Context }): string {
  const { tokens, text: kit } = ctx
  const look = cardFill({ cell, tokens })
  const deep = cell.depth >= 2
  const strong = cell.node.key || cell.depth === 1
  const r = (base: number) => corner({ tokens, r: base })
  return [
    h('path', {
      d: roundedRect({
        x: cell.x,
        y: cell.y,
        w: cell.w,
        h: cell.h,
        r: r(cell.depth === 0 ? 14 : 10),
      }),
      fill: look.fill,
      stroke: cell.node.key ? cell.swatch.strong : look.stroke,
      'stroke-width': strong ? OUTLINE.strong : OUTLINE.thin,
      'stroke-dasharray': cell.node.hypothesis ? '5 4' : undefined,
      filter: 'url(#mm-shadow)',
    }),
    deep &&
      h('path', {
        d: roundedRect({
          x: cell.x + 9,
          y: cell.y + 8,
          w: STRIPE,
          h: cell.h - 16,
          r: r(STRIPE / 2),
        }),
        fill: cell.swatch.stroke,
      }),
    label({
      kit,
      x: cell.depth === 0 ? cell.x + cell.w / 2 : cell.x + (deep ? 14 + STRIPE + 8 : 14),
      y: cell.y + cell.h / 2,
      lines: cell.lines,
      size: cell.fontSize,
      weight: cell.weight,
      fill: look.ink,
      anchor: cell.depth === 0 ? 'middle' : 'start',
    }),
    cell.node.hypothesis && hypothesisTag({ cell, tokens }),
  ]
    .filter(Boolean)
    .join('')
}

/** A bracket from a parent to its children: a stem, a spine, and a rounded stub into each child. */
function bracket({ parent, tokens }: { parent: Cell; tokens: Tokens }): string {
  if (!parent.children.length) return ''
  const px = parent.x + parent.w
  const py = parent.center
  const xs = px + COLUMN_GAP / 2
  const trunk = parent.depth === 0 ? tokens.faint : parent.swatch.stroke
  const width = parent.depth === 0 ? 2 : 1.6
  const stubs = parent.children.map((child) => ({
    child,
    ...elbow({ x: xs, y: py, toX: child.x - 1, toY: child.center, r: corner({ tokens, r: 10 }) }),
  }))
  const ys = [py, ...stubs.map((s) => s.startY)]
  const spine = `M${n(px)} ${n(py)}H${n(xs)}M${n(xs)} ${n(Math.min(...ys))}V${n(Math.max(...ys))}`
  const line = { fill: 'none', 'stroke-width': width, 'stroke-linecap': 'round' as const }
  return [
    h('path', { d: spine, stroke: trunk, ...line }),
    ...stubs.map((s) => h('path', { d: s.d, stroke: s.child.swatch.stroke, ...line })),
    h('circle', { cx: px, cy: py, r: 3, fill: trunk }),
  ].join('')
}

export function renderIssues(model: IssuesModel, ctx: Context): Drawing {
  const { tokens } = ctx
  const rootSwatch = colorOf({ node: model.root, tokens, fallback: tokens.accent })
  const root = measure({ node: model.root, depth: 0, swatch: rootSwatch, ctx })
  const cells = place(root)
  const bounds = new Bounds()
  for (const cell of cells)
    bounds.add({ x: cell.x, y: cell.y - 10, w: cell.w + 10, h: cell.h + 10 })
  const ids = treeIds(model.root)
  const body = [
    h('g', { class: 'mm-brackets' }, ...cells.map((parent) => bracket({ parent, tokens }))),
    h('g', { class: 'mm-cards' }, ...cells.map((cell) => drawCell({ cell, ctx }))),
    hitAreas(
      cells.map((cell) => ({
        id: ids.get(cell.node) ?? '',
        kind: 'issue',
        tint: cell.swatch.stroke,
        box: cell,
      })),
    ),
  ].join('')
  return bounds.drawing({ body, margin: 24, title: model.root.label })
}

export const issues: DiagramType<IssuesModel> = {
  id: 'issues',
  keywords: ['issues', 'tree'],
  title: 'Issue tree',
  summary:
    'A MECE issue tree: a question on the left broken into non-overlapping parts, left to right. `!hypothesis` marks branches to test.',
  guide: {
    useWhen:
      'a question is broken into parts that together cover it, to find where the answer lies.',
    syntax: `
The question is the title. Each part is an indented line under the line it breaks down:

\`\`\`
issues "Why are profits falling?"
  Revenue is down              %% a top-level part, in its own color
    Fewer customers !hypothesis  %% dashed, with an H tag: a branch to test
    Lower prices
  Costs are up #teal           %% #color tints it and everything under it
    Variable costs !key        %% bold, with a strong outline: what matters most
\`\`\`

- \`tree\` is the same type as \`issues\`.
- **Parts should be MECE:** siblings don't overlap, and together they cover their parent. Phrase
  each as a short statement or sub-question. Two to four per parent reads best.
- **Nesting:** a line is the child of the nearest line above it that is indented less. Any amount
  of indent works; a tab counts as 4 spaces. It reads left to right, one column per level, each
  column as wide as its widest card, so keep labels short. Three or four levels is plenty.
- **Flags** go at the end of a line: \`!hypothesis\` (or \`!h\`) marks a branch to test; \`!key\` marks
  the one that matters most. A line can have both. Other \`!words\` are ignored.
- **Colors:** each top-level part takes the next theme color in turn, and everything under it
  shares that color. \`#name\` or \`#hex\` at the end of a line sets it for that node and everything
  under it. Names: red, coral, orange, amber, yellow, lime, green, moss, teal, cyan, sky, blue,
  indigo, violet, purple, magenta, pink, rose, brown, grey. A \`#color\` on the header colors the
  question, and \`!key\` there works too.
- **Trailing words that look like options are taken as options:** at the end of a line, a
  \`#color\` (palette name or hex) sets the color and \`key=value\` is removed. Any other \`#word\`
  stays in the text: \`Fewer #enterprise deals\`. Quote the label to keep a \`key=value\`.
- \`<br>\` in a label breaks the line; long labels wrap on their own.
- **Without a title** (\`issues\` alone), the first indented line is the question, and a second
  top-level line warns and is moved under it. Prefer the title.
${clickSyntax(TREE_IDS)}`,
    example: `
issues "How do we cut churn in half by Q4?"
  Keep new users past week one #teal
    Faster onboarding
    A first win within a day !hypothesis
  Win back lapsing users #coral
    Reminder emails at day 14
    Pause instead of cancel !key
  Stop involuntary churn #violet
    Retry failed payments !hypothesis
    Card-expiry warnings`,
  },
  parse: parseIssues,
  render: renderIssues,
}
