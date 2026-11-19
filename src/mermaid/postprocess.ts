/**
 * DOM post-processing for Mermaid's SVG output. Works on any DOM (a browser page, or the headless
 * page), so every step is a plain function of an element. The headless renderer ships these
 * functions into its page as source (`POSTPROCESS_SCRIPT`), so each one may call only the others
 * and browser globals, never an import.
 */

export interface PostprocessOptions {
  /** A canvas color painted behind the diagram, or null for a transparent one. */
  background: string | null
  /** Space added around Mermaid's own bounds, in px. */
  padding: number
  /** The label size every diagram's text should come out at, in px. */
  fontSize: number
  /**
   * CSS for diagrams Mermaid ships with no stylesheet of their own (wardley), so none of the theme
   * CSS reaches them. `#ID` in it stands for the svg's id.
   */
  fallbackCss: string
}

export interface Sized {
  svg: string
  width: number
  height: number
}

/**
 * Mermaid centers labels in boxes (sequence actors, notes) with a central baseline on the <text>,
 * but the words are in a <tspan>; WebKit and resvg don't pass the baseline down to it, so they sit
 * on the center line instead of around it. Dropping the text by a fixed share of its size from an
 * alphabetic baseline centers it the same way in every engine.
 */
export function centerLabels({ root, fontSize }: { root: Element; fontSize: number }): void {
  const drop = 0.32
  for (const text of Array.from(root.querySelectorAll('text'))) {
    const style = text.getAttribute('style') ?? ''
    const inline = /dominant-baseline:\s*(central|middle)/.test(style)
    const baseline = text.getAttribute('dominant-baseline')
    if (!(inline || baseline === 'central' || baseline === 'middle')) continue
    const size = Number.parseFloat(
      /font-size:\s*([\d.]+)/.exec(style)?.[1] ?? text.getAttribute('font-size') ?? '',
    )
    text.removeAttribute('dominant-baseline')
    text.removeAttribute('alignment-baseline')
    text.setAttribute(
      'style',
      style.replace(/(dominant|alignment)-baseline:\s*[\w-]+;?/g, '').trim(),
    )
    const own = text.getAttribute('transform')
    const dy = ((size > 0 ? size : fontSize) * drop).toFixed(2)
    text.setAttribute('transform', `${own ? `${own} ` : ''}translate(0 ${dy})`)
  }
}

/**
 * How much smaller to draw a diagram than its viewBox so its labels come out at the theme's size.
 * Venn diagrams alone size their text to a fixed canvas (48px on 800 × 450) rather than the canvas
 * to their text, which made their labels several times the size of every other diagram's.
 */
export function typeScale({ root, fontSize }: { root: Element; fontSize: number }): number {
  if (root.getAttribute('aria-roledescription') !== 'venn') return 1
  const label = root.querySelector('.venn-circle text') ?? root.querySelector('.venn-area text')
  const style = label?.getAttribute('style') ?? ''
  const size = Number.parseFloat(/font-size:\s*([\d.]+)/.exec(style)?.[1] ?? '48')
  return size > fontSize * 1.6 ? (fontSize * 1.6) / size : 1
}

/** A text element's inline font size in px, or 0 when it has none. */
export function fontSizeOf(text: Element): number {
  const style = text.getAttribute('style') ?? ''
  return Number.parseFloat(/font-size:\s*([\d.]+)/.exec(style)?.[1] ?? '0') || 0
}

/** Sets a text element's inline font size and y, keeping the rest of its style. */
export function resize({ text, size, y }: { text: Element; size: number; y: number }): void {
  const style = text.getAttribute('style') ?? ''
  text.setAttribute(
    'style',
    style.replace(/font-size:\s*[\d.]+px/, `font-size: ${size.toFixed(1)}px`),
  )
  text.setAttribute('y', y.toFixed(1))
}

/**
 * Treemap grows each leaf's label to fill its box, up to 38px, which dwarfs every other label.
 * Labels are capped at `limit` times the base size, with their values shrunk and pulled in to match.
 */
