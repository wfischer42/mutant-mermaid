import { type Diagnostic, readLines } from '../../core/parse.ts'
import type { Parsed } from '../../core/types.ts'
import { type GraphBuilder, graphBuilder } from './builder.ts'
import {
  cleanLabel,
  type FlowModel,
  type Head,
  type LineKind,
  parseStyle,
  type Shape,
  splitStatements,
  toDirection,
} from './model.ts'

/** A cursor over one statement, and the source line it came from. */
interface Cursor {
  s: string
  i: number
  line: number
}

interface Link {
  id?: string
  line: LineKind
  head: Head
  tail: Head
  label: string
}

/** What a flowchart parse carries between statements. */
interface State {
  b: GraphBuilder
  linkStyles: { which: string; style: string }[]
  /** Ids given to links (`A e1@--> B`), so `e1@{ … }` lines aren't read as nodes. */
  edgeIds: Set<string>
}

const ID = /[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[.-](?=[\p{L}\p{N}_]))*/uy

/** Openers longest first; an opener may close more than one way, as `[/…/]` and `[/…\]` do. */
const BRACKETS: { open: string; closes: [string, Shape][] }[] = [
  { open: '(((', closes: [[')))', 'doublecircle']] },
  { open: '([', closes: [['])', 'stadium']] },
  { open: '[[', closes: [[']]', 'subroutine']] },
  { open: '[(', closes: [[')]', 'cylinder']] },
  { open: '((', closes: [['))', 'circle']] },
  { open: '{{', closes: [['}}', 'hexagon']] },
  {
    open: '[/',
    closes: [
      ['/]', 'parallelogram'],
      ['\\]', 'trapezoid'],
    ],
  },
  {
    open: '[\\',
    closes: [
      ['\\]', 'parallelogramAlt'],
      ['/]', 'trapezoidAlt'],
    ],
  },
  { open: '>', closes: [[']', 'flag']] },
  { open: '[', closes: [[']', 'rect']] },
  { open: '(', closes: [[')', 'rounded']] },
  { open: '{', closes: [['}', 'diamond']] },
]

/** Shape names of the `A@{ shape: … }` syntax. */
const NAMED_SHAPES: Record<string, Shape> = {
  rect: 'rect',
  proc: 'rect',
  process: 'rect',
  rectangle: 'rect',
  rounded: 'rounded',
  event: 'rounded',
  stadium: 'stadium',
  pill: 'stadium',
  terminal: 'stadium',
  subroutine: 'subroutine',
  subproc: 'subroutine',
  'fr-rect': 'subroutine',
  cyl: 'cylinder',
  cylinder: 'cylinder',
  database: 'cylinder',
  db: 'cylinder',
  circle: 'circle',
  circ: 'circle',
  'dbl-circ': 'doublecircle',
  'double-circle': 'doublecircle',
  diamond: 'diamond',
  diam: 'diamond',
  decision: 'diamond',
  question: 'diamond',
  hex: 'hexagon',
  hexagon: 'hexagon',
  prepare: 'hexagon',
  'lean-r': 'parallelogram',
  'in-out': 'parallelogram',
  'lean-l': 'parallelogramAlt',
  'out-in': 'parallelogramAlt',
  'trap-b': 'trapezoid',
  trapezoid: 'trapezoid',
  priority: 'trapezoid',
  'trap-t': 'trapezoidAlt',
  'inv-trapezoid': 'trapezoidAlt',
  manual: 'trapezoidAlt',
  flag: 'flag',
  odd: 'flag',
  'sm-circ': 'start',
  start: 'start',
  'fr-circ': 'end',
  stop: 'end',
  'f-circ': 'start',
  junction: 'start',
  fork: 'fork',
  join: 'fork',
  note: 'note',
}

function skip(c: Cursor): void {
  while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++
}

function readId(c: Cursor): string | null {
  ID.lastIndex = c.i
  const m = ID.exec(c.s)
  if (!m) return null
  c.i += m[0].length
  return m[0]
}

