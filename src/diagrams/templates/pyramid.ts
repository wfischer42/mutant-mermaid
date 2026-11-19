import { type Point, roundedPolygon } from '../../core/geometry.ts'
import { type Diagnostic, readLines } from '../../core/parse.ts'
import { g, h, n, text } from '../../core/svg.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { corner, OUTLINE, WEIGHT } from '../../theme/index.ts'
import { Bounds, frame, type Hues, ramp, readHead, readHues, readItem } from './common.ts'

/**
 * A pyramid of tiers, foundation at the bottom:
 *
 *   pyramid "Maslow's hierarchy"
 *     Self-actualization : creativity, purpose
 *     Esteem
 *     Physiological : food, water, sleep #amber
 *
 * The first tier listed is the apex. Text after `: ` is a note shown beside the tier. `funnel`
 * (or `!inverted`) draws it widest at the top.
 */
export interface PyramidModel {
  title: string
  tiers: { label: string; note?: string; color?: string }[]
  inverted: boolean
  hues?: Hues
}

export function parsePyramid(source: string): Parsed<PyramidModel> {
  const [first, ...rest] = readLines(source)
  const diagnostics: Diagnostic[] = []
  const head = readHead(first)
  const tiers = rest.map((line) => {
    const { label, note, color } = readItem(line)
    return { label, note, color }
  })
  if (!tiers.length)
    diagnostics.push({
      line: head.line,
      message: 'A pyramid needs at least one tier, indented under it.',
      severity: 'error',
    })
  const { hues, diagnostic } = readHues(head)
  if (diagnostic) diagnostics.push(diagnostic)
  return {
    model: {
      title: head.title,
      tiers,
      inverted: head.keyword === 'funnel' || head.flags.has('inverted'),
      hues,
    },
    diagnostics,
  }
}

const GAP = 6

/**
 * Tiers stack with a fixed slope, so the narrow end is as wide as the widest label needs. Few
 * tiers get taller bands and a steeper slope, so a short pyramid still reads as one.
 */
export function renderPyramid(model: PyramidModel, ctx: Context): Drawing {
  const { tokens, text: kit, rng } = ctx
  const count = model.tiers.length
  const size = 15
  const noteSize = 13
  const TIER = count <= 3 ? 62 : 54
  const height = count * TIER + (count - 1) * GAP
  const slope = count <= 3 ? 1.6 : 1.25
  const narrowEnd = Math.max(
    40,
    ...model.tiers.map((t, i) => {
      const fromNarrow = model.inverted ? count - 1 - i : i
      const mid = fromNarrow * (TIER + GAP) + TIER / 2
      return kit.width(t.label, { size, weight: WEIGHT.heading }) + 44 - slope * mid
    }),
  )
  const base = narrowEnd + slope * height
  const notes = model.tiers.map((t) =>
    t.note ? kit.wrap(t.note, { size: noteSize, max: 260 }) : [],
  )
  const left = 0
  const cx = left + base / 2
  const widthAt = (y: number) => narrowEnd + slope * (model.inverted ? height - y : y)
  const bounds = new Bounds()
  bounds.add({ x: 0, y: 0, w: base, h: height })
  const parts: string[] = []
  model.tiers.forEach((tier, i) => {
    const swatch = ramp({ tokens, color: tier.color, index: i, count, hues: model.hues })
    const y0 = i * (TIER + GAP)
    const y1 = y0 + TIER
    const w0 = widthAt(y0)
    const w1 = widthAt(y1)
    const j = () => (tokens.look === 'sketch' ? rng.normal() * 0.7 : 0)
    const corners: Point[] = [
      { x: cx - w0 / 2 + j(), y: y0 + j() },
      { x: cx + w0 / 2 + j(), y: y0 + j() },
      { x: cx + w1 / 2 + j(), y: y1 + j() },
      { x: cx - w1 / 2 + j(), y: y1 + j() },
    ]
    const shape = roundedPolygon({ points: corners, r: corner({ tokens, r: 9 }) })
    parts.push(
      h('path', {
        d: shape,
        fill: swatch.fill,
        stroke: swatch.stroke,
        'stroke-width': OUTLINE.thin,
        'stroke-linejoin': 'round',
      }),
      text({
        x: cx,
        y: (y0 + y1) / 2,
        lines: [tier.label],
        size,
        weight: WEIGHT.heading,
        fill: tokens.fg,
        lineHeight: kit.lineHeight({ size }),
        shift: kit.baselineShift({ size }),
      }),
    )
    if (!notes[i].length) return
    const edge = cx + (w0 + w1) / 4 + 12
    const noteX = left + base + 28
    const mid = (y0 + y1) / 2
    parts.push(
      h('path', {
        d: `M${n(edge)} ${n(mid)}L${n(noteX - 14)} ${n(mid)}`,
        stroke: swatch.stroke,
        'stroke-width': 1,
        'stroke-dasharray': '1.5 3',
        'stroke-linecap': 'round',
        fill: 'none',
      }),
      h('circle', { cx: noteX - 8, cy: mid, r: 3, fill: swatch.stroke }),
      text({
        x: noteX,
        y: mid,
        lines: notes[i],
        size: noteSize,
        fill: tokens.muted,
        anchor: 'start',
        lineHeight: kit.lineHeight({ size: noteSize }),
        shift: kit.baselineShift({ size: noteSize }),
      }),
    )
    bounds.addText({ kit, x: noteX, y: mid, lines: notes[i], size: noteSize, anchor: 'start' })
  })
  return frame({ ctx, title: model.title, body: g({}, ...parts), bounds })
}

