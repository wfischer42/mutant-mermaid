import '@fontsource/nunito/400.css'
import '@fontsource/nunito/500.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/source-sans-3/400.css'
import '@fontsource/source-sans-3/500.css'
import '@fontsource/source-sans-3/600.css'
import '@fontsource/source-sans-3/700.css'
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/500.css'
import '@fontsource/figtree/600.css'
import '@fontsource/figtree/700.css'
import {
  detect,
  FONT_IDS,
  FONTS,
  type FontId,
  keywordOf,
  type Look,
  PRESETS,
  parseFont,
  parseLook,
  resolveTheme,
  SCHEMES,
  type ThemeInput,
  type Tokens,
} from '../src/index.ts'
import { type Rendered, renderAny } from './engines.ts'
import { wireHooks } from './hooks.ts'

const sources = import.meta.glob<string>('../examples/**/*.mmd', {
  query: '?raw',
  import: 'default',
  eager: true,
})

interface Example {
  id: string
  family: string
  name: string
  source: string
}

const FAMILIES: Record<string, { title: string; lede: string }> = {
  templates: {
    title: 'Template scenes',
    lede: 'Pyramids, cycles, layer stacks, matrices and canvases: the shapes an explanation reaches for, filled from a few lines of text.',
  },
  mindmap: {
    title: 'Mind maps & reasoning',
    lede: 'Mind maps of linked cards, concept-map cross-links, argument maps and issue trees.',
  },
  systems: {
    title: 'Systems',
    lede: 'Causal loop diagrams with detected reinforcing and balancing loops, and stock & flow models.',
  },
  timeline: {
    title: 'Timelines',
    lede: 'From deep time to this quarter: real dates, eras, lanes and log scales, plus Mermaid timelines drawn better.',
  },
  flow: {
    title: 'Flowcharts & state',
    lede: 'Mermaid flowchart and state syntax, laid out with ELK and drawn by our renderer. Compare against Mermaid side by side.',
  },
  wireframe: {
    title: 'Wireframes',
    lede: 'Low-fidelity screens in a phone, tablet or browser frame, from nested rows, columns and widgets.',
  },
  mermaid: {
    title: 'Mermaid, themed',
    lede: 'Every Mermaid diagram type rendered by Mermaid itself with the same theme tokens.',
  },
}

const ORDER = Object.keys(FAMILIES)

const examples: Example[] = Object.entries(sources)
  .map(([path, source]) => {
    const [, family, name] = /examples\/([^/]+)\/(.+)\.mmd$/.exec(path) ?? ['', 'misc', path]
    return { id: `${family}/${name}`, family, name, source }
  })
  .sort((a, b) => ORDER.indexOf(a.family) - ORDER.indexOf(b.family) || a.name.localeCompare(b.name))

/** Syntaxes Mermaid also draws, so the gallery can show both side by side. */
const COMPARABLE = new Set([
  'flowchart',
  'graph',
  'statediagram',
  'statediagram-v2',
  'mindmap',
  'timeline',
])

function comparable(source: string): boolean {
  if (!COMPARABLE.has(keywordOf(source)) || !detect(source)) return false
  return !source.trim().split('\n')[0].includes('"')
}

interface State {
  view: 'gallery' | 'play'
  family: string
  theme: string
  dark: boolean
  look: Look | ''
  /** Body and heading fonts; '' keeps the theme's own. */
  font: FontId | ''
  headingFont: FontId | ''
  compare: Set<string>
  draft: string
}

function asLook(value: string): Look | '' {
  return parseLook(value) ?? ''
}

function asFont(value: string): FontId | '' {
  return parseFont(value) ?? ''
}

function readSaved(): Partial<State> {
  try {
    return JSON.parse(localStorage.getItem('mm-gallery') ?? '{}')
  } catch {
    return {}
  }
}