/** Where `close` ends a label starting at `from`: right there for a quoted label, else next. */
function closeAt({
  c,
  close,
  from,
  quoted,
}: {
  c: Cursor
  close: string
  from: number
  quoted: boolean
}): number {
  if (!quoted) return c.s.indexOf(close, from)
  return c.s.startsWith(close, from) ? from : -1
}

/** The label and shape of a bracketed node body at the cursor, if there is one. */
function readShape(c: Cursor): { label: string; shape: Shape } | null {
  const bracket = BRACKETS.find((b) => c.s.startsWith(b.open, c.i))
  if (!bracket) return null
  const start = c.i + bracket.open.length
  const quoted = /^\s*"((?:[^"\\]|\\.)*)"\s*/.exec(c.s.slice(start))
  const from = quoted ? start + quoted[0].length : start
  let best: { at: number; close: string; shape: Shape } | null = null
  for (const [close, shape] of bracket.closes) {
    const at = closeAt({ c, close, from, quoted: Boolean(quoted) })
    if (at >= 0 && (!best || at < best.at)) best = { at, close, shape }
  }
  if (!best) return null
  c.i = best.at + best.close.length
  const raw = quoted ? quoted[1] : c.s.slice(start, best.at)
  return { label: cleanLabel(raw), shape: best.shape }
}

/** A shape name from `@{ shape: … }`; an unknown one warns and draws as a rectangle. */
function namedShape({ name, c, b }: { name: string | undefined; c: Cursor; b: GraphBuilder }) {
  if (!name) return undefined
  const shape = NAMED_SHAPES[name]
  if (shape) return shape
  b.diagnostics.push({
    line: c.line,
    message: `There's no "${name}" shape, so it's drawn as a rectangle. Shapes include rect, rounded, stadium, diamond, circle, cyl, hex, subroutine, lean-r, trap-b and flag.`,
    severity: 'warning',
  })
  return 'rect'
}

