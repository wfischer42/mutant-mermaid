import {
  type Diagnostic,
  header,
  indentTree,
  type Line,
  labeled,
  readLines,
  type TreeNode,
  unquote,
} from '../../core/parse.ts'

/**
 * Shared reading for the tree-shaped languages in this family (mind maps, argument maps, issue
 * trees): a header line, then an indented outline. Mermaid's mindmap syntax is accepted too, so
 * node shapes such as `root((Title))` or `id[Label]`, `::icon(...)` and `:::class` are stripped.
 */
export interface OutlineNode {
  label: string
  color?: string
  flags: Set<string>
  attrs: Record<string, string>
  /** A leading marker the caller asked for, such as `+` or `-` in an argument map. */
  mark?: string
  line: number
  children: OutlineNode[]
}

export interface Outline {
  title: string
  /** The header's `#color`, for the root when the title is the root. */
  color?: string
  attrs: Record<string, string>
  flags: Set<string>
  headerLine: number
  roots: OutlineNode[]
  /** Lines claimed by the caller's `aside` test instead of joining the outline, e.g. cross-links. */
  asides: Line[]
}

const SHAPES: [string, string][] = [
  ['((', '))'],
  ['))', '(('],
  ['{{', '}}'],
  ['[', ']'],
  ['(', ')'],
  [')', '('],
]

/** `id[Label]`, `root((Label))`, `id{{Label}}` and the other Mermaid shapes become `Label`. */
export function stripShape(text: string): string {
  const id = /^[\w-]*/.exec(text)?.[0] ?? ''
  const rest = text.slice(id.length)
  for (const [open, close] of SHAPES) {
    if (rest.length < open.length + close.length) continue
    if (rest.startsWith(open) && rest.endsWith(close))
      return tidyLabel(rest.slice(open.length, rest.length - close.length))
  }
  return tidyLabel(text)
}

/** Unquotes, drops Mermaid's markdown backticks and turns `<br>` into a line break. */
function tidyLabel(text: string): string {
  const unq = unquote(text.trim())
  const unticked = /^`[\s\S]*`$/.test(unq) ? unq.slice(1, -1) : unq
  return unticked.replace(/<br\s*\/?>/gi, '\n').trim()
}

/** A node's label and trailing attributes, with Mermaid decorations removed. */
export function cleanLabel(text: string): {
  label: string
  color?: string
  flags: Set<string>
  attrs: Record<string, string>
} {
  const iconless = text.replace(/\s*::icon\([^)]*\)/g, '')
  const { label, color, flags, attrs } = labeled(iconless)
  const classless = label.replace(/:::[\w-]+(?:\s+[\w-]+)*\s*$/, '')
  return { label: stripShape(classless), color, flags, attrs }
}

/** Mermaid lines that decorate the node above them rather than adding one. */
function isDecoration(text: string): boolean {
  return /^::icon\(/.test(text) || /^:::/.test(text)
}

function toNode({ tree, mark }: { tree: TreeNode; mark?: RegExp }): OutlineNode {
  let text = tree.line.text
  let found: string | undefined
  const m = mark?.exec(text)
  if (m) {
    found = m[1]
    text = text.slice(m[0].length)
  }
  const clean = cleanLabel(text)
  return {
    ...clean,
    mark: found,
    line: tree.line.no,
    children: tree.children.map((child) => toNode({ tree: child, mark })),
  }
}

/**
 * Reads the header and the outline below it. `mark` captures a leading marker (group 1) on every
 * node; `aside` claims lines that aren't nodes.
 */
export function readOutline({
  source,
  mark,
  aside,
}: {
  source: string
  mark?: RegExp
  aside?: (text: string) => boolean
}): Outline {
  const [first, ...rest] = readLines(source)
  const keyword = first?.text.split(/\s/)[0] ?? ''
  const head = header({ text: first?.text ?? '', keyword })
  const asides: Line[] = []
  const lines: Line[] = []
  for (const line of rest) {
    if (isDecoration(line.text)) continue
    if (aside?.(line.text)) asides.push(line)
    else lines.push(line)
  }
  return {
    title: stripShape(head.label),
    color: head.color,
    attrs: head.attrs,
    flags: head.flags,
    headerLine: first?.no ?? 1,
    roots: indentTree(lines).map((tree) => toNode({ tree, mark })),
    asides,
  }
}

/**
 * The single root of an outline: the header's title holding the top-level lines, or the one
 * top-level line (Mermaid style). Extra top-level lines join the first with a warning.
 */
export function rootOf({ outline, what }: { outline: Outline; what: string }): {
  root: OutlineNode | null
  diagnostics: Diagnostic[]
} {
  const { title, color, flags, roots, headerLine } = outline
  if (title)
    return {
      root: { label: title, color, flags, attrs: {}, line: headerLine, children: roots },
      diagnostics: [],
    }
  const [first, ...others] = roots
  if (!first)
    return {
      root: null,
      diagnostics: [
        {
          line: headerLine,
          message: `A ${what} needs a title after the keyword, or an indented first line, e.g. \`${what} "Topic"\`.`,
          severity: 'error',
        },
      ],
    }
  if (!others.length) return { root: first, diagnostics: [] }
  return {
    root: { ...first, children: [...first.children, ...others] },
    diagnostics: others.map((other) => ({
      line: other.line,
      message: `Only one top-level line is allowed; "${other.label}" was put under "${first.label}". Indent it, or give the header a title.`,
      severity: 'warning' as const,
    })),
  }
}