function readState(): State {
  const params = new URLSearchParams(location.hash.slice(1))
  const saved = readSaved()
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches
  return {
    view: params.get('view') === 'play' ? 'play' : 'gallery',
    family: params.get('family') ?? 'all',
    theme: params.get('theme') ?? saved.theme ?? 'meadow',
    dark: (params.get('dark') ?? String(saved.dark ?? systemDark)) === 'true',
    look: asLook(params.get('look') ?? saved.look ?? ''),
    font: asFont(params.get('font') ?? saved.font ?? ''),
    headingFont: asFont(params.get('heading') ?? saved.headingFont ?? ''),
    compare: new Set(),
    draft: saved.draft ?? examples[0]?.source ?? '',
  }
}

const state = readState()

function save(): void {
  const params = new URLSearchParams({
    view: state.view,
    family: state.family,
    theme: state.theme,
    dark: String(state.dark),
  })
  if (state.look) params.set('look', state.look)
  if (state.font) params.set('font', state.font)
  if (state.headingFont) params.set('heading', state.headingFont)
  history.replaceState(null, '', `#${params}`)
  try {
    localStorage.setItem(
      'mm-gallery',
      JSON.stringify({
        theme: state.theme,
        dark: state.dark,
        look: state.look,
        font: state.font,
        headingFont: state.headingFont,
        draft: state.draft,
      }),
    )
  } catch {
    return
  }
}

/** The chosen preset with any font picks laid over it. */
function theme(): ThemeInput {
  if (!state.font && !state.headingFont) return state.theme
  return {
    name: state.theme,
    ...(state.font && { font: state.font }),
    ...(state.headingFont && { headingFont: state.headingFont }),
  }
}

function tokens(): Tokens {
  return resolveTheme({ theme: theme(), dark: state.dark })
}

/** Paints the page chrome in the current theme's neutrals so diagrams sit on their own canvas. */
function applyChrome(): void {
  const t = tokens()
  const root = document.documentElement
  root.dataset.dark = String(state.dark)
  const vars = {
    bg: t.bg,
    surface: t.surface,
    sunken: t.sunken,
    border: t.border,
    fg: t.fg,
    muted: t.muted,
    faint: t.faint,
    accent: t.accent.strong,
    font: t.font.family,
  }
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(`--${key}`, value)
}

let scopeCount = 0
/** Prefixes ids in an SVG so several inline diagrams don't share filters or gradients. */
function scoped(svg: string): string {
  const prefix = `d${++scopeCount}-`
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
  let out = svg
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out
      .replace(new RegExp(`id="${safe}"`, 'g'), `id="${prefix}${id}"`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), `url(#${prefix}${id})`)
      .replace(new RegExp(`href="#${safe}"`, 'g'), `href="#${prefix}${id}"`)
  }
  return out
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function figure(result: Rendered): string {
  if ('error' in result) return `<div class="error">${escapeHtml(result.error)}</div>`
  return `<div class="figure">${result.engine === 'ours' ? scoped(result.svg) : result.svg}</div>`
}

/**
 * Keeps the `data-sticky` parts of a scrolling diagram (a long timeline's lane names) at the edge
 * of the view as it scrolls.
 */
function pinSticky(root: ParentNode): void {
  for (const box of root.querySelectorAll<HTMLElement>('.figure')) {
    const svg = box.querySelector<SVGSVGElement>(':scope > svg[data-scroll]')
    const parts = svg ? [...svg.querySelectorAll<SVGGElement>('[data-sticky]')] : []
    if (!svg || !parts.length) continue
    box.onscroll = () => {
      const view = box.getBoundingClientRect()
      const page = svg.getBoundingClientRect()
      const scale = page.width / svg.viewBox.baseVal.width || 1
      const dx = Math.max(0, view.left - page.left) / scale
      const dy = Math.max(0, view.top - page.top) / scale
      for (const part of parts) {
        const left = part.dataset.sticky === 'left'
        part.setAttribute('transform', left ? `translate(${dx} 0)` : `translate(0 ${dy})`)
      }
    }
  }
}

function options() {
  return { theme: theme(), dark: state.dark, look: state.look || undefined }
}

