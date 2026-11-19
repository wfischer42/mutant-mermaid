import { clickSyntax, TREE_IDS } from '../../core/hooks.ts'
import type { Diagnostic, Line } from '../../core/parse.ts'
import type { DiagramType, Parsed } from '../../core/types.ts'
import { renderMindmap } from './mindmap-draw.ts'
import { type OutlineNode, readOutline, rootOf } from './outline.ts'
import { walk } from './tidy.ts'

/**
 * A mind map: the topic in the middle, main branches out to both sides, and each idea in its own
 * card joined to its parent by an even S-curve.
 *
 *   mindmap "Trip to Japan"
 *     🏯 Kyoto #coral
 *       Fushimi Inari
 *     Tokyo
 *       Shibuya
 *   ~ Kyoto -- "day trip from" --> Tokyo
 *
 * Mermaid's own syntax works too: `mindmap` alone, then the root as the first indented line, with
 * node shapes, `::icon(...)` and `:::class` ignored. `layout=right` puts every branch on the right;
 * `style=elbow`, `style=hairline` or `style=organic` (tapered Buzan ribbons) draw it differently.
 */
export interface MindNode {
  label: string
  /** From an `id=` option, for click lines; otherwise the label names it. */
  id?: string
  color?: string
  line: number
  children: MindNode[]
}

export interface CrossLink {
  from: MindNode
  to: MindNode
  label: string
  both: boolean
  line: number
}

export type MindLayout = 'balanced' | 'right'

/** How branches and nodes are drawn: boxed cards, square brackets, hairlines or tapered ribbons. */
export const MIND_STYLES = ['cards', 'elbow', 'hairline', 'organic'] as const
export type MindStyle = (typeof MIND_STYLES)[number]

export interface MindmapModel {
  root: MindNode
  links: CrossLink[]
  layout?: MindLayout
  style?: MindStyle
}

function toMind(node: OutlineNode): MindNode {
  return {
    label: node.label,
    id: node.attrs.id,
    color: node.color,
    line: node.line,
    children: node.children.map(toMind),
  }
}