export const pyramid: DiagramType<PyramidModel> = {
  id: 'pyramid',
  keywords: ['pyramid', 'funnel'],
  title: 'Pyramid',
  summary: 'Stacked tiers from foundation to apex; `funnel` draws it upside down.',
  guide: {
    useWhen: 'levels stack on each other, or a quantity narrows stage by stage.',
    syntax: `
One tier per line, top tier first:

\`\`\`
pyramid "Title"
  Apex : a note beside the tier       %% the first line is the top tier
  Middle #amber                       %% #color tints the tier
  Foundation                          %% the last line is the bottom tier
\`\`\`

- **Order:** tiers are drawn top to bottom in the order written. In a \`pyramid\` the first tier is
  the narrow apex and the last is the wide base. In a \`funnel\` the first is the wide top.
- **Upside down:** \`funnel "Title"\` or \`pyramid "Title" !inverted\`. A \`funnel\` is always
  upside down; there is no flag to undo it.
- **Note:** text after \`: \` (colon, then a space) is a note, drawn to the right of the tier with
  a dotted leader. Notes wrap; tier labels don't, so keep labels short (one to three words) and
  put detail in the note. A colon with no space after it (\`3:1\`) stays in the label.
- **Color:** \`#name\` (\`red\`, \`coral\`, \`orange\`, \`amber\`, \`yellow\`, \`lime\`, \`green\`,
  \`moss\`, \`teal\`, \`cyan\`, \`sky\`, \`blue\`, \`indigo\`, \`violet\`, \`purple\`, \`magenta\`,
  \`pink\`, \`rose\`, \`brown\`, \`grey\`) or \`#hex\` at the end of a line. Without one, tiers
  shade from faint to deeper while sliding between two neighboring hues, teal to blue unless
  the header says otherwise: \`colors=green-teal\`, \`colors=blue-violet\`, \`colors=violet-pink\`,
  or one name (\`colors=amber\`) to keep a single hue. Pick neighbors on the wheel; two far-apart
  hues read as a rainbow.
- **Read from the end of a line:** a trailing \`#color\` (palette name or hex), \`!word\` or
  \`key=value\` is taken as an option, not text; any other \`#word\`, like \`Ship #launch\`, stays
  in the text. Quote a label to keep a trailing \`!word\` or \`key=value\`, or a \`: \` in it.
- **One level only.** Indenting a line further doesn't nest it; it is just another tier.
- **Size:** any number of tiers works; three to six read best. At least one is required.`,
    example: `
funnel "Trial to paid"
  Visitors : 120,000 a month
  Sign-ups : 9,600 (8% of visitors)
  Activated : 4,100 (43% of sign-ups)
  Paying : 820 (20% of activated) #teal`,
  },
  parse: parsePyramid,
  render: renderPyramid,
}
