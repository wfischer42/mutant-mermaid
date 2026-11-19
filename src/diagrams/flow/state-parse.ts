import { type Line, readLines } from '../../core/parse.ts'
import type { Parsed } from '../../core/types.ts'
import { type GraphBuilder, graphBuilder } from './builder.ts'
import { cleanLabel, type FlowModel, parseStyle, type Shape, toDirection } from './model.ts'

/** What a state diagram parse carries from line to line. */
interface State {
  b: GraphBuilder
  /** Composite states currently open, innermost last. */
  scopes: string[]
  notes: number
  /** An open multi-line note: its target, where it opened, and its lines so far. */
  note: { target: string; line: number; lines: string[] } | null
  descriptions: Map<string, string[]>
  /** How many `--` lines each scope has had, so each concurrent region gets its own `[*]`. */
  regions: Map<string, number>
  /** The region of its composite each state or composite first appeared in. */
  regionOf: Map<string, number>
}

const STEREOTYPES: Record<string, Shape> = { fork: 'fork', join: 'fork', choice: 'choice' }

function scopeId(state: State): string {
  return state.scopes[state.scopes.length - 1] ?? 'root'
}

function scope(state: State): string {
  const id = scopeId(state)
  const region = state.regions.get(id)
  return region ? `${id}_r${region}` : id
}

/** Notes which region of its composite a state or composite belongs to, the first time it lands there. */
function place({ state, id, parent }: { state: State; id: string; parent: string | null }): void {
  if (parent === scopeId(state) && !state.regionOf.has(id))
    state.regionOf.set(id, state.regions.get(parent) ?? 0)
}

function touch(state: State, node: { id: string; label?: string; shape?: Shape }) {
  const touched = state.b.touch(node)
  place({ state, id: touched.id, parent: touched.parent })
  return touched
}

/** `--` starts a concurrent region of the composite it's in, with its own start and end. */
function region({ line, state }: { line: Line; state: State }): void {
  const id = scopeId(state)
  state.regions.set(id, (state.regions.get(id) ?? 0) + 1)
  if (state.scopes.length) return
  state.b.diagnostics.push({
    line: line.no,
    message:
      'Concurrent regions (`--`) belong inside a composite (`state Name { … }`); at the top level they share one box.',
    severity: 'warning',
  })
}

/** Gives each concurrent region of a composite its own boxless cluster, holding its states. */
function splitRegions({ model, state }: { model: FlowModel; state: State }): void {
  for (const [id, count] of state.regions) {
    const at = model.clusters.findIndex((c) => c.id === id)
    if (at < 0) continue
    const regionId = (k: number) => `${id}__region${k}`
    const regions = Array.from({ length: count + 1 }, (_, k) => ({
      id: regionId(k),
      title: '',
      parent: id,
      classes: [],
      style: {},
      region: true,
    }))
    model.clusters.splice(at + 1, 0, ...regions)
    for (const item of [...model.nodes, ...model.clusters])
      if (item.parent === id && !('region' in item && item.region))
        item.parent = regionId(state.regionOf.get(item.id) ?? 0)
  }
}

/** A state reference, with `[*]` resolved to this scope's start or end and `:::class` applied. */
function ref({ token, state, end }: { token: string; state: State; end: boolean }): string {
  const [id, ...classes] = token.split(':::')
  if (id === '[*]') {
    const pseudo = `${end ? '__end' : '__start'}_${scope(state)}`
    touch(state, { id: pseudo, label: '', shape: end ? 'end' : 'start' })
    return pseudo
  }
  const node = touch(state, { id })
  node.classes.push(...classes)
  return id
}

function transition({ text, state }: { text: string; state: State }): boolean {
  const m = /^(\S+)\s*(-->|<--)\s*([^\s:]+(?::::[\w-]+)*)\s*(?::\s*(.*))?$/.exec(text)
  if (!m) return false
  const forward = m[2] === '-->'
  const left = ref({ token: m[1], state, end: !forward })
  const right = ref({ token: m[3], state, end: forward })
  state.b.edge({
    from: forward ? left : right,
    to: forward ? right : left,
    label: cleanLabel(m[4] ?? ''),
    line: 'solid',
    head: 'arrow',
    tail: 'none',
    style: {},
  })
  return true
}

function addNote({ target, text, state }: { target: string; text: string; state: State }): void {
  state.notes++
  const id = `__note_${state.notes}`
  touch(state, { id, label: cleanLabel(text), shape: 'note' })
  touch(state, { id: target })
  state.b.edge({
    from: id,
    to: target,
    label: '',
    line: 'dotted',
    head: 'none',
    tail: 'none',
    style: {},
    tether: true,
  })
}

function note({ line, state }: { line: Line; state: State }): boolean {
  const m = /^note\s+(?:left|right|over)\s+of\s+(\S+)\s*(?::\s*(.*))?$/i.exec(line.text)
  if (!m) return false
  if (m[2] !== undefined) addNote({ target: m[1], text: m[2], state })
  else state.note = { target: m[1], line: line.no, lines: [] }
  return true
}

