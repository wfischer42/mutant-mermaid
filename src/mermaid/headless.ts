/**
 * Mermaid rendering in Node, through headless Chromium (playwright). One browser is launched on
 * first use and kept, with a few pages that each have Mermaid, our fonts and our post-processing
 * loaded, so a batch pays the start-up cost once. Call `closeHeadless()` when done.
 */
import { createRequire } from 'node:module'
import type { Browser, BrowserContext, Page } from 'playwright'
import { fontFaceCss } from '../fonts.ts'
import type { Tokens } from '../theme/index.ts'
import {
  type MermaidRenderOptions,
  type MermaidResult,
  mermaidTokens,
  postprocessOptions,
} from './browser.ts'
import { explainMermaidError } from './keywords.ts'
import { POSTPROCESS_SCRIPT, type PostprocessOptions, type Sized } from './postprocess.ts'
import { mermaidConfig } from './theme.ts'

export type { MermaidRendered, MermaidRenderOptions, MermaidResult } from './browser.ts'

/** What the headless page's script tags define. */
interface PageMermaid {
  initialize(config: unknown): void
  render(id: string, source: string): Promise<{ svg: string }>
}

declare global {
  interface Window {
    mermaid?: PageMermaid
    __mmPostprocess?: (input: { svg: string; options: PostprocessOptions }) => Sized | null
  }
}

const require = createRequire(import.meta.url)

/** How many pages render side by side; Mermaid's state is per page, so they don't interfere. */
const PAGES = 4

interface Pool {
  browser: Browser
  context: BrowserContext
  pages: { page: Page; chain: Promise<unknown> }[]
  next: number
}

let pool: Promise<Pool> | null = null
let fonts: string | null = null
let counter = 0

async function preparePage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  fonts ??= fontFaceCss()
  await page.setContent(
    `<!doctype html><html><head><style>${fonts}</style></head><body></body></html>`,
  )
  await page.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') })
  await page.addScriptTag({ content: POSTPROCESS_SCRIPT })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return page
}

async function launch(): Promise<Pool> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addInitScript('window.__name = function (f) { return f }')
  const pages = await Promise.all(
    Array.from({ length: PAGES }, async () => ({
      page: await preparePage(context),
      chain: Promise.resolve(),
    })),
  )
  return { browser, context, pages, next: 0 }
}

interface PageJob {
  id: string
  source: string
  config: unknown
  key: string
  options: PostprocessOptions
}

/**
 * Runs inside the page: (re)initializes Mermaid when the theme changed, renders and
 * post-processes. Must reference only page globals, since playwright ships it as source.
 */
async function renderInPage(job: PageJob): Promise<Sized | { error: string } | null> {
  const mermaid = window.mermaid
  const post = window.__mmPostprocess
  if (!(mermaid && post)) return { error: 'Mermaid did not load in the headless page.' }
  const root = document.documentElement
  if (root.dataset.mmConfig !== job.key) {
    mermaid.initialize(job.config)
    root.dataset.mmConfig = job.key
  }
  try {
    const { svg } = await mermaid.render(job.id, job.source)
    return post({ svg, options: job.options })
  } catch (e) {
    document.getElementById(job.id)?.remove()
    document.getElementById(`d${job.id}`)?.remove()
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

const keys = new WeakMap<Tokens, { config: unknown; key: string }>()

/** The config for tokens and a short key that changes whenever the config does. */
function configFor(tokens: Tokens): { config: unknown; key: string } {
  const known = keys.get(tokens)
  if (known) return known
  const config = mermaidConfig(tokens)
  const text = JSON.stringify(config)
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0
  const made = { config, key: `${text.length}-${hash >>> 0}` }
  keys.set(tokens, made)
  return made
}

/**
 * Renders Mermaid source to SVG headlessly, with our theme. Never throws for a bad source: it comes
 * back as `{ error }`, in words that say what to fix.
 */
export async function renderMermaidHeadless(options: MermaidRenderOptions): Promise<MermaidResult> {
  pool ??= launch()
  const ready = await pool
  const slot = ready.pages[ready.next++ % ready.pages.length]
  const tokens = mermaidTokens(options)
  const { config, key } = configFor(tokens)
  const job: PageJob = {
    id: `mm-mermaid-${++counter}`,
    source: options.source,
    config,
    key,
    options: postprocessOptions({ ...options, tokens }),
  }
  const run = slot.chain.then(() => slot.page.evaluate(renderInPage, job))
  slot.chain = run.catch(() => undefined)
  const result = await run
  if (!result) return { error: 'Mermaid rendered an empty diagram.' }
  if ('error' in result)
    return { error: explainMermaidError({ source: options.source, message: result.error }) }
  return result
}

/**
 * Rasterizes an SVG to PNG in Chromium, which draws everything Mermaid can emit (CSS selectors,
 * foreignObject labels) exactly as a browser shows it.
 */
export async function rasterizeHeadless({
  svg,
  scale = 2,
}: {
  svg: string
  scale?: number
}): Promise<Buffer> {
  pool ??= launch()
  const { browser } = await pool
  fonts ??= fontFaceCss()
  const context = await browser.newContext({ deviceScaleFactor: scale })
  try {
    const page = await context.newPage()
    await page.setContent(
      `<!doctype html><html><head><style>${fonts} body { margin: 0 } svg { display: block }</style></head><body>${svg}</body></html>`,
    )
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    return await page.locator('svg').first().screenshot({ omitBackground: true })
  } finally {
    await context.close()
  }
}

/** Closes the headless browser; the next render launches a new one. */
export async function closeHeadless(): Promise<void> {
  const open = pool
  pool = null
  if (open) await (await open).browser.close()
}