function familyLink({
  family,
  title,
  count,
}: {
  family: string
  title: string
  count: number
}): string {
  return `<a href="#" data-family="${family}" class="${state.family === family ? 'on' : ''}">${title}<span>${count}</span></a>`
}

function renderSidebar(): void {
  const aside = document.getElementById('families')
  if (!aside) return
  const counts = new Map<string, number>()
  for (const e of examples) counts.set(e.family, (counts.get(e.family) ?? 0) + 1)
  aside.innerHTML =
    `<h3>Examples</h3>${familyLink({ family: 'all', title: 'Everything', count: examples.length })}` +
    ORDER.filter((f) => counts.has(f))
      .map((f) => familyLink({ family: f, title: FAMILIES[f].title, count: counts.get(f) ?? 0 }))
      .join('')
  for (const a of aside.querySelectorAll<HTMLAnchorElement>('a[data-family]'))
    a.onclick = (event) => {
      event.preventDefault()
      state.family = a.dataset.family ?? 'all'
      state.view = 'gallery'
      update()
    }
}

let generation = 0

function exampleCard(example: Example): HTMLElement {
  const card = document.createElement('section')
  card.className = 'card'
  const compare = comparable(example.source) ? '<button data-act="compare">vs Mermaid</button>' : ''
  card.innerHTML =
    `<header><b>${escapeHtml(example.name.replace(/[-_]/g, ' '))}</b>` +
    `<span class="kind">${escapeHtml(keywordOf(example.source))}</span><span class="grow"></span>` +
    `${compare}<button data-act="source">source</button><button data-act="edit">edit</button></header>` +
    `<div class="body"><div class="figure"></div></div>`
  return card
}

/** Diagrams wider than this get a full-width card, so they aren't shrunk past reading. */
const WIDE = 680

async function drawCard({
  card,
  example,
  run,
}: {
  card: HTMLElement
  example: Example
  run: number
}): Promise<void> {
  const body = card.querySelector('.body')
  if (!body) return
  const ours = await renderAny(example.source, options())
  if (run !== generation) return
  const comparing = state.compare.has(example.id)
  card.classList.toggle('wide', comparing || ('width' in ours && ours.width > WIDE))
  if (!comparing) {
    body.innerHTML = figure(ours)
    pinSticky(body)
    return
  }
  const theirs = await renderAny(example.source, { ...options(), engine: 'mermaid' })
  body.innerHTML =
    `<div class="pair"><div><div class="tag">Mutant Mermaid</div>${figure(ours)}</div>` +
    `<div><div class="tag">Mermaid (themed)</div>${figure(theirs)}</div></div>`
  pinSticky(body)
}

async function renderGallery(main: HTMLElement): Promise<void> {
  const run = ++generation
  const shown = examples.filter((e) => state.family === 'all' || e.family === state.family)
  const info = FAMILIES[state.family]
  const lede = info?.lede ?? `${examples.length} examples. Pick a theme and toggle dark mode above.`
  main.innerHTML = `<h1>${info?.title ?? 'Everything'}</h1><p class="lede">${lede}</p><div class="grid"></div>`
  const grid = main.querySelector('.grid')
  if (!grid) return
  for (const example of shown) {
    const card = exampleCard(example)
    grid.append(card)
    card.querySelector<HTMLButtonElement>('[data-act="compare"]')?.addEventListener('click', () => {
      if (state.compare.has(example.id)) state.compare.delete(example.id)
      else state.compare.add(example.id)
      drawCard({ card, example, run: generation })
    })
    card.querySelector<HTMLButtonElement>('[data-act="source"]')?.addEventListener('click', () => {
      const pre = card.querySelector('pre.source')
      if (pre) pre.remove()
      else
        card.insertAdjacentHTML(
          'beforeend',
          `<pre class="source">${escapeHtml(example.source)}</pre>`,
        )
    })
    card.querySelector<HTMLButtonElement>('[data-act="edit"]')?.addEventListener('click', () => {
      state.draft = example.source
      state.view = 'play'
      update()
    })
    await drawCard({ card, example, run })
  }
}

