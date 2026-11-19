import { type Diagnostic, header, type Line, readLines, unquote } from '../../core/parse.ts'
import type { Parsed } from '../../core/types.ts'
import type { LoopDecl, LoopKind, Polarity, SystemsModel } from './model.ts'
import { readTrend, TREND_NAMES } from './trend.ts'

/**
 * Causal loop diagrams and stock & flow, one language:
 *
 *   cld "Adoption"
 *     "Word of mouth" -> Adopters : +
 *     Adopters -> "Word of mouth" : + ||
 *     loop R "Word of mouth"
 *     loop B2 "Saturation": Adopters, Potential
 *
 *   stockflow "Population"
 *     stock Population
 *     flow births : cloud -> Population
 *     aux birth_rate
 *     birth_rate -> births
 */

const ARROW = /\s*(?:-->|->|→)\s*/
const POSITIVE = new Set(['+', 's', 'same', 'positive', 'plus'])
const NEGATIVE = new Set(['-', '−', 'o', 'opposite', 'negative', 'minus'])
const DELAY = new Set(['||', '//', 'delay', 'delayed'])
const CLOUDS = new Set(['cloud', 'source', 'sink', '()', '*'])
const DECLARATIONS = new Set(['stock', 'aux', 'auxiliary', 'var', 'variable'])
const AUX = new Set(['aux', 'auxiliary'])

/** Splits `text` at the first `:` that sits outside double quotes, or returns null. */
function splitColon(text: string): [string, string] | null {
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') quoted = !quoted
    if (ch === ':' && !quoted) return [text.slice(0, i).trim(), text.slice(i + 1).trim()]
  }
  return null
}

interface Marks {
  polarity: Polarity
  delay: boolean
  unknown: string[]
}

/** Applies one polarity or delay word, such as `+`, `opposite`, `||` or `-||`. */
function applyMark({ marks, raw }: { marks: Marks; raw: string }): void {
  const word = raw.toLowerCase()
  const combined = /^([+\-−])(\|\||\/\/)$/.exec(word)
  if (POSITIVE.has(word)) marks.polarity = '+'
  else if (NEGATIVE.has(word)) marks.polarity = '-'
  else if (DELAY.has(word)) marks.delay = true
  else if (combined) {
    marks.polarity = combined[1] === '+' ? '+' : '-'
    marks.delay = true
  } else marks.unknown.push(raw)
}

/** Reads polarity and delay markers from words such as `+ ||` or `opposite delay`. */
function readMarks(words: string[]): Marks {
  const marks: Marks = { polarity: '?', delay: false, unknown: [] }
  for (const raw of words) applyMark({ marks, raw })
  return marks
}

function isMark(word: string): boolean {
  const lower = word.toLowerCase()
  return POSITIVE.has(lower) || NEGATIVE.has(lower) || DELAY.has(lower)
}

/** Peels polarity and delay words off the end of a target written without a colon. */
function peelMarks(text: string): { name: string; marks: string[] } {
  const words = text.split(/\s+/)
  const marks: string[] = []
  while (words.length > 1 && isMark(words[words.length - 1])) marks.unshift(words.pop() ?? '')
  return { name: words.join(' '), marks }
}

function cleanName(text: string): string {
  return unquote(text.trim()).trim()
}

/** `birth_rate` reads as "birth rate". */
function display(id: string): string {
  return /_/.test(id) && !/\s/.test(id) ? id.replace(/_+/g, ' ') : id
}

function kindOf(letter: string | undefined): LoopKind | null {
  if (!letter) return null
  return letter.toUpperCase() === 'R' ? 'R' : 'B'
}

