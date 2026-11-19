/**
 * Hooks for a host app: renderers tag the parts a reader can point at with `data-mm-id` and
 * `data-mm-kind`, and Mermaid's `click` lines name an action for a part. The SVG stays inert;
 * `bind` in interact.ts wires it to the app's handlers in the browser.
 */
import type { Diagnostic } from './parse.ts'
import { type Attrs, esc, h } from './svg.ts'

/** What a `click` line asks of the host app: a named action with arguments, or a link. */
export interface Hook {
  action: string
  args: string[]
  /** Hover text, shown as the part's native tooltip. */
  tip?: string
}

/** Hooks by the id of the part they're for, with the source line of each. */
export type Hooks = Map<string, Hook & { line: number }>

/**
 * The attributes that make a part addressable by the host app. `tint` is the part's own color,
 * set as `--mm-tint` so the app's hover styles and cards can match the theme.
 */
export function target({ id, kind, tint }: { id: string; kind: string; tint?: string }): Attrs {
  return {
    'data-mm-id': id,
    'data-mm-kind': kind,
    style: tint ? `--mm-tint:${tint}` : undefined,
  }
}

/** Makes ids unique in the order asked for: a second `a` becomes `a-2`. */
export function uniqueIds(): (base: string) => string {
  const seen = new Map<string, number>()
  return (base) => {
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  }
}

/** A label as an id: `Launch day!` becomes `launch-day`. */
export function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'item'
  )
}

/**
 * Ids for parts that have no name of their own, from their labels, so an id holds while other
 * parts are edited: `Launch day` becomes `launch-day`, a second one `launch-day-2`.
 */
export function idMaker(): (label: string) => string {
  const unique = uniqueIds()
  return (label) => unique(slug(label))
}

const TOKEN = /"([^"]*)"|([\p{L}\p{N}_$.]+\([^)]*\))|(\S+)/gu
const CALL = /^([\p{L}\p{N}_$.]+)(?:\(([^)]*)\))?$/u
const TARGET = /^_(self|blank|parent|top)$/

type Token = { quoted: boolean; text: string }

function tokens(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((m) =>
    m[1] !== undefined ? { quoted: true, text: m[1] } : { quoted: false, text: m[2] ?? m[3] },
  )
}

/** `"a", 2, b` as ['a', '2', 'b']: commas outside quotes split, quotes are dropped. */
function callArgs(text: string): string[] {
  const parts = text.match(/"[^"]*"|[^,]+/g) ?? []
  return parts.map((p) => p.trim().replace(/^"(.*)"$/, '$1')).filter((p) => p !== '')
}

/** `href "/docs" … _blank` or `"/docs" … _blank`; takes the target off the end of `rest`. */
function linkHook({ first, rest }: { first: Token; rest: Token[] }): Hook | null {
  const url = first.quoted ? first : rest.shift()
  if (!url?.quoted) return null
  const last = rest.at(-1)
  const target = last && !last.quoted && TARGET.test(last.text) ? rest.pop() : undefined
  return { action: 'href', args: target ? [url.text, target.text] : [url.text] }
}

/** `openCard`, `openCard("auth")` or `call openCard("auth")`. */
function callHook({ first, rest }: { first: Token; rest: Token[] }): Hook | null {
  const call = first.text === 'call' ? rest.shift() : first
  const parsed = call && !call.quoted ? CALL.exec(call.text) : null
  if (!parsed) return null
  return { action: parsed[1], args: parsed[2] ? callArgs(parsed[2]) : [] }
}

/**
 * A `click` line in any of Mermaid's forms, or null when it isn't one:
 * `click A openCard`, `click A call openCard("auth", 2)`, `click A href "/docs" "Docs" _blank`,
 * `click A "/docs"`, each with an optional quoted tooltip.
 */
export function parseClick(text: string): { id: string; hook: Hook } | null {
  const m = /^click\s+(?:"([^"]+)"|(\S+))\s+(.+)$/.exec(text)
  if (!m) return null
  const id = m[1] ?? m[2]
  const [first, ...rest] = tokens(m[3])
  const link = first.quoted || first.text === 'href'
  const hook = link ? linkHook({ first, rest }) : callHook({ first, rest })
  if (!hook) return null
  if (rest[0]?.quoted) hook.tip = rest.shift()?.text
  return rest.length ? null : { id, hook }
}

/**
 * Takes the `click` lines out of a diagram body, leaving them blank so line numbers hold, and
 * returns what each asked for. `drawn` is the body without those lines at all, to seed the
 * drawing from, so adding a hook never changes how a diagram looks.
 */