function renderPlayground(main: HTMLElement): void {
  const starters = ORDER.map((f) => examples.find((e) => e.family === f)).filter(
    (e) => e !== undefined,
  )
  main.innerHTML =
    `<div class="pick">${starters.map((e) => `<button data-id="${e.id}">${escapeHtml(FAMILIES[e.family]?.title ?? e.family)}</button>`).join('')}</div>` +
    `<div class="play"><textarea spellcheck="false"></textarea><div class="out"></div></div>`
  const area = main.querySelector('textarea')
  const out = main.querySelector<HTMLElement>('.out')
  if (!area || !out) return
  area.value = state.draft
  let timer = 0
  const draw = async () => {
    state.draft = area.value
    save()
    out.innerHTML = figure(await renderAny(area.value, options()))
    pinSticky(out)
  }
  area.oninput = () => {
    clearTimeout(timer)
    timer = window.setTimeout(draw, 180)
  }
  area.onkeydown = (event) => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end')
    area.dispatchEvent(new Event('input'))
  }
  for (const button of main.querySelectorAll<HTMLButtonElement>('.pick button'))
    button.onclick = () => {
      area.value = examples.find((e) => e.id === button.dataset.id)?.source ?? ''
      draw()
    }
  draw()
}

function update(): void {
  save()
  applyChrome()
  renderSidebar()
  for (const button of document.querySelectorAll<HTMLButtonElement>('.views button'))
    button.classList.toggle('on', button.dataset.view === state.view)
  const main = document.getElementById('main')
  if (!main) return
  if (state.view === 'play') renderPlayground(main)
  else renderGallery(main)
}

/** Our presets, then the borrowed editor schemes, as option groups. */
function themeOptions(): string {
  const option = (name: string) =>
    `<option ${name === state.theme ? 'selected' : ''}>${name}</option>`
  const ours = Object.keys(PRESETS).filter((name) => !(name in SCHEMES))
  return (
    `<optgroup label="Mutant Mermaid">${ours.map(option).join('')}</optgroup>` +
    `<optgroup label="Editor palettes">${Object.keys(SCHEMES).map(option).join('')}</optgroup>`
  )
}

/** Every bundled font, after a first option that keeps the theme's (or the body font's) own. */
function fontOptions({ current, empty }: { current: FontId | ''; empty: string }): string {
  const option = (id: FontId) =>
    `<option value="${id}" ${id === current ? 'selected' : ''}>${FONTS[id].label}</option>`
  return `<option value="">${empty}</option>${FONT_IDS.map(option).join('')}`
}

function setupFonts(): void {
  const font = document.querySelector<HTMLSelectElement>('#font')
  const heading = document.querySelector<HTMLSelectElement>('#heading-font')
  if (!font || !heading) return
  font.innerHTML = fontOptions({ current: state.font, empty: 'theme' })
  heading.innerHTML = fontOptions({ current: state.headingFont, empty: 'same as body' })
  font.onchange = () => {
    state.font = asFont(font.value)
    update()
  }
  heading.onchange = () => {
    state.headingFont = asFont(heading.value)
    update()
  }
}

function setupControls(): void {
  const theme = document.querySelector<HTMLSelectElement>('#theme')
  const look = document.querySelector<HTMLSelectElement>('#look')
  const dark = document.querySelector<HTMLButtonElement>('#dark')
  if (!theme || !look || !dark) return
  theme.innerHTML = themeOptions()
  look.value = state.look
  theme.onchange = () => {
    state.theme = theme.value
    state.dark = PRESETS[theme.value]?.dark ?? state.dark
    update()
  }
  look.onchange = () => {
    state.look = asLook(look.value)
    update()
  }
  dark.onclick = () => {
    state.dark = !state.dark
    update()
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.views button'))
    button.onclick = () => {
      state.view = button.dataset.view === 'play' ? 'play' : 'gallery'
      update()
    }
}

setupControls()
setupFonts()
const main = document.getElementById('main')
if (main) wireHooks(main)
update()
