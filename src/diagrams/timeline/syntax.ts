import { idMaker } from '../../core/hooks.ts'
import {
  type Diagnostic,
  header,
  indentTree,
  type Labeled,
  type Line,
  labeled,
  readLines,
  type TreeNode,
} from '../../core/parse.ts'
import type { Parsed } from '../../core/types.ts'
import { fromCalendar, parseDate, type TimePoint } from './dates.ts'
import type { ScaleRequest } from './scale.ts'

export interface TimelineEvent {
  kind: 'event'
  label: string
  /** From an `id=` option, for click lines; otherwise the label names it. */
  id?: string
  at: TimePoint
  major: boolean
  milestone: boolean
  color?: string
  line: number
}

export interface TimelineSpan {
  kind: 'span'
  label: string
  /** From an `id=` option, for click lines; otherwise the label names it. */
  id?: string
  from: TimePoint
  to: TimePoint
  major: boolean
  color?: string
  line: number
}

export type TimelineItem = TimelineEvent | TimelineSpan

/** Which way time runs: left to right, or top to bottom. */
export type Direction = 'horizontal' | 'vertical'

/**
 * How long the time axis is: `fit` keeps it within a page, `wide` lets it grow until labels have
 * room (a scrolling view), or an exact length in pixels.
 */
export type AxisLength = 'fit' | 'wide' | number

export interface Lane {
  /** Empty for the implicit lane that holds items written outside any lane. */
  label: string
  color?: string
  items: TimelineItem[]
}

export interface Era {
  label: string
  from: TimePoint
  to: TimePoint
  color?: string
}

/** Our extended syntax: real dates, lanes, eras, any time scale. */
export interface DatedTimeline {
  mode: 'dated'
  title: string
  direction: Direction
  length: AxisLength
  scale: ScaleRequest
  now: number
  /** Whether the author set `now`, so a "now" line is worth drawing. */
  nowGiven: boolean
  eras: Era[]
  lanes: Lane[]
  notes: string[]
}

export interface Period {
  label: string
  events: string[]
  /** Index into `sections`, or -1 before the first section. */
  section: number
}

/** Mermaid's own timeline syntax: ordered period labels, optionally grouped into sections. */
export interface SequentialTimeline {
  mode: 'sequential'
  title: string
  direction: Direction
  length: AxisLength
  sections: { label: string; color?: string }[]
  periods: Period[]
  notes: string[]
}

export type TimelineModel = DatedTimeline | SequentialTimeline

/** Each event and span's id for the host app: its `id=`, else its label as a slug. */
export function itemIds(model: DatedTimeline): Map<TimelineItem, string> {
  const next = idMaker()
  const items = model.lanes.flatMap((lane) => lane.items)
  return new Map(items.map((item) => [item, item.id ?? next(item.label)]))
}

/** Each period's id and its events' ids, as slugs of their text: `Week 1` is `week-1`. */
export function periodIds(
  model: SequentialTimeline,
): Map<Period, { id: string; events: string[] }> {
  const next = idMaker()
  return new Map(
    model.periods.map((p) => [p, { id: next(p.label), events: p.events.map((e) => next(e)) }]),
  )
}

const DATED_KEYWORDS = new Set(['lane', 'era', 'event', 'span', 'milestone', 'scale', 'now'])

/** Today as a fractional year: the default `now`. Set `now=` for output that never changes. */
function today(): number {
  const d = new Date()
  return fromCalendar({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  })
}

function keywordOf(text: string): string {
  return text.split(/\s+/)[0].toLowerCase()
}

function restOf(text: string): string {
  return text.slice(text.split(/\s+/)[0].length).trim()
}

/**
 * Reads either syntax. Mermaid's (`2004 : Facebook : Google` under optional `section`s) gives a
 * sequential timeline; ours (`lane`, `era`, `event`, `span`, `scale`) gives a dated one.
 */