function normal(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Finds a node by its label: exactly, else the one node whose label contains the words. */
export function findNode({ nodes, ref }: { nodes: MindNode[]; ref: string }): MindNode | undefined {
  const want = normal(ref)
  if (!want) return undefined
  const exact = nodes.find((node) => normal(node.label) === want)
  if (exact) return exact
  const partial = nodes.filter((node) => normal(node.label).includes(want))
  return partial.length === 1 ? partial[0] : undefined
}

function unquoted(text: string): string {
  return /^".*"$/.test(text) ? text.slice(1, -1) : text
}

/**
 * `A -- "label" --> B`, `A --> B : label` or `A <--> B`, after the leading `~`. A side that
 * `isName` accepts whole is never split for a label, so `Plan - B --> X` can name "Plan - B".
 */
export function parseLinkText(
  body: string,
  isName: (text: string) => boolean = () => false,
): { from: string; to: string; label: string; both: boolean } | null {
  const m = /^(.*?)\s*(<)?--?>\s*(.*)$/.exec(body)
  if (!m) return null
  const [, left, back, right] = m
  const labelled = isName(left) ? null : /^(.*?)\s+--?\s+(.*)$/.exec(left)
  const after = isName(right) ? null : /^(.*?)\s+:\s+(.*)$/.exec(right)
  const from = (labelled ? labelled[1] : left).trim()
  const to = (after ? after[1] : right).trim()
  const label = labelled?.[2] ?? after?.[2] ?? ''
  if (!from || !to) return null
  return {
    from: unquoted(from),
    to: unquoted(to),
    label: unquoted(label.trim()),
    both: Boolean(back),
  }
}

export function layoutOf(value: string | undefined): MindLayout | undefined {
  if (value === 'balanced' || value === 'right') return value
  return undefined
}

export function styleOf(value: string | undefined): MindStyle | undefined {
  return MIND_STYLES.find((style) => style === value)
}

function readLink({ line, nodes }: { line: Line; nodes: MindNode[] }): CrossLink | Diagnostic {
  const isName = (text: string) => {
    const want = normal(unquoted(text.trim()))
    return nodes.some((node) => normal(node.label) === want)
  }
  const parsed = parseLinkText(line.text.slice(1).trim(), isName)
  if (!parsed)
    return {
      line: line.no,
      message: 'A cross-link reads `~ From -- "label" --> To`, naming two nodes by their labels.',
      severity: 'warning',
    }
  const from = findNode({ nodes, ref: parsed.from })
  const to = findNode({ nodes, ref: parsed.to })
  if (!from || !to) {
    const missing = [from ? '' : parsed.from, to ? '' : parsed.to].filter(Boolean)
    return {
      line: line.no,
      message: `Cross-link: no node called ${missing.map((m) => `"${m}"`).join(' or ')}. Use a node's label as written.`,
      severity: 'warning',
    }
  }
  return { from, to, label: parsed.label, both: parsed.both, line: line.no }
}

function isLink(value: CrossLink | Diagnostic): value is CrossLink {
  return 'from' in value
}

export function parseMindmap(source: string): Parsed<MindmapModel> {
  const outline = readOutline({ source, aside: (line) => line.startsWith('~') })
  const { root: top, diagnostics } = rootOf({ outline, what: 'mindmap' })
  if (!top) return { model: null, diagnostics }
  const root = toMind(top)
  const nodes = walk(root)
  const read = outline.asides.map((line) => readLink({ line, nodes }))
  const links = read.filter(isLink)
  const problems = [...diagnostics, ...read.filter((r): r is Diagnostic => !isLink(r))]
  const layout = layoutOf(outline.attrs.layout)
  if (outline.attrs.layout && !layout)
    problems.push({
      line: outline.headerLine,
      message: `layout=${outline.attrs.layout} isn't known; use layout=balanced or layout=right.`,
      severity: 'warning',
    })
  const style = styleOf(outline.attrs.style)
  if (outline.attrs.style && !style)
    problems.push({
      line: outline.headerLine,
      message: `style=${outline.attrs.style} isn't known; use style=${MIND_STYLES.join(', style=')}.`,
      severity: 'warning',
    })
  return { model: { root, links, layout, style }, diagnostics: problems }
}

export const mindmap: DiagramType<MindmapModel> = {
  id: 'mindmap',
  keywords: ['mindmap'],
  title: 'Mind map',
  summary:
    'Mind map: colored branches of cards around a central topic (`style=elbow|hairline|organic` for other looks), with optional `~ A --> B` cross-links. Reads Mermaid mindmaps too.',
  guide: {
    useWhen: 'ideas branch out from one central topic and the hierarchy is the point.',
    syntax: `
An indented outline under the topic. Each line is one node; indent it under its parent:

\`\`\`
mindmap "Trip to Japan" layout=right style=elbow  %% options go after the title
  🏯 Kyoto #coral                  %% a main branch; #color tints it and all under it
    Fushimi Inari
    Gion<br>at night               %% <br> breaks the line
  Tokyo
    Shibuya
~ Kyoto -- "day trip from" --> Tokyo  %% a labelled cross-link between two nodes
~ Shibuya --> Fushimi Inari           %% an unlabelled one
~ Kyoto <--> Tokyo : rail             %% two-headed, label after " : "
\`\`\`

- **The topic** is the header's title. Every line indented under the header is a node. A line is
  the child of the nearest line above it that is indented less. Any amount of indent works; a tab
  counts as 4 spaces. No depth limit, but more than 3 levels gets crowded.
- **Layout:** branches split between the left and right so both sides hold about as many leaves.
  The first branches go on the right, top to bottom, then the rest on the left, bottom to top, so it
  reads clockwise from the top right. \`layout=right\` puts every branch on the right (best for a
  plan or a list read in order). \`layout=balanced\` is the default.
- **Style:** the default draws each node as a card on smooth curves. \`style=elbow\` uses square
  brackets, \`style=hairline\` thin lines ending in a dot with no boxes, \`style=organic\` tapered
  hand-drawn ribbons with the labels on them (Buzan style). Unknown \`layout\` or \`style\` values warn
  and fall back to the default. Both can also go in frontmatter (\`style: organic\`); the header wins.
- **Colors:** each main branch takes the next theme color in turn. \`#name\` or \`#hex\` at the end of a
  line sets that node's color and everything under it. Names: red, coral, orange, amber, yellow,
  lime, green, moss, teal, cyan, sky, blue, indigo, violet, purple, magenta, pink, rose, brown,
  grey (or gray). A \`#color\` on the header colors the topic: its outline, or its fill with
  \`style=organic\`.
- **Trailing words that look like options are taken as options.** At the end of a line, a
  \`#color\` (palette name or hex) sets the color, \`!word\` is a flag and \`key=value\` an option;
  none of these show in the label. Any other \`#word\` stays in it: \`Ship by Q4 #launch\`.
  \`C# basics\` is safe too. Quote the label to keep a trailing \`!word\` or \`key=value\`.
- **Emoji** at the start of a label are drawn as an icon before the words.
- **Cross-links** are \`~\` lines, written anywhere (after the outline reads best). They link two
  existing nodes and never add one. Arrows: \`-->\` or \`->\`; \`<-->\` or \`<->\` for both ways.
  Label one with \`A -- "label" --> B\` or \`A --> B : label\`. Quotes around names are optional.
- **How a cross-link finds its node:** case, punctuation and emoji are ignored, so \`kyoto\` finds
  "🏯 Kyoto". An exact match wins. Otherwise the name may be part of a label, if only one label
  contains it (\`Inari\` finds "Fushimi Inari"). The topic can be linked too. A name that matches
  nothing, or more than one label partly, warns and the link is dropped. Duplicate labels: the first
  in the outline wins.
- **A name with " - ", " -- " or " : " in it** works when written in full: \`~ Plan - B --> X\`
  links from "Plan - B" when a node has that label. Otherwise the part after the dashes is read as
  the link's label.

**Mermaid's mindmap syntax also works**, so you can paste one unchanged: \`mindmap\` alone on the
header, and the first indented line is the topic. Node shapes such as \`root((Topic))\`,
\`id[Label]\`, \`id(Label)\`, \`id{{Label}}\` and \`id))Label((\` keep just the label (a bare \`id\` is the
label); \`::icon(...)\` and \`:::class\` are dropped. Prefer the native form above for new
diagrams: title in the header, plain labels. A second top-level line under a bare \`mindmap\` warns
and is moved under the first.

${clickSyntax(TREE_IDS)}`,
    example: `
mindmap "Launching the mobile app"
  📣 Marketing #coral
    Landing page
    Launch video
    Press kit
  🛠️ Product
    Feature freeze
    Beta feedback
      Crash reports
      App store reviews
  🎧 Support #teal
    Help center articles
    On-call rota
  📈 Metrics
    Day-one installs
    Week-one retention
~ Beta feedback -- "shapes" --> Help center articles
~ Launch video --> Day-one installs : drives`,
  },
  parse: parseMindmap,
  render: renderMindmap,
}
