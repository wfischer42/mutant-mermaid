/**
 * Shared pieces for the line-oriented, indentation-based languages: reading lines, building an
 * indentation tree, and pulling trailing attributes off a label.
 *
 * Comments start with `%%`, as in Mermaid, either on their own line or after whitespace.
 */
import { isColorName } from '../theme/index.ts'
import { iconBody } from './icons.ts'

export interface Diagnostic {
  /** 1-based source line. */
  line: number
  message: string
  severity: 'error' | 'warning'
}

export interface Line {
  /** 1-based source line. */
  no: number
  /** Leading whitespace in columns, a tab counting as 4. */
  indent: number
  /** The line without its indentation, trailing comment or trailing whitespace. */
  text: string
}

/** Non-blank, non-comment lines of a diagram. */
export function readLines(source: string): Line[] {
  const out: Line[] = []
  source.split(/\r?\n/).forEach((raw, i) => {
    const stripped = raw.replace(/(^|\s)%%.*$/, '').trimEnd()
    if (!stripped.trim()) return
    const lead = /^[\t ]*/.exec(stripped)?.[0] ?? ''
    const indent = [...lead].reduce((sum, ch) => sum + (ch === '\t' ? 4 : 1), 0)
    out.push({ no: i + 1, indent, text: stripped.slice(lead.length) })
  })
  return out
}

export interface TreeNode {
  line: Line
  children: TreeNode[]
}

/** Nests lines by indentation: each line is a child of the nearest line above it indented less. */
export function indentTree(lines: Line[]): TreeNode[] {
  const roots: TreeNode[] = []
  const stack: TreeNode[] = []
  for (const line of lines) {
    const node: TreeNode = { line, children: [] }
    while (stack.length && stack[stack.length - 1].line.indent >= line.indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

export interface Labeled {
  label: string
  /** The label before its quotes are stripped, for parsers that split it further. */
  raw: string
  /** `key=value` and `key="quoted value"` pairs. */
  attrs: Record<string, string>
  /** `!word` flags, such as `!major`. */
  flags: Set<string>
  /** A `#hex` color or a `#name` palette color. */
  color?: string
  /** `:::class` names. */
  classes: string[]
}

const TRAILING =
  /\s+(?:(?<key>[\w-]+)=(?:"(?<quoted>[^"]*)"|(?<value>\S+))|!(?<flag>[\w-]+)|#(?<color>[0-9a-fA-F]{3,8}|[a-zA-Z]+)|:::(?<cls>[\w-]+))$/

/**
 * The color a `#token` names: `#e4572e` or `#fff` is hex, `#coral` a palette name. Anything else
 * (`#launch`, `#482`) is null, since it's part of the text: a three-digit hex needs a letter, so
 * `Issue #482` keeps its number.
 */
function colorToken(token: string): string | null {
  const hex = /^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(token)
  const short = /^[0-9a-fA-F]{3}$/.test(token) && /[a-fA-F]/.test(token)
  if (hex || short) return `#${token}`
  return isColorName(token) ? token : null
}

/** Records one trailing attribute; false when it's really text, such as `#launch`. */
function takeAttribute({ result, groups }: { result: Labeled; groups: Record<string, string> }) {
  const { key, quoted, value, flag, color, cls } = groups
  const named = color ? colorToken(color) : null
  if (color && !named) return false
  if (key) result.attrs[key] = quoted ?? value
  else if (flag) result.flags.add(flag)
  else if (cls) result.classes.unshift(cls)
  else if (named) result.color ??= named
  return true
}

/**
 * Splits trailing attributes off a label. Attributes are only recognized at the end, so a label
 * can still contain `=` or `#` in its words: `C# basics` stays whole, `Food #coral` doesn't. A
 * `#word` that names no color ends the attributes, so `Ship #launch` keeps its hashtag.
 */
export function labeled(text: string): Labeled {
  const result: Labeled = { label: '', raw: '', attrs: {}, flags: new Set(), classes: [] }
  let rest = ` ${text.trim()}`
  for (;;) {
    const match = TRAILING.exec(rest)
    if (!match?.groups || !takeAttribute({ result, groups: match.groups })) break
    rest = rest.slice(0, match.index)
  }
  result.raw = rest.trim()
  result.label = unquote(result.raw)
  return result
}

/** Whether the character at `at` is a `: ` separator, not one that closes an `:icon:`. */
function isSeparator({ text, at }: { text: string; at: number }): boolean {
  if (text[at] !== ':' || !/\s/.test(text[at + 1] ?? '')) return false
  const name = /(?:^|\s):([a-z][a-z0-9-]*)$/.exec(text.slice(0, at))?.[1]
  return !(name && iconBody(name))
}

/** Splits at the first `: ` outside double quotes and icons, or returns null. */
export function splitNote(text: string): [string, string] | null {
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted
    if (!quoted && isSeparator({ text, at: i })) {
      return [text.slice(0, i).trimEnd(), text.slice(i + 1).trim()]
    }
  }
  return null
}

/** Strips one pair of surrounding double quotes. */
export function unquote(text: string): string {
  return /^".*"$/.test(text) ? text.slice(1, -1) : text
}

/** The title and attributes after a header keyword, as in `mindmap "Trip" style=organic`. */
export function header({ text, keyword }: { text: string; keyword: string }): Labeled {
  return labeled(text.slice(keyword.length).trim())
}

export interface Frontmatter {
  values: Record<string, string>
  /**
   * The source with its frontmatter blanked out: blank lines stay where the frontmatter was, so
   * diagnostics keep their line numbers.
   */
  body: string
}

/** A `---` block of `key: value` lines at the top of the source, as in Mermaid. */
export function frontmatter(source: string): Frontmatter {
  const match = /^\s*---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source)
  if (!match) return { values: {}, body: source }
  const values: Record<string, string> = {}
  let section = ''
  for (const raw of match[1].split(/\r?\n/)) {
    const m = /^(\s*)([\w-]+)\s*:\s*(.*)$/.exec(raw)
    if (!m) continue
    const [, indent, key, value] = m
    if (!indent && !value) section = key
    else values[indent && section ? `${section}.${key}` : key] = unquote(value.trim())
  }
  const blank = '\n'.repeat(match[0].split(/\n/).length - 1)
  return { values, body: blank + source.slice(match[0].length) }
}
