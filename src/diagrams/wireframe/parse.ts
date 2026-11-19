import {
  type Diagnostic,
  indentTree,
  type Line,
  labeled,
  readLines,
  type TreeNode,
  unquote,
} from '../../core/parse.ts'
import type { Parsed } from '../../core/types.ts'
import { readHead } from '../templates/common.ts'
import {
  CONTAINERS,
  type Device,
  type Element,
  isContainer,
  type Kind,
  type Part,
  WIDGETS,
  type WireframeModel,
} from './model.ts'

/** Other words people reach for, mapped to the element they mean. */
const ALIASES: Record<string, Kind> = {
  column: 'col',
  stack: 'col',
  vstack: 'col',
  hstack: 'row',
  navbar: 'header',
  topbar: 'header',
  appbar: 'header',
  aside: 'sidebar',
  content: 'main',
  body: 'main',
  panel: 'card',
  box: 'card',
  dialog: 'modal',
  title: 'h1',
  heading: 'h2',
  subheading: 'h3',
  p: 'text',
  para: 'text',
  paragraph: 'text',
  label: 'text',
  a: 'link',
  btn: 'button',
  field: 'input',
  password: 'input',
  email: 'input',
  dropdown: 'select',
  checkbox: 'check',
  switch: 'toggle',
  img: 'image',
  photo: 'image',
  picture: 'image',
  video: 'image',
  map: 'image',
  chip: 'badge',
  tag: 'badge',
  pill: 'badge',
  menu: 'nav',
  links: 'nav',
  tab: 'tabs',
  hr: 'divider',
  separator: 'divider',
  '---': 'divider',
  space: 'spacer',
  gap: 'spacer',
}

const DEVICES: Record<string, Device> = {
  phone: 'phone',
  mobile: 'phone',
  tablet: 'tablet',
  ipad: 'tablet',
  browser: 'browser',
  desktop: 'browser',
  web: 'browser',
  none: 'none',
  plain: 'none',
}

export const DEVICE_WIDTH: Record<Device, number> = {
  phone: 375,
  tablet: 768,
  browser: 1024,
  none: 640,
}

function kindOf(word: string): Kind | null {
  const key = word.toLowerCase()
  const known = [...CONTAINERS, ...WIDGETS].find((k) => k === key)
  return known ?? ALIASES[key] ?? null
}

/** `Home | [Pricing] | Docs`: brackets mark a part as selected or as a button. */
export function readParts(text: string): Part[] {
  return text
    .split(/\s+\|\s+|^\|\s*|\s*\|$/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const marked = /^\[.*\]$/.test(piece)
      return { text: marked ? piece.slice(1, -1).trim() : piece, marked }
    })
}

/** Flags implied by an alias, such as `password` meaning a masked input. */
function impliedFlags(word: string): string[] {
  const key = word.toLowerCase()
  if (key === 'password') return ['secret']
  if (key === 'video') return ['play']
  return []
}

/** Fields, where ` : ` splits the field's name from its placeholder. */
const NOTED = new Set<Kind>(['input', 'textarea', 'select'])

/** A field's `Name : placeholder`; any other label keeps its colon. */
function splitNote({ kind, label }: { kind: Kind | null; label: string }) {
  const split = /\s*:\s+/.exec(label)
  if (!kind || !NOTED.has(kind) || !split) return { label, note: undefined }
  const note = unquote(label.slice(split.index + split[0].length).trim())
  return { label: unquote(label.slice(0, split.index).trim()), note: note || undefined }
}

interface Read {
  element: Element
  unknown: boolean
}

/**
 * Reads one line; an unknown first word makes the whole line a text element. Labels are taken
 * as written, so `@`, `#` inside words and colons outside fields all stay.
 */
function readElement(line: Line): Read {
  const word = line.text.split(/\s/)[0]
  const kind = kindOf(word)
  const rest = kind ? line.text.slice(word.length).trim() : line.text
  const parsed = labeled(rest)
  const { label, note } = splitNote({ kind, label: parsed.label })
  const element: Element = {
    kind: kind ?? 'text',
    label,
    note,
    parts: readParts(label),
    attrs: parsed.attrs,
    flags: new Set([
      ...parsed.flags,
      ...impliedFlags(word),
      ...(rest.startsWith('"') ? ['literal'] : []),
    ]),
    color: parsed.color,
    rows: [],
    children: [],
    line: line.no,
  }
  return { element, unknown: kind === null }
}

/** Problems with a line that's still drawn: an unknown element, ignored color or children. */
function lineWarnings({ node, read }: { node: TreeNode; read: Read }): string[] {
  const { element } = read
  const warnings: string[] = []
  if (read.unknown)
    warnings.push(
      `"${node.line.text.split(/\s/)[0]}" isn't a wireframe element, so the line is drawn as text. Start it with an element such as button, input, text, image, row or card.`,
    )
  if (element.color)
    warnings.push('Wireframes are drawn in greys only, so the color is ignored. Remove the #color.')
  const leaf = !isContainer(element.kind) && !holdsRows(element.kind)
  if (leaf && node.children.length)
    warnings.push(
      `A ${element.kind} can't hold other elements, so the lines indented under it are left out. Put them in a row, col or card instead.`,
    )
  return warnings
}

/** Lists and tables hold rows of text, not elements. */
function holdsRows(kind: Kind): boolean {
  return kind === 'list' || kind === 'table'
}

function readTree({ node, diagnostics }: { node: TreeNode; diagnostics: Diagnostic[] }): Element {
  const read = readElement(node.line)
  const { element } = read
  for (const message of lineWarnings({ node, read }))
    diagnostics.push({ line: node.line.no, message, severity: 'warning' })
  if (holdsRows(element.kind)) {
    element.rows = node.children.map((child) => readParts(child.line.text))
    return element
  }
  element.children = node.children.map((child) => readTree({ node: child, diagnostics }))
  return element
}

export function parseWireframe(source: string): Parsed<WireframeModel> {
  const [first, ...rest] = readLines(source)
  const head = readHead(first)
  const diagnostics: Diagnostic[] = []
  const deviceWord = (head.attrs.device ?? '').toLowerCase()
  const device = DEVICES[deviceWord] ?? 'browser'
  if (deviceWord && !DEVICES[deviceWord])
    diagnostics.push({
      line: head.line,
      message: `Unknown device "${deviceWord}": use phone, tablet, browser or none.`,
      severity: 'warning',
    })
  const elements = indentTree(rest).map((node) => readTree({ node, diagnostics }))
  if (!elements.length)
    diagnostics.push({
      line: head.line,
      message: 'A wireframe needs elements, indented under it: header, text, button, input…',
      severity: 'error',
    })
  const width = Number(head.attrs.width) || DEVICE_WIDTH[device]
  return {
    model: { title: head.title, device, width, url: head.attrs.url ?? '', elements },
    diagnostics,
  }
}