export function parseTimeline(source: string): Parsed<TimelineModel> {
  const lines = readLines(source)
  const [first, ...rest] = lines
  if (!first)
    return {
      model: null,
      diagnostics: [{ line: 1, message: 'The timeline is empty.', severity: 'error' }],
    }
  const dated = rest.some((line) => isDatedLine(line.text))
  if (dated) return parseDated({ first, rest })
  return parseSequential({ first, rest })
}

/**
 * Whether a line is written in our syntax rather than Mermaid's. Mermaid periods such as
 * `Now : Kickoff` can start with one of our keywords, so a line with a ` : ` only counts when it
 * is an item whose date follows the colon (`event Launch : 2026`).
 */
function isDatedLine(text: string): boolean {
  const keyword = keywordOf(text)
  if (!DATED_KEYWORDS.has(keyword) || !restOf(text)) return false
  const parts = colonParts(text)
  if (parts.length < 2) return true
  return parts.length === 2 && ITEM_KEYWORDS.has(keyword) && isDate(parts[1])
}

function isDate(text: string): boolean {
  return parseDate({ text, now: 2000 }) !== null
}

const DIRECTIONS: Record<string, Direction> = {
  lr: 'horizontal',
  rl: 'horizontal',
  horizontal: 'horizontal',
  td: 'vertical',
  tb: 'vertical',
  bt: 'vertical',
  vertical: 'vertical',
}

/**
 * The header's title and settings. A Mermaid direction word may come first (`timeline TD`), or
 * `direction=vertical` among the attributes; `length=wide` or `length=4000` sets the axis length.
 */
function headerOf({ first, diagnostics }: { first: Line; diagnostics: Diagnostic[] }) {
  const keyword = keywordOf(first.text)
  const after = first.text.slice(keyword.length).trim()
  const word = /^(LR|RL|TD|TB|BT)(?=\s|$)/i.exec(after)?.[1]
  const head = header({ text: word ? after.slice(word.length) : after, keyword: '' })
  const written = head.attrs.direction ?? word
  const direction = written ? DIRECTIONS[written.toLowerCase()] : 'horizontal'
  if (!direction)
    diagnostics.push({
      line: first.no,
      message: `Unknown direction "${written}". Use direction=vertical or direction=horizontal.`,
      severity: 'warning',
    })
  if (written && /^(rl|bt)$/i.test(written))
    diagnostics.push({
      line: first.no,
      message: `Time always runs forward: ${written} draws like ${written.toLowerCase() === 'rl' ? 'LR, left to right' : 'TD, top to bottom'}.`,
      severity: 'warning',
    })
  return {
    head,
    title: head.label,
    direction: direction ?? 'horizontal',
    length: axisLength({ value: head.attrs.length, line: first.no, diagnostics }),
  }
}

function axisLength({
  value,
  line,
  diagnostics,
}: {
  value: string | undefined
  line: number
  diagnostics: Diagnostic[]
}): AxisLength {
  if (!value || value === 'fit') return 'fit'
  if (value === 'wide' || value === 'long') return 'wide'
  const px = Number(value.replace(/px$/, ''))
  if (Number.isFinite(px) && px >= 200) return Math.min(px, 40000)
  diagnostics.push({
    line,
    message: `Couldn't read length=${value}. Use length=fit, length=wide or a size in pixels such as length=3000.`,
    severity: 'warning',
  })
  return 'fit'
}

/** Splits `Period : event : event` on colons followed by a space (so 10:30 stays whole). */
function colonParts(text: string): string[] {
  return text.split(/\s*:(?:\s+|$)/).map((part) => part.trim())
}

function parseSequential({ first, rest }: { first: Line; rest: Line[] }): Parsed<TimelineModel> {
  const diagnostics: Diagnostic[] = []
  const { head, title, direction, length } = headerOf({ first, diagnostics })
  if (head.attrs.length)
    diagnostics.push({
      line: first.no,
      message:
        'length= applies to dated timelines (lane, event, span). A Mermaid-syntax timeline sizes itself to its periods.',
      severity: 'warning',
    })
  const model: SequentialTimeline = {
    mode: 'sequential',
    title,
    direction,
    length,
    sections: [],
    periods: [],
    notes: [],
  }
  for (const line of rest) readSequentialLine({ line, model, diagnostics })
  if (!model.periods.length)
    diagnostics.push({
      line: first.no,
      message: 'A timeline needs at least one period, such as `2004 : Facebook`, under it.',
      severity: 'error',
    })
  return { model, diagnostics }
}

