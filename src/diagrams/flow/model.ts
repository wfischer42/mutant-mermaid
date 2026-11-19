/**
 * The graph both flowcharts and state diagrams parse into: nodes with shapes, edges with line
 * kinds and heads, and nested clusters (subgraphs or composite states).
 */

export type Direction = 'TB' | 'BT' | 'LR' | 'RL'

export type Shape =
  | 'rect'
  | 'rounded'
  | 'stadium'
  | 'subroutine'
  | 'cylinder'
  | 'circle'
  | 'doublecircle'
  | 'flag'
  | 'diamond'
  | 'hexagon'
  | 'parallelogram'
  | 'parallelogramAlt'
  | 'trapezoid'
  | 'trapezoidAlt'
  | 'start'
  | 'end'
  | 'fork'
  | 'choice'
  | 'note'

export type LineKind = 'solid' | 'dotted' | 'thick' | 'invisible'
export type Head = 'none' | 'arrow' | 'circle' | 'cross'

export type Style = Record<string, string>

export interface FlowNode {
  id: string
  label: string
  shape: Shape
  classes: string[]
  style: Style
  /** The innermost cluster holding it, or null at the top level. */
  parent: string | null
  /** Whether a shape or label was given, as opposed to the node only being referenced. */
  declared: boolean
}

export interface FlowEdge {
  /** The id written before the link, as in `A e1@--> B`. */
  id?: string
  from: string
  to: string
  label: string
  line: LineKind
  head: Head
  tail: Head
  style: Style
  /** A note's tether to the state it annotates. */
  tether?: boolean
}

export interface FlowCluster {
  id: string
  title: string
  parent: string | null
  direction?: Direction
  classes: string[]
  style: Style
  /** One concurrent region of a composite state: drawn with no box, set off by dashed lines. */
  region?: boolean
}

export interface FlowModel {
  kind: 'flowchart' | 'state'
  direction: Direction
  nodes: FlowNode[]
  edges: FlowEdge[]
  clusters: FlowCluster[]
  classDefs: Record<string, Style>
}

/** Mermaid's direction words, including the arrow shorthands. */
export function toDirection(word: string | undefined): Direction | undefined {
  const map: Record<string, Direction> = {
    TB: 'TB',
    TD: 'TB',
    BT: 'BT',
    LR: 'LR',
    RL: 'RL',
    V: 'TB',
    '^': 'BT',
    '>': 'LR',
    '<': 'RL',
  }
  return word ? map[word.toUpperCase()] : undefined
}

/** `fill:#f9f,stroke:#333,stroke-width:4px` as a record; commas inside `rgb(…)` are kept. */
export function parseStyle(text: string): Style {
  const style: Style = {}
  for (const part of text.split(/,(?![^(]*\))/)) {
    const m = /^\s*([\w-]+)\s*:\s*(.*?)\s*;?\s*$/.exec(part)
    if (m) style[m[1].toLowerCase()] = m[2].replace(/\s*!important$/, '')
  }
  return style
}

/**
 * A label as Mermaid authors write it, reduced to plain text with `\n` line breaks: quotes and
 * markdown backticks dropped, `<br>` as a break, `**bold**` and other tags stripped, entities
 * decoded, Font Awesome icons removed.
 */
export function cleanLabel(raw: string): string {
  let text = raw.trim()
  if (/^".*"$/s.test(text)) text = text.slice(1, -1)
  if (/^`.*`$/s.test(text)) text = text.slice(1, -1)
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, '$1$2')
    .replace(/\bfa[bsrl]?:fa-[\w-]+\s*/g, '')
    .replace(/#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/#(quot|amp|lt|gt|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/&(quot|amp|lt|gt|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ' }

/** Splits a statement line on `;` outside quotes and brackets. */
export function splitStatements(line: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (!quoted && '[({'.includes(ch)) depth++
    else if (!quoted && '])}'.includes(ch)) depth = Math.max(0, depth - 1)
    else if (!quoted && !depth && ch === ';') {
      out.push(line.slice(start, i))
      start = i + 1
    }
  }
  out.push(line.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}