export function capTreemap({ root, fontSize }: { root: Element; fontSize: number }): void {
  const limit = fontSize * 1.6
  for (const label of Array.from(root.querySelectorAll('text.treemapLabel'))) {
    const size = fontSizeOf(label)
    if (size <= limit) continue
    const ratio = limit / size
    const value = label.parentElement?.querySelector('text.treemapValue') ?? null
    const labelY = Number(label.getAttribute('y'))
    const valueY = value ? Number(value.getAttribute('y')) : labelY
    const middle = (labelY + valueY) / 2
    const half = ((valueY - labelY) / 2) * ratio
    resize({ text: label, size: limit, y: middle - half })
    if (value) resize({ text: value, size: fontSizeOf(value) * ratio, y: middle + half })
  }
}

/**
 * Some diagrams (journey) offer each label as HTML with plain SVG text as the fallback. Images and
 * resvg draw the HTML blank, so only the text is kept.
 */
export function dropHtmlFallbacks(root: Element): void {
  for (const html of Array.from(root.querySelectorAll('switch > foreignObject'))) html.remove()
}

/** Lucide's "user" icon (ISC license), drawn on a 24-unit grid. */
export const PERSON_ICON =
  '<circle cx="12" cy="7" r="4"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>'

/** How wide a label draws: measured when the DOM can, else guessed from its length. */
export function labelWidth(label: Element): number {
  const measure: unknown = Reflect.get(label, 'getComputedTextLength')
  const measured = typeof measure === 'function' ? Number(measure.call(label)) : 0
  return measured || (label.textContent ?? '').length * 9
}

/**
 * Redraws one stick-figure actor as a box the size of `box`, with a person icon left of its name;
 * returns its name.
 */
export function personActor({
  man,
  box,
}: {
  man: Element
  box: { y: number; height: number; width: number; rx: number }
}): string | null {
  const head = man.querySelector('circle')
  const label = man.querySelector('text')
  if (!(head && label)) return null
  const cx = Number(head.getAttribute('cx'))
  const width = Number(head.getAttribute('width')) || box.width
  const ns = 'http://www.w3.org/2000/svg'
  const rect = man.ownerDocument.createElementNS(ns, 'rect')
  const at = { x: cx - width / 2, y: box.y, width, height: box.height, rx: box.rx, ry: box.rx }
  for (const [name, value] of Object.entries(at)) rect.setAttribute(name, String(value))
  rect.setAttribute('class', 'actor actor-top')
  const size = 18
  const gap = 6
  const left = cx - (size + gap + labelWidth(label)) / 2
  const middle = box.y + box.height / 2
  const icon = man.ownerDocument.createElementNS(ns, 'g')
  icon.setAttribute('class', 'actor-icon')
  icon.setAttribute('transform', `translate(${left} ${middle - size / 2}) scale(${size / 24})`)
  icon.innerHTML = PERSON_ICON
  const textX = String(cx + (size + gap) / 2)
  label.setAttribute('class', 'actor actor-box')
  label.setAttribute('x', textX)
  label.setAttribute('y', String(middle))
  label.setAttribute('dominant-baseline', 'central')
  label.removeAttribute('transform')
  for (const span of Array.from(label.querySelectorAll('tspan'))) {
    span.setAttribute('dy', '0')
    span.setAttribute('x', textX)
  }
  man.replaceChildren(rect, icon, label)
  man.removeAttribute('style')
  return man.getAttribute('name')
}

/**
 * Sequence actors are stick figures, which look out of place beside the participant boxes. Each is
 * redrawn as a participant box with a person icon, its lifeline starting at the box. The svg joins
 * the page while labels are measured, so its stylesheet sets their font.
 */
export function boxActors(root: Element): void {
  const rect = root.querySelector('rect.actor-top')
  const box = {
    y: Number(rect?.getAttribute('y') ?? 0),
    height: Number(rect?.getAttribute('height') ?? 65),
    width: Number(rect?.getAttribute('width') ?? 150),
    rx: Number(rect?.getAttribute('rx') ?? 3),
  }
  const men = Array.from(root.querySelectorAll('g.actor-man'))
  const host = men.length && typeof document !== 'undefined' && !root.isConnected ? document.body : null
  host?.appendChild(root)
  for (const man of men) {
    const name = personActor({ man, box })
    const lines = Array.from(root.querySelectorAll('line.actor-line'))
    for (const line of lines.filter((l) => name && l.getAttribute('name') === name))
      line.setAttribute('y1', String(box.y + box.height))
  }
  host?.removeChild(root)
}