function loopDecl({ rest, no }: { rest: string; no: number }): LoopDecl | null {
  const match = /^(?:([RBrb])(\d*)(?=[\s":]|$)\s*)?(?:"([^"]*)"|([^:]*?))\s*(?::\s*(.*))?$/.exec(
    rest,
  )
  if (!match) return null
  const [, letter, digits, quoted, bare, members] = match
  return {
    kind: kindOf(letter),
    number: digits ? Number(digits) : null,
    name: (quoted ?? bare ?? '').trim(),
    members: (members ?? '')
      .split(/\s*,\s*/)
      .map(cleanName)
      .filter(Boolean),
    line: no,
  }
}

/** Collects the model line by line. */
class Reader {
  model: SystemsModel
  diagnostics: Diagnostic[] = []
  kindLines: { members: string[]; no: number }[] = []
  trendLines: { name: string; no: number }[] = []

  constructor({ title, keyword }: { title: string; keyword: string }) {
    this.model = {
      title,
      mode: keyword === 'stockflow' ? 'stockflow' : 'cld',
      variables: [],
      links: [],
      loops: [],
      stocks: [],
      flows: [],
      auxes: [],
      labels: {},
      kinds: [],
      trends: {},
    }
  }

  mention(name: string): void {
    if (!this.model.variables.includes(name)) this.model.variables.push(name)
    this.model.labels[name] ??= display(name)
  }

  error({ line, message }: { line: number; message: string }): void {
    this.diagnostics.push({ line, message, severity: 'error' })
  }

  read({ text, no }: Line): void {
    const word = /^(\w+)\s+(?!-->|->|→)(.*)$/.exec(text)
    const verb = word?.[1].toLowerCase() ?? ''
    const body = word?.[2].trim() ?? ''
    if (verb === 'loop') return this.loop({ body, no })
    const link = ARROW.test(body)
    if (verb === 'kind' && !link) return this.kind({ body, no })
    if (verb === 'trend' && !link) return this.trend({ body, no })
    if (DECLARATIONS.has(verb)) return this.declare({ verb, body })
    if (verb === 'flow' || verb === 'rate') return this.flow({ body, no })
    this.link({ text, no })
  }

  loop({ body, no }: { body: string; no: number }): void {
    const decl = loopDecl({ rest: body, no })
    if (decl) this.model.loops.push(decl)
    else
      this.error({
        line: no,
        message: 'Write a loop as `loop R "Name"` or `loop B1 "Name": A, B, C`.',
      })
  }

  kind({ body, no }: { body: string; no: number }): void {
    const parts = splitColon(body)
    const name = parts && cleanName(parts[0])
    const members = (parts?.[1] ?? '').split(/\s*,\s*/).map(cleanName).filter(Boolean)
    if (!(name && members.length)) {
      this.error({ line: no, message: 'Write a kind as `kind Policy: Price, "Ad spend"`.' })
      return
    }
    const known = this.model.kinds.find((k) => k.name === name)
    if (known) known.members.push(...members)
    else this.model.kinds.push({ name, members: [...members] })
    this.kindLines.push({ members, no })
  }

  trend({ body, no }: { body: string; no: number }): void {
    const parts = splitColon(body)
    const name = parts && cleanName(parts[0])
    const shape = parts && readTrend(parts[1])
    if (!(name && shape)) {
      this.error({
        line: no,
        message: `Write a trend as \`trend Adopters: s-curve\`, with one of ${TREND_NAMES.join(', ')}.`,
      })
      return
    }
    this.model.trends[name] = shape
    this.trendLines.push({ name, no })
  }

  declare({ verb, body }: { verb: string; body: string }): void {
    for (const name of body
      .split(/\s*,\s*/)
      .map(cleanName)
      .filter(Boolean)) {
      this.mention(name)
      if (verb === 'stock') this.addStock(name)
      if (AUX.has(verb) && !this.model.auxes.includes(name)) this.model.auxes.push(name)
    }
  }

  addStock(name: string): void {
    if (!this.model.stocks.includes(name)) this.model.stocks.push(name)
  }

  flow({ body, no }: { body: string; no: number }): void {
    const parts = splitColon(body)
    const ends = parts?.[1].split(ARROW)
    if (!parts || ends?.length !== 2) {
      this.error({ line: no, message: 'Write a flow as `flow births : cloud -> Population`.' })
      return
    }
    const id = cleanName(parts[0])
    const [from, to] = ends
      .map(cleanName)
      .map((end) => (CLOUDS.has(end.toLowerCase()) ? null : end))
    this.mention(id)
    if (from === null && to === null) return this.strayFlow({ id, no })
    for (const end of [from, to].filter((e): e is string => e !== null)) {
      this.mention(end)
      this.addStock(end)
    }
    this.model.flows.push({ id, from, to, line: no })
  }

  /** A flow with a cloud at both ends fills nothing; it's kept as an aux so its links still land. */
  strayFlow({ id, no }: { id: string; no: number }): void {
    if (!this.model.auxes.includes(id)) this.model.auxes.push(id)
    this.diagnostics.push({
      line: no,
      message: `Flow "${id}" runs from a cloud to a cloud, so it's drawn as an aux. Name the stock it fills or drains: \`flow ${id} : cloud -> Stock\`.`,
      severity: 'warning',
    })
  }

  link({ text, no }: { text: string; no: number }): void {
    const ends = text.split(ARROW)
    if (ends.length < 2) {
      this.error({
        line: no,
        message: `Couldn't read "${text}". Write a link as \`A -> B : +\`, or declare \`stock\`, \`flow\`, \`aux\` or \`loop\`.`,
      })
      return
    }
    if (ends.length > 2) {
      this.error({ line: no, message: 'Write one link per line: `A -> B : +`.' })
      return
    }
    const target = splitColon(ends[1])
    const peeled = target ? { name: target[0], marks: target[1].split(/\s+/) } : peelMarks(ends[1])
    const marks = readMarks(peeled.marks.filter(Boolean))
    const from = cleanName(ends[0])
    const to = cleanName(peeled.name)
    if (!from || !to) {
      this.error({ line: no, message: 'A link needs a name on both sides of `->`.' })
      return
    }
    if (marks.unknown.length)
      this.diagnostics.push({
        line: no,
        message: `Unknown mark "${marks.unknown.join(' ')}": use + or -, s or o, and || for a delay.`,
        severity: 'warning',
      })
    this.mention(from)
    this.mention(to)
    this.model.links.push({ from, to, polarity: marks.polarity, delay: marks.delay, line: no })
  }

  /** Warns about kinds and trends that name no variable (a trend may also name a loop tag). */
  unknownNames(): void {
    const known = new Set(this.model.variables)
    const warn = ({ line, name }: { line: number; name: string }) =>
      this.diagnostics.push({
        line,
        message: `"${name}" isn't a variable in this diagram, so nothing is marked.`,
        severity: 'warning',
      })
    for (const { members, no } of this.kindLines)
      for (const name of members.filter((m) => !known.has(m))) warn({ line: no, name })
    for (const { name, no } of this.trendLines)
      if (!(known.has(name) || /^[RB]\d+$/i.test(name))) warn({ line: no, name })
  }

  /** Settles the mode and reports what's missing once every line is read. */
  finish(firstLine: number): void {
    const { model } = this
    if (model.stocks.length || model.flows.length) model.mode = 'stockflow'
    const unsigned = model.mode === 'cld' ? model.links.filter((l) => l.polarity === '?') : []
    for (const link of unsigned)
      this.diagnostics.push({
        line: link.line,
        message: `The link ${link.from} -> ${link.to} has no polarity; add \`: +\` or \`: -\`. Treating it as +.`,
        severity: 'warning',
      })
    this.unknownNames()
    if (!model.links.length && !model.stocks.length)
      this.error({
        line: firstLine,
        message: 'Add links under the header, such as `Sales -> Word of mouth : +`.',
      })
  }
}

export function parseSystems(source: string): Parsed<SystemsModel> {
  const [first, ...rest] = readLines(source)
  const keyword = (first?.text.split(/\s/)[0] ?? '').toLowerCase()
  const head = header({ text: first?.text ?? '', keyword })
  const reader = new Reader({ title: head.label, keyword })
  for (const line of rest) reader.read(line)
  reader.finish(first?.no ?? 1)
  return { model: reader.model, diagnostics: reader.diagnostics }
}