/** A block note still open at the end is drawn with what it holds, and warns. */
function unclosed({ state, last }: { state: State; last: number }): void {
  const open = state.note
  if (open) {
    addNote({ target: open.target, text: open.lines.join('\n'), state })
    state.b.diagnostics.push({
      line: open.line,
      message:
        'This note has no `end note`, so every line after it became note text. Add `end note` after its last line.',
      severity: 'warning',
    })
  }
  if (state.scopes.length)
    state.b.diagnostics.push({
      line: last,
      message: `\`state ${state.scopes[state.scopes.length - 1]} {\` is missing its \`}\`; add one after its last line.`,
      severity: 'warning',
    })
}

/** Adds a line to the open multi-line note, or closes it at `end note`. */
function continueNote({ text, state }: { text: string; state: State }): void {
  const open = state.note
  if (!open) return
  if (!/^end\s*note$/i.test(text)) {
    open.lines.push(text)
    return
  }
  addNote({ target: open.target, text: open.lines.join('\n'), state })
  state.note = null
}

const DECLARATION =
  /^state\s+(?:"([^"]*)"\s+as\s+([^\s{]+)|([^\s{]+))\s*(?:<<(\w+)>>)?\s*(?::\s*([^{]*))?\s*(\{)?\s*$/

/** `state "Long name" as Id`, `state Id {`, `state Id <<fork>>`. */
function declaration({ text, state }: { text: string; state: State }): boolean {
  const m = DECLARATION.exec(text)
  if (!m) return false
  const id = m[2] ?? m[3]
  const label = m[1] ?? m[5]
  if (m[6]) {
    const cluster = state.b.open({ id, title: cleanLabel(label ?? id) })
    place({ state, id, parent: cluster.parent ?? 'root' })
    state.scopes.push(id)
    return true
  }
  const shape = m[4] ? STEREOTYPES[m[4].toLowerCase()] : undefined
  touch(state, { id, label: label === undefined ? undefined : cleanLabel(label), shape })
  return true
}

function description({ text, state }: { text: string; state: State }): boolean {
  const m = /^([^\s:]+)\s*:\s*(.+)$/.exec(text)
  if (!m || m[1].includes('--')) return false
  const list = state.descriptions.get(m[1]) ?? []
  list.push(cleanLabel(m[2]))
  state.descriptions.set(m[1], list)
  touch(state, { id: m[1] })
  return true
}

function styling({ text, state }: { text: string; state: State }): boolean {
  const m = /^(classDef|class|style)\s+(\S+)\s+(.+)$/.exec(text)
  if (!m) return false
  if (m[1] === 'classDef') state.b.defineClass({ names: m[2].split(','), style: parseStyle(m[3]) })
  else if (m[1] === 'style') state.b.addStyle({ id: m[2], style: parseStyle(m[3]) })
  else for (const id of m[2].split(',')) state.b.addClass({ id, names: [m[3].trim()] })
  return true
}

const IGNORED = /^(hide|scale|skinparam|accTitle|accDescr|title|click)\b/

function closeScope({ line, state }: { line: Line; state: State }): void {
  if (state.scopes.pop()) state.b.close(line.no)
  else
    state.b.diagnostics.push({
      line: line.no,
      message: 'This `}` closes nothing; remove it or open a state with `state Name {`.',
      severity: 'warning',
    })
}

function direction({ text, state }: { text: string; state: State }): boolean {
  const m = /^direction\s+(\w+)$/.exec(text)
  const value = toDirection(m?.[1])
  if (value) state.b.setDirection(value)
  return Boolean(value)
}

function statement({ line, state }: { line: Line; state: State }): void {
  const { text } = line
  if (state.note) return continueNote({ text, state })
  if (text === '}') return closeScope({ line, state })
  if (text === '--') return region({ line, state })
  const handled =
    IGNORED.test(text) ||
    direction({ text, state }) ||
    transition({ text, state }) ||
    note({ line, state }) ||
    declaration({ text, state }) ||
    styling({ text, state }) ||
    description({ text, state })
  if (handled) return
  if (/^[\w.-]+$/.test(text)) {
    touch(state, { id: text })
    return
  }
  state.b.diagnostics.push({
    line: line.no,
    message: `Couldn't read "${text}"; transitions look like \`A --> B : label\`.`,
    severity: 'warning',
  })
}

/** Mermaid's `stateDiagram-v2` syntax: states, `[*]`, transitions, composites, notes, forks. */
export function parseState(source: string): Parsed<FlowModel> {
  const [first, ...rest] = readLines(source)
  const state: State = {
    b: graphBuilder('TB'),
    scopes: [],
    notes: 0,
    note: null,
    descriptions: new Map(),
    regions: new Map(),
    regionOf: new Map(),
  }
  for (const line of rest) statement({ line, state })
  unclosed({ state, last: rest[rest.length - 1]?.no ?? first?.no ?? 1 })
  const model = state.b.finish('state')
  splitRegions({ model, state })
  for (const node of model.nodes) {
    if (node.shape === 'rect') node.shape = 'rounded'
    const described = state.descriptions.get(node.id)
    if (described) node.label = described.join('\n')
  }
  const { diagnostics } = state.b
  if (!model.nodes.length)
    diagnostics.push({
      line: first?.no ?? 1,
      message: 'A state diagram needs at least one state, such as `[*] --> Idle`.',
      severity: 'error',
    })
  return { model, diagnostics }
}