interface SequentialStep {
  line: Line
  model: SequentialTimeline
  diagnostics: Diagnostic[]
}

function readSequentialLine({ line, model, diagnostics }: SequentialStep): void {
  const keyword = keywordOf(line.text)
  if (keyword === 'title') {
    model.title = restOf(line.text)
    return
  }
  if (keyword === 'section') {
    const { label, color } = labeled(restOf(line.text))
    model.sections.push({ label, color })
    return
  }
  if (keyword === 'note') {
    model.notes.push(restOf(line.text))
    return
  }
  if (/^acc(Title|Descr)/i.test(keyword)) return
  if (line.text.startsWith(':')) {
    continuePeriod({ line, model, diagnostics })
    return
  }
  const [label, ...events] = colonParts(line.text)
  model.periods.push({ label, events: events.filter(Boolean), section: model.sections.length - 1 })
}

/** A line starting with `:` adds events to the period above it. */
function continuePeriod({ line, model, diagnostics }: SequentialStep): void {
  const last = model.periods[model.periods.length - 1]
  const events = colonParts(line.text.slice(1)).filter(Boolean)
  if (last) {
    last.events.push(...events)
    return
  }
  diagnostics.push({
    line: line.no,
    message: 'This line continues a period, but no period comes before it.',
    severity: 'warning',
  })
}

interface DatedState {
  model: DatedTimeline
  diagnostics: Diagnostic[]
}

/** Finds `now` before anything else, since deep-time dates count back from it. */
function findNow({ head, rest }: { head: Labeled; rest: Line[] }) {
  const scaleLine = rest.find((line) => keywordOf(line.text) === 'scale')
  const nowLine = rest.find((line) => keywordOf(line.text) === 'now')
  const written =
    head.attrs.now ??
    (scaleLine && labeled(restOf(scaleLine.text)).attrs.now) ??
    (nowLine && restOf(nowLine.text))
  const parsed = written ? parseDate({ text: written, now: today() }) : null
  return { now: parsed?.t ?? today(), given: Boolean(parsed), written }
}

/** A scale name, or null (with a warning) when one is written but isn't known. */
function scaleRequest({
  value,
  line,
  diagnostics,
}: {
  value: string | undefined
  line: number
  diagnostics: Diagnostic[]
}): ScaleRequest | null {
  const name = value?.toLowerCase()
  if (name === 'log' || name === 'linear' || name === 'auto') return name
  if (name === 'logarithmic') return 'log'
  if (value)
    diagnostics.push({
      line,
      message: `Unknown scale "${value}". Use scale=linear, scale=log or scale=auto.`,
      severity: 'warning',
    })
  return null
}

function parseDated({ first, rest }: { first: Line; rest: Line[] }): Parsed<TimelineModel> {
  const diagnostics: Diagnostic[] = []
  const { head, title, direction, length } = headerOf({ first, diagnostics })
  const found = findNow({ head, rest })
  const state: DatedState = {
    model: {
      mode: 'dated',
      title,
      direction,
      length,
      scale: scaleRequest({ value: head.attrs.scale, line: first.no, diagnostics }) ?? 'auto',
      now: found.now,
      nowGiven: found.given,
      eras: [],
      lanes: [],
      notes: [],
    },
    diagnostics,
  }
  if (found.written && !found.given)
    state.diagnostics.push({
      line: first.no,
      message: `Couldn't read now=${found.written} as a date; write a year such as now=2026.`,
      severity: 'warning',
    })
  for (const node of indentTree(rest)) readDatedNode({ node, state, lane: null })
  const items = state.model.lanes.reduce((sum, lane) => sum + lane.items.length, 0)
  if (!items && !state.model.eras.length)
    state.diagnostics.push({
      line: first.no,
      message: 'A timeline needs events or spans, such as `event Moon landing 1969-07-20`.',
      severity: 'error',
    })
  state.model.lanes = state.model.lanes.filter((lane) => lane.items.length || lane.label)
  return { model: state.model, diagnostics: state.diagnostics }
}