/** The `@{ shape: diamond, label: "Ok?" }` node syntax. */
function readAtShape({ c, b }: { c: Cursor; b: GraphBuilder }): {
  label?: string
  shape?: Shape
} | null {
  if (!c.s.startsWith('@{', c.i)) return null
  const end = c.s.indexOf('}', c.i)
  if (end < 0) return null
  const body = c.s.slice(c.i + 2, end)
  c.i = end + 1
  const pairs = Object.fromEntries(
    [...body.matchAll(/([\w-]+)\s*:\s*("[^"]*"|[^,]+)/g)].map((m) => [m[1], m[2].trim()]),
  )
  return {
    label: pairs.label === undefined ? undefined : cleanLabel(pairs.label),
    shape: namedShape({ name: pairs.shape, c, b }),
  }
}

function readClasses(c: Cursor): string[] {
  const names: string[] = []
  for (;;) {
    const m = /:::([\w-]+)/y
    m.lastIndex = c.i
    const found = m.exec(c.s)
    if (!found) return names
    names.push(found[1])
    c.i += found[0].length
  }
}

function readNode({ c, b }: { c: Cursor; b: GraphBuilder }): string | null {
  skip(c)
  const id = readId(c)
  if (!id) return null
  const body = readShape(c) ?? readAtShape({ c, b })
  const node = b.touch({ id, label: body?.label, shape: body?.shape })
  node.classes.push(...readClasses(c))
  return id
}

function readGroup({ c, b }: { c: Cursor; b: GraphBuilder }): string[] {
  const ids: string[] = []
  for (;;) {
    const id = readNode({ c, b })
    if (!id) return ids
    ids.push(id)
    skip(c)
    if (c.s[c.i] !== '&') return ids
    c.i++
  }
}

function headOf(ch: string | undefined): Head {
  if (ch === '>' || ch === '<') return 'arrow'
  if (ch === 'o') return 'circle'
  if (ch === 'x') return 'cross'
  return 'none'
}

function lineOf(body: string): LineKind {
  if (body.includes('=')) return 'thick'
  if (body.includes('.')) return 'dotted'
  if (body.includes('~')) return 'invisible'
  return 'solid'
}

const INLINE = [
  /(<|[ox](?=--))?--\s+(.+?)\s*(-{2,})(>|[ox](?![\p{L}\p{N}_]))?/uy,
  /(<|[ox](?===))?==\s+(.+?)\s*(={2,})(>|[ox](?![\p{L}\p{N}_]))?/uy,
  /(<|[ox](?=-\.))?-\.\s+(.+?)\s*(\.+-)(>|[ox](?![\p{L}\p{N}_]))?/uy,
]
const BARE = /(<|[ox](?=--|==|-\.))?(-{2,}|={2,}|-\.+-|~{3,})(>|[ox](?![\p{L}\p{N}_]))?/uy

/** A link with its text inside, as in `-- yes -->`, `== go ==>` or `-. maybe .->`. */
function readInlineLink(c: Cursor): Link | null {
  for (const re of INLINE) {
    re.lastIndex = c.i
    const m = re.exec(c.s)
    if (!m) continue
    c.i += m[0].length
    const line = lineOf(re === INLINE[2] ? '.' : m[3])
    return { line, tail: headOf(m[1]), head: headOf(m[4]), label: cleanLabel(m[2]) }
  }
  return null
}

const EDGE_ID = /([\p{L}\p{N}_]+)@(?=[-=.~<ox])/uy

/** A link's id, as in `A e1@--> B`; it names the link for a later `e1@{ … }` line. */
function readEdgeId({ c, state }: { c: Cursor; state: State }): string | undefined {
  EDGE_ID.lastIndex = c.i
  const m = EDGE_ID.exec(c.s)
  if (!m) return undefined
  c.i += m[0].length
  state.edgeIds.add(m[1])
  return m[1]
}

function readLink({ c, state }: { c: Cursor; state: State }): Link | null {
  skip(c)
  const id = readEdgeId({ c, state })
  const inline = readInlineLink(c)
  if (inline) return { ...inline, id }
  BARE.lastIndex = c.i
  const m = BARE.exec(c.s)
  if (!m) return null
  c.i += m[0].length
  const link: Link = { id, line: lineOf(m[2]), tail: headOf(m[1]), head: headOf(m[3]), label: '' }
  skip(c)
  const piped = /\|([^|]*)\|/y
  piped.lastIndex = c.i
  const label = piped.exec(c.s)
  if (label) {
    c.i += label[0].length
    link.label = cleanLabel(label[1])
  }
  return link
}

/** `A --> B --> C`, `A & B -->|x| C`: every node of one group links to every node of the next. */
function chain({ text, line, state }: { text: string; line: number; state: State }): void {
  const { b } = state
  const c: Cursor = { s: text, i: 0, line }
  let prev = readGroup({ c, b })
  if (!prev.length) {
    b.diagnostics.push({
      line,
      message: `Couldn't read "${text}"; expected a node such as \`A[Label]\` or a link such as \`A --> B\`.`,
      severity: 'warning',
    })
    return
  }
  for (;;) {
    skip(c)
    if (c.i >= c.s.length) return
    const link = readLink({ c, state })
    const next = link ? readGroup({ c, b }) : []
    if (!link || !next.length) {
      b.diagnostics.push({
        line,
        message: `Couldn't read "${c.s.slice(c.i).trim() || text}"; links look like \`-->\`, \`-.->\`, \`==>\` or \`-->|label|\`, followed by a node.`,
        severity: 'warning',
      })
      return
    }
    for (const from of prev) for (const to of next) b.edge({ from, to, ...link, style: {} })
    prev = next
  }
}

function subgraph({ rest, b }: { rest: string; b: GraphBuilder }): void {
  const bracketed = /^([^\s[]+)\s*\[(.*)\]\s*$/.exec(rest)
  if (bracketed) {
    b.open({ id: bracketed[1], title: cleanLabel(bracketed[2]) })
    return
  }
  const title = cleanLabel(rest)
  const id = /^".*"$/.test(rest.trim()) ? title : rest.trim()
  b.open({ id: id || `subgraph${b.depth()}`, title })
}

const IGNORED = /^(click|accTitle|accDescr|title|callback|link)\b/

/** Statements other than links and nodes. Returns false when the text is a chain. */
function keywordStatement({
  text,
  line,
  state,
}: {
  text: string
  line: number
  state: State
}): boolean {
  const { b } = state
  const word = /^(\w+)\b\s*(.*)$/.exec(text)
  const [, keyword, rest] = word ?? ['', '', '']
  if (keyword === 'subgraph') subgraph({ rest, b })
  else if (keyword === 'end' && !rest) b.close(line)
  else if (keyword === 'direction' && toDirection(rest)) b.setDirection(toDirection(rest) ?? 'TB')
  else if (keyword === 'classDef') classDef({ rest, b })
  else if (keyword === 'class') classStatement({ rest, b })
  else if (keyword === 'style') styleStatement({ rest, b })
  else if (keyword === 'linkStyle') linkStyle({ rest, state })
  else return IGNORED.test(text) || edgeProperties({ text, state })
  return true
}

/** `e1@{ animate: true }` sets a link's properties; none of them change a still drawing. */
function edgeProperties({ text, state }: { text: string; state: State }): boolean {
  const m = /^([\p{L}\p{N}_]+)@\{[^}]*\}\s*$/u.exec(text)
  return Boolean(m && state.edgeIds.has(m[1]))
}

function classDef({ rest, b }: { rest: string; b: GraphBuilder }): void {
  const m = /^(\S+)\s+(.*)$/.exec(rest)
  if (m) b.defineClass({ names: m[1].split(','), style: parseStyle(m[2]) })
}

function classStatement({ rest, b }: { rest: string; b: GraphBuilder }): void {
  const m = /^(.+?)\s+([\w-]+)\s*$/.exec(rest)
  if (!m) return
  for (const id of m[1].split(',')) b.addClass({ id: id.trim(), names: [m[2]] })
}

function styleStatement({ rest, b }: { rest: string; b: GraphBuilder }): void {
  const m = /^(\S+)\s+(.*)$/.exec(rest)
  if (m) b.addStyle({ id: m[1], style: parseStyle(m[2]) })
}

function linkStyle({ rest, state }: { rest: string; state: State }): void {
  const m = /^(\S+)\s+(.*)$/.exec(rest)
  if (m) state.linkStyles.push({ which: m[1], style: m[2] })
}

/** Link styles apply by index, so they wait until every edge is known. */
function applyLinkStyles({ state, model }: { state: State; model: FlowModel }): void {
  for (const { which, style } of state.linkStyles) {
    const parsed = parseStyle(style)
    const targets =
      which === 'default' ? model.edges : which.split(',').map((i) => model.edges[Number(i)])
    for (const edge of targets) if (edge) edge.style = { ...edge.style, ...parsed }
  }
}

const HEADER = /^(?:flowchart|graph)(?:-elk)?(?:\s+([A-Za-z]{2}|[<>^v])\b)?\s*;?\s*(.*)$/i

/** Mermaid flowchart syntax, read broadly; what it can't read becomes a warning. */
export function parseFlowchart(source: string): Parsed<FlowModel> {
  const lines = readLines(source)
  const [first, ...rest] = lines
  const head = HEADER.exec(first?.text ?? '')
  const state: State = {
    b: graphBuilder(toDirection(head?.[1]) ?? 'TB'),
    linkStyles: [],
    edgeIds: new Set(),
  }
  const { b } = state
  const statements: { text: string; line: number }[] = []
  if (head?.[2])
    for (const text of splitStatements(head[2])) statements.push({ text, line: first.no })
  for (const line of rest)
    for (const text of splitStatements(line.text)) statements.push({ text, line: line.no })
  for (const { text, line } of statements)
    if (!keywordStatement({ text, line, state })) chain({ text, line, state })
  const diagnostics: Diagnostic[] = b.diagnostics
  if (b.depth())
    diagnostics.push({
      line: lines[lines.length - 1]?.no ?? 1,
      message: 'A `subgraph` is missing its `end`; add `end` after its last line.',
      severity: 'warning',
    })
  const model = b.finish('flowchart')
  applyLinkStyles({ state, model })
  if (!model.nodes.length)
    diagnostics.push({
      line: first?.no ?? 1,
      message: 'A flowchart needs at least one node, such as `A[Start] --> B[End]`.',
      severity: 'error',
    })
  return { model, diagnostics }
}
