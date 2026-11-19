/**
 * Mermaid rendering in the browser, with our theme. Mermaid is imported lazily, so a page that
 * never draws a Mermaid diagram never loads it.
 */
import { resolveTheme, type ThemeInput, type Tokens } from '../theme/index.ts'
import { explainMermaidError } from './keywords.ts'
import { type PostprocessOptions, postprocess } from './postprocess.ts'
import { fallbackCSS, MERMAID_FONT_SIZE, mermaidConfig } from './theme.ts'

export interface MermaidRendered {
  svg: string
  width: number
  height: number
}

export type MermaidResult = MermaidRendered | { error: string }

export interface MermaidRenderOptions {
  source: string
  /** Resolved tokens; when left out, they're made from `theme` and `dark`. */
  tokens?: Tokens
  /** A preset name or a spec, such as one from `themeFromColors`, as `render` takes. */
  theme?: ThemeInput
  dark?: boolean
  /** Paint the theme's canvas behind the diagram (default true). */
  background?: boolean
  /** Space around the diagram, in px (default 16). */
  padding?: number
}

type Mermaid = typeof import('mermaid')['default']

let loaded: Promise<Mermaid> | null = null
/** The tokens Mermaid was last initialized with, and their config as text. */
let themed: { tokens: Tokens; key: string } | null = null
/** Mermaid renders through shared DOM scratch space, so renders run one at a time. */
let queue: Promise<unknown> = Promise.resolve()
let counter = 0

/**
 * Loads Mermaid and initializes it for tokens. Equal tokens made afresh (as `resolveTheme` does)
 * don't re-initialize it: only a change in the resulting config does.
 */
async function load(tokens: Tokens): Promise<Mermaid> {
  loaded ??= import('mermaid').then((module) => module.default)
  const mermaid = await loaded
  if (themed?.tokens === tokens) return mermaid
  const config = mermaidConfig(tokens)
  const key = JSON.stringify(config)
  if (themed?.key !== key) mermaid.initialize(config)
  themed = { tokens, key }
  return mermaid
}

/** The tokens a Mermaid render uses: the ones given, or ones made from its theme. */
export function mermaidTokens({ tokens, theme, dark }: MermaidRenderOptions): Tokens {
  return tokens ?? resolveTheme({ theme, dark })
}

export function postprocessOptions({
  tokens,
  background = true,
  padding = 16,
}: {
  tokens: Tokens
  background?: boolean
  padding?: number
}): PostprocessOptions {
  return {
    background: background ? tokens.bg : null,
    padding,
    fontSize: MERMAID_FONT_SIZE,
    fallbackCss: fallbackCSS(tokens),
  }
}

/** Removes the scratch element Mermaid leaves in the body when a render fails. */
function cleanUp(id: string): void {
  if (typeof document === 'undefined') return
  document.getElementById(id)?.remove()
  document.getElementById(`d${id}`)?.remove()
}

/**
 * Renders Mermaid source with our theme. Never throws: a source Mermaid can't draw comes back as
 * `{ error }`, in words that say what to fix.
 */
export function renderMermaid(options: MermaidRenderOptions): Promise<MermaidResult> {
  const { source } = options
  const tokens = mermaidTokens(options)
  const id = `mm-mermaid-${++counter}`
  const job = queue.then(async () => {
    const mermaid = await load(tokens)
    const { svg } = await mermaid.render(id, source)
    return postprocess({ svg, options: postprocessOptions({ ...options, tokens }) })
  })
  queue = job.catch(() => undefined)
  return job.then(
    (sized) => sized ?? { error: 'Mermaid rendered an empty diagram.' },
    (e: unknown) => {
      cleanUp(id)
      const message = e instanceof Error ? e.message : String(e)
      return { error: explainMermaidError({ source, message }) }
    },
  )
}