function implicitLane(model: DatedTimeline): Lane {
  const found = model.lanes.find((lane) => !lane.label)
  if (found) return found
  const lane: Lane = { label: '', items: [] }
  model.lanes.unshift(lane)
  return lane
}

function readDatedNode({
  node,
  state,
  lane,
}: {
  node: TreeNode
  state: DatedState
  lane: Lane | null
}): void {
  const { line } = node
  const keyword = keywordOf(line.text)
  const rest = restOf(line.text)
  const { model } = state
  if (keyword === 'lane' || keyword === 'section') {
    const { label, color } = labeled(rest)
    const created: Lane = { label: label || `Lane ${model.lanes.length + 1}`, color, items: [] }
    model.lanes.push(created)
    for (const child of node.children) readDatedNode({ node: child, state, lane: created })
    return
  }
  readDatedLine({ line, keyword, rest, state, lane })
  for (const child of node.children) readDatedNode({ node: child, state, lane })
}

interface DatedLine {
  line: Line
  keyword: string
  rest: string
  state: DatedState
  lane: Lane | null
}

const ITEM_KEYWORDS = new Set(['event', 'milestone', 'span'])

function readDatedLine({ line, keyword, rest, state, lane }: DatedLine): void {
  const { model, diagnostics } = state
  if (keyword === 'title') model.title = rest
  else if (keyword === 'note') model.notes.push(rest)
  else if (keyword === 'scale')
    model.scale =
      scaleRequest({ value: labeled(rest).label, line: line.no, diagnostics }) ?? model.scale
  else if (keyword === 'era') readEra({ line, rest, state })
  else if (ITEM_KEYWORDS.has(keyword)) addItem({ line, keyword, rest, state, lane })
  else if (keyword !== 'now')
    diagnostics.push({
      line: line.no,
      message: `Unknown line "${line.text}". Start it with lane, era, event, span, milestone, note or scale.`,
      severity: 'error',
    })
}

function addItem(step: DatedLine): void {
  const item = readItem(step)
  if (item) (step.lane ?? implicitLane(step.state.model)).items.push(item)
}

/** `Label : date` or `Label @ date`. */
function splitColon({ text, now }: { text: string; now: number }) {
  const colon = /^(.*\S)\s+[:@]\s+(\S.*)$/.exec(text)
  const at = colon ? parseDate({ text: colon[2], now }) : null
  return colon && at ? { label: colon[1], at } : null
}

/** A one- or two-digit number alone, as in `Apollo 11`: more often a name than a year. */
const SHORT_NUMBER = /^[~?%]?\d{1,2}[~?%]?$/

/**
 * A date at the end of a label (`Printing press 1440~`), or failing that, at the start. When
 * `strict`, a bare one- or two-digit number isn't taken as a year (`event Apollo 11` has no date;
 * write `11 CE` for the year 11). Inside a range the separator makes the date clear.
 */
function splitDated({ text, now, strict }: { text: string; now: number; strict: boolean }) {
  const colon = splitColon({ text, now })
  if (colon) return colon
  const words = text.split(/\s+/)
  const read = (part: string[]) => {
    const written = part.join(' ')
    return strict && SHORT_NUMBER.test(written) ? null : parseDate({ text: written, now })
  }
  for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
    const at = read(words.slice(-k))
    if (at) return { label: words.slice(0, -k).join(' '), at }
  }
  for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
    const at = read(words.slice(0, k))
    if (at) return { label: words.slice(k).join(' '), at }
  }
  return null
}