/**
 * Ends sequence lifelines at the bottom of the drawing. Without mirrored actors Mermaid draws them
 * 2000 units long, so they ran through the bottom padding and the diagram looked cropped.
 */
export function endLifelines(root: Element): void {
  const box = viewBoxOf(root)
  if (!box) return
  for (const line of Array.from(root.querySelectorAll('line.actor-line')))
    if (Number(line.getAttribute('y2')) > box[1] + box[3])
      line.setAttribute('y2', String(box[1] + box[3]))
}

/** Gives an svg Mermaid left unstyled the fallback stylesheet, scoped to its id. */
export function styleUnstyled({ root, css }: { root: Element; css: string }): void {
  if (!css || root.querySelector('style')) return
  const style = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = css.replaceAll('#ID', `#${root.getAttribute('id') ?? ''}`)
  root.insertBefore(style, root.firstChild)
}

/** The svg's viewBox as numbers, or null when it has none worth drawing. */
export function viewBoxOf(root: Element): number[] | null {
  const box = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  if (box.length !== 4 || !(box[2] > 0 && box[3] > 0)) return null
  return box
}

/** Grows the viewBox by `padding` on every side and paints the canvas behind everything. */
export function frame({
  root,
  options,
}: {
  root: Element
  options: PostprocessOptions
}): number[] | null {
  const box = viewBoxOf(root)
  if (!box) return null
  const p = options.padding
  const padded = [box[0] - p, box[1] - p, box[2] + 2 * p, box[3] + 2 * p]
  root.setAttribute('viewBox', padded.map((n) => +n.toFixed(2)).join(' '))
  if (options.background) {
    const rect = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(padded[0]))
    rect.setAttribute('y', String(padded[1]))
    rect.setAttribute('width', String(padded[2]))
    rect.setAttribute('height', String(padded[3]))
    rect.setAttribute('fill', options.background)
    rect.setAttribute('class', 'mm-canvas')
    const first = Array.from(root.children).find((c) => !['style', 'defs'].includes(c.localName))
    root.insertBefore(rect, first ?? null)
  }
  return padded
}

/**
 * Fixes up Mermaid's svg markup in place and gives it a fixed intrinsic size from its viewBox, so it
 * behaves as an image. Returns null when Mermaid drew nothing.
 */
export function finish({
  root,
  options,
}: {
  root: Element
  options: PostprocessOptions
}): { width: number; height: number } | null {
  dropHtmlFallbacks(root)
  boxActors(root)
  endLifelines(root)
  styleUnstyled({ root, css: options.fallbackCss })
  capTreemap({ root, fontSize: options.fontSize })
  centerLabels({ root, fontSize: options.fontSize })
  const scale = typeScale({ root, fontSize: options.fontSize })
  const box = frame({ root, options })
  if (!box) return null
  const width = Math.round(box[2] * scale)
  const height = Math.round(box[3] * scale)
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  const style = (root.getAttribute('style') ?? '').replace(/max-width:\s*[^;]+;?/g, '').trim()
  if (style) root.setAttribute('style', style)
  else root.removeAttribute('style')
  return { width, height }
}

/** Parses Mermaid's svg string, post-processes it and serializes it again. */
export function postprocess({
  svg,
  options,
}: {
  svg: string
  options: PostprocessOptions
}): Sized | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  if (root.localName !== 'svg') return null
  const size = finish({ root, options })
  if (!size) return null
  return { svg: new XMLSerializer().serializeToString(root), ...size }
}

const STEPS = [
  centerLabels,
  typeScale,
  fontSizeOf,
  resize,
  capTreemap,
  dropHtmlFallbacks,
  labelWidth,
  personActor,
  boxActors,
  endLifelines,
  styleUnstyled,
  viewBoxOf,
  frame,
  finish,
  postprocess,
]

/**
 * The steps as a script for a page: defines them all and `window.__mmPostprocess`. A no-op
 * `__name` comes first, since tsx's transform wraps named functions in calls to it.
 */
export const POSTPROCESS_SCRIPT = [
  'var __name = window.__name || function (f) { return f };',
  `var PERSON_ICON = ${JSON.stringify(PERSON_ICON)};`,
  ...STEPS.map(String),
  'window.__mmPostprocess = postprocess;',
].join('\n')
