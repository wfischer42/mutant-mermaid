/**
 * Mermaid rendering in Node with no browser: Mermaid runs against a jsdom document whose SVG
 * elements measure themselves from our font tables (see `./bbox.ts`). Its output draws with resvg,
 * like our own diagrams.
 *
 * Loading this module puts `window`, `document` and the DOM classes on the global object, since
 * Mermaid and DOMPurify look for them there.
 */
import { JSDOM } from 'jsdom'
import { type TextKit, textKit } from '../core/text.ts'
import type { Tokens } from '../theme/index.ts'
import { bboxOf, screenBoxOf, textLength } from './bbox.ts'
import {
  type MermaidRenderOptions,
  type MermaidResult,
  mermaidTokens,
  renderMermaid,
} from './browser.ts'
import { architectureIcons, architecturePack, drawLabelIcons } from './icons.ts'
import { inlineStyles } from './inline.ts'
import { MERMAID_FONT_SIZE } from './theme.ts'

export type { MermaidRendered, MermaidRenderOptions, MermaidResult } from './browser.ts'

/** The screen a headless browser reports; C4 wraps its boundaries at this width. */
const SCREEN_WIDTH = 1280

/** The width a block element reports: that screen less the body's margins. */
const PAGE_WIDTH = SCREEN_WIDTH - 16

const GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'SVGElement',
  'Text',
  'DOMParser',
  'XMLSerializer',
  'MutationObserver',
  'CSSStyleSheet',
  'CSSStyleRule',
  'getComputedStyle',
  'screen',
]

let kit: TextKit = textKit({ font: 'nunito', family: 'Nunito' })
let installed = false

function method(fn: (this: Element) => unknown): PropertyDescriptor {
  return { configurable: true, writable: true, value: fn }
}

function rect({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }
}

function install(): void {
  if (installed) return
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
  })
  for (const key of GLOBALS)
    Object.defineProperty(globalThis, key, { configurable: true, value: Reflect.get(window, key) })
  const fallback = MERMAID_FONT_SIZE
  Object.defineProperties(window.SVGElement.prototype, {
    getBBox: method(function () {
      return rect(bboxOf({ el: this, kit, fallback }))
    }),
    getComputedTextLength: method(function () {
      return textLength({ el: this, kit, fallback })
    }),
    getBoundingClientRect: method(function () {
      return rect(screenBoxOf({ el: this, kit, fallback }))
    }),
  })
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', method(canvasContext))
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => PAGE_WIDTH,
  })
  Object.defineProperty(window.screen, 'availWidth', { configurable: true, get: () => SCREEN_WIDTH })
  installed = true
}

/**
 * A 2D canvas context that measures text from our tables and ignores drawing calls. Cytoscape,
 * which lays out mindmaps and architecture diagrams, makes one even when it draws nothing.
 */
function canvasContext(): object {
  const state = { font: '14px sans-serif' }
  const measureText = (text: string) => {
    const size = Number.parseFloat(/([\d.]+)px/.exec(state.font)?.[1] ?? '') || MERMAID_FONT_SIZE
    const weight = /\bbold\b|\b[6-9]00\b/.test(state.font) ? 700 : 400
    const width = kit.width(text, { size, weight })
    const ascent = size * kit.metrics.ascent
    const descent = -size * kit.metrics.descent
    return { width, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent }
  }
  return new Proxy(state, {
    get: (target, key) => {
      if (key === 'measureText') return measureText
      if (key in target) return Reflect.get(target, key)
      return () => undefined
    },
  })
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** An HTML label as SVG text: wrapped to its box and centered in it, bold when the HTML is. */
function labelText(box: Element): Element {
  const doc = box.ownerDocument
  const size = MERMAID_FONT_SIZE
  const weight = box.querySelector('b, strong') ? 700 : 400
  const width = Number(box.getAttribute('width')) || 0
  const lines = kit.wrap((box.textContent ?? '').trim(), { size, weight, max: width })
  const step = kit.lineHeight({ size })
  const cx = (Number(box.getAttribute('x')) || 0) + width / 2
  const cy = (Number(box.getAttribute('y')) || 0) + (Number(box.getAttribute('height')) || 0) / 2
  const first = cy - ((lines.length - 1) * step) / 2 + kit.baselineShift({ size })
  const text = doc.createElementNS(SVG_NS, 'text')
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('style', `font-size:${size}px;font-weight:${weight}`)
  lines.forEach((line, i) => {
    const span = doc.createElementNS(SVG_NS, 'tspan')
    span.setAttribute('x', String(cx))
    span.setAttribute('y', (first + i * step).toFixed(2))
    span.textContent = line
    text.appendChild(span)
  })
  return text
}

/**
 * Replaces the HTML labels some diagrams (event modeling) draw in a foreignObject with SVG text,
 * which resvg and image viewers can draw.
 */
export function flattenLabels(svg: string): string {
  if (!svg.includes('<foreignObject')) return svg
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  for (const box of Array.from(root.querySelectorAll('foreignObject')))
    box.replaceWith(labelText(box))
  return new XMLSerializer().serializeToString(root)
}

let queue: Promise<unknown> = Promise.resolve()

function measureWith(tokens: Tokens): void {
  if (kit.family === tokens.font.family) return
  kit = textKit({ font: tokens.font.id, family: tokens.font.family, heading: tokens.font.heading.id })
}

/**
 * Renders Mermaid source to SVG with our theme, in Node with no browser. Never throws for a bad
 * source: it comes back as `{ error }`, in words that say what to fix.
 */
export function renderMermaidJsdom(options: MermaidRenderOptions): Promise<MermaidResult> {
  install()
  const tokens = mermaidTokens(options)
  const job = queue.then(async () => {
    measureWith(tokens)
    const { source, names } = architectureIcons(options.source)
    if (names.length) {
      const { default: mermaid } = await import('mermaid')
      mermaid.registerIconPacks([architecturePack({ names, tokens })])
    }
    const result = await renderMermaid({ ...options, source, tokens })
    if ('error' in result) return result
    return { ...result, svg: drawLabelIcons({ svg: flattenLabels(result.svg), kit }) }
  })
  queue = job.catch(() => undefined)
  return job
}

/** Rasterizes a Mermaid SVG with resvg, its stylesheet first resolved onto each element. */
export async function rasterizeJsdom({ svg, scale = 2 }: { svg: string; scale?: number }): Promise<Buffer> {
  install()
  const { svgToPng } = await import('../node.ts')
  return svgToPng(inlineStyles(svg), { scale })
}