/** `..`, a spaced dash, `to`, or a bare hyphen or dash between years (`1939-1945`). */
const RANGES = [/\s*\.\.\s*/g, /\s+[–—]\s+/g, /\s+to\s+/g, /(?<=\d)[-–](?=\d{3,}[~?%]?$)/g]

/** `Label from .. to`, also with an en dash, `to` or a year-to-year hyphen between the dates. */
function splitRange({ text, now }: { text: string; now: number }) {
  for (const separator of RANGES)
    for (const match of text.matchAll(separator)) {
      const left = splitDated({ text: text.slice(0, match.index), now, strict: false })
      const to = parseDate({ text: text.slice(match.index + match[0].length), now })
      if (left?.label && to) return { label: left.label, from: left.at, to }
    }
  return null
}

/**
 * The label left once the dates are out, read again for options written before the date
 * (`event Launch !major 2026`) and for surrounding quotes.
 */
function cleanLabel({ label, outer }: { label: string; outer: Labeled }) {
  const inner = labeled(label)
  return {
    label: inner.label,
    id: outer.attrs.id ?? inner.attrs.id,
    color: outer.color ?? inner.color,
    flags: new Set([...outer.flags, ...inner.flags]),
  }
}

const DATE_HELP =
  'Use a year (1969, -500, 44 BCE), 2026-03, 2026-03-15, 2026-Q2, 66Ma, 11.7ka or now, optionally with ~ or ?.'

function readEra({ line, rest, state }: { line: Line; rest: string; state: DatedState }): void {
  const outer = labeled(rest)
  const range = splitRange({ text: outer.label, now: state.model.now })
  if (!range) {
    state.diagnostics.push({
      line: line.no,
      message: `An era needs a range, as in \`era Mesozoic -252Ma .. -66Ma\`. ${DATE_HELP}`,
      severity: 'error',
    })
    return
  }
  const [from, to] = ordered({ from: range.from, to: range.to })
  const { label, color } = cleanLabel({ label: range.label, outer })
  state.model.eras.push({ label, from, to, color })
}

function ordered({ from, to }: { from: TimePoint; to: TimePoint }): [TimePoint, TimePoint] {
  return from.t <= to.t ? [from, to] : [to, from]
}

function readItem({ line, keyword, rest, state }: DatedLine): TimelineItem | null {
  const outer = labeled(rest)
  const now = state.model.now
  const range = splitRange({ text: outer.label, now })
  if (range && keyword !== 'milestone') {
    const [from, to] = ordered({ from: range.from, to: range.to })
    const { label, id, color, flags } = cleanLabel({ label: range.label, outer })
    return { kind: 'span', label, id, from, to, major: flags.has('major'), color, line: line.no }
  }
  if (range) {
    state.diagnostics.push({
      line: line.no,
      message:
        'A milestone marks one date; it is drawn at the start of this range. Use span for a range.',
      severity: 'warning',
    })
    return pointItem({ keyword, outer, label: range.label, at: range.from, line })
  }
  const single = splitDated({ text: outer.label, now, strict: true })
  if (single) return pointItem({ keyword, outer, label: single.label, at: single.at, line })
  const example =
    keyword === 'span' ? '`span Roman Empire -27 .. 476`' : '`event Moon landing 1969-07-20`'
  const short = /\s\d{1,2}$/.test(outer.label) ? ' For a year before 100, write it as `11 CE`.' : ''
  state.diagnostics.push({
    line: line.no,
    message: `Couldn't find a date in "${outer.label}". Write it like ${example}.${short} ${DATE_HELP}`,
    severity: 'error',
  })
  return null
}

function pointItem({
  keyword,
  outer,
  label,
  at,
  line,
}: {
  keyword: string
  outer: Labeled
  label: string
  at: TimePoint
  line: Line
}): TimelineEvent {
  const clean = cleanLabel({ label, outer })
  return {
    kind: 'event',
    label: clean.label,
    id: clean.id,
    at,
    major: clean.flags.has('major'),
    milestone: keyword === 'milestone' || clean.flags.has('milestone'),
    color: clean.color,
    line: line.no,
  }
}