export function extractHooks(body: string): { body: string; drawn: string; hooks: Hooks } {
  const hooks: Hooks = new Map()
  const lines = body.split('\n').map((raw, i) => {
    const click = parseClick(raw.replace(/(^|\s)%%.*$/, '').trim())
    if (!click) return raw
    hooks.set(click.id, { ...click.hook, line: i + 1 })
    return null
  })
  return {
    body: lines.map((line) => line ?? '').join('\n'),
    drawn: lines.filter((line) => line !== null).join('\n'),
    hooks,
  }
}

/** Ids for a tree of labeled nodes, depth first: a node's own `id=`, else its label as a slug. */
export function treeIds<T extends { label: string; id?: string; children: T[] }>(
  root: T,
): Map<T, string> {
  const next = uniqueIds()
  const ids = new Map<T, string>()
  const walk = (node: T) => {
    ids.set(node, next(node.id ?? slug(node.label)))
    node.children.forEach(walk)
  }
  walk(root)
  return ids
}

/** A part drawn across several layers, tagged by one box over all of them. */
export interface HitArea {
  id: string
  kind: string
  tint?: string
  box: { x: number; y: number; w: number; h: number }
}

/**
 * Invisible boxes over parts, drawn last so they catch the pointer whatever is under them. A
 * zero-opacity fill still counts as painted, so the browser hit-tests it; a still image shows
 * nothing.
 */
export function hitAreas(areas: HitArea[]): string {
  if (!areas.length) return ''
  return h(
    'g',
    { class: 'mm-hits' },
    ...areas.map(({ id, kind, tint, box }) =>
      h(
        'g',
        target({ id, kind, tint }),
        h('rect', {
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
          fill: '#000',
          'fill-opacity': 0,
        }),
      ),
    ),
  )
}

/** How the tree-shaped types name their nodes, for their guides. */
export const TREE_IDS =
  'A node goes by its `id=` option (`Kyoto id=kyoto`), or else its label as a lowercase slug (`Fushimi Inari` is `fushimi-inari`); a repeat gets `-2`, `-3`. Give `id=` to anything a click line names, so rewording it keeps the hook.'

/** The guide bullet on `click` lines, shared by every type that tags its parts. */
export function clickSyntax(ids: string): string {
  return `- **Click lines** hand a part to the app showing the diagram: \`click A openCard\`,
  \`click A call openCard("auth", 2) "Tooltip"\`, \`click A href "/docs" _blank\`. ${ids} The app
  decides what each action name does; a still image ignores them. A \`click\` on an id the diagram
  lacks warns.`
}

/** Shows the pointer over parts with an action. */
export const HOOK_CSS = '[data-mm-action]{cursor:pointer}'

const TAGGED = /<g\b([^>]*?) data-mm-id="([^"]*)"([^>]*)>/g

/** Undoes `esc` on an attribute value. */
function unescape(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

/** The attributes and tooltip a hook adds to its part's opening tag. */
function hookMarkup(hook: Hook): { attrs: string; tip: string } {
  const attrs = h('x', {
    'data-mm-action': hook.action,
    'data-mm-args': hook.args.length ? JSON.stringify(hook.args) : undefined,
  }).slice(2, -2)
  return { attrs, tip: hook.tip ? h('title', {}, esc(hook.tip)) : '' }
}

/**
 * Writes each hook onto the parts tagged with its id. A hook whose id no part has warns, naming
 * the ids there are.
 */
export function applyHooks(input: { svg: string; hooks: Hooks }): {
  svg: string
  diagnostics: Diagnostic[]
} {
  const { svg, hooks } = input
  if (!hooks.size) return { svg, diagnostics: [] }
  const byEscaped = new Map([...hooks].map(([id, hook]) => [esc(id), { id, hook }]))
  const ids = new Set<string>()
  const used = new Set<string>()
  const out = svg.replace(TAGGED, (...m: string[]) => {
    const [whole, before, escaped, after] = m
    const found = byEscaped.get(escaped)
    ids.add(found?.id ?? unescape(escaped))
    if (!found) return whole
    used.add(found.id)
    const { attrs, tip } = hookMarkup(found.hook)
    return `<g${before} data-mm-id="${escaped}"${after}${attrs}>${tip}`
  })
  const known = [...ids].slice(0, 12).join(', ')
  const diagnostics: Diagnostic[] = [...hooks]
    .filter(([id]) => !used.has(id))
    .map(([id, hook]) => ({
      line: hook.line,
      severity: 'warning',
      message: `\`click ${id}\`: nothing in this diagram has the id "${id}".${known ? ` Ids here: ${known}.` : ''}`,
    }))
  return { svg: out, diagnostics }
}
