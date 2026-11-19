import { type Look, parseLook, resolveTheme, type ThemeInput } from '../theme/index.ts'
import { applyHooks, extractHooks, HOOK_CSS } from './hooks.ts'
import { grainLayer, lookDefs } from './look.ts'
import { type Diagnostic, frontmatter, readLines } from './parse.ts'
import { span } from './profile.ts'
import { hash, rng } from './rng.ts'
import { svgDocument } from './svg.ts'
import { iconDiagnostics, placeIcons } from './icons.ts'
import { textKit } from './text.ts'
import { type Context, DiagramError, type Registered, type RenderResult } from './types.ts'

export type { Registered } from './types.ts'

const TYPES = new Map<string, Registered>()
const BY_KEYWORD = new Map<string, Registered>()

/** Adds a diagram type (made with `define`); its keywords select it from a source's first word. */
export function register(entry: Registered): void {
  TYPES.set(entry.id, entry)
  for (const keyword of entry.keywords) BY_KEYWORD.set(keyword.toLowerCase(), entry)
}

export function diagramTypes(): Registered[] {
  return [...TYPES.values()]
}

/** The first word of the first line that isn't blank, a comment or frontmatter. */
export function keywordOf(source: string): string {
  const [first] = readLines(frontmatter(source).body)
  return first?.text.split(/[\s:{]/)[0].toLowerCase() ?? ''
}

/** The registered type a source selects, or null when it's for Mermaid or unknown. */
export function detect(source: string): Registered | null {
  return BY_KEYWORD.get(keywordOf(source)) ?? null
}

export interface RenderOptions {
  theme?: ThemeInput
  dark?: boolean
  look?: Look
  /** Changes the hand-made variation without changing the source. */
  seed?: number
  /** Leave the canvas transparent instead of painting the theme's background. */
  transparent?: boolean
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map((d) => `line ${d.line}: ${d.message}`).join('\n')
}

/**
 * Renders a source written in one of the registered languages to an SVG string. Frontmatter
 * (`theme`, `dark`, `look`, `seed`) overrides the options. Throws a DiagramError whose message
 * says what to fix, with line numbers.
 */
export async function render(source: string, options: RenderOptions = {}): Promise<RenderResult> {
  const type = detect(source)
  if (!type) throw unknownType(source)
  const { values, body: raw } = frontmatter(source)
  const { body, drawn, hooks } = extractHooks(raw)
  const { draw, diagnostics } = span('parse', () => type.run(body))
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (!draw || errors.length)
    throw new DiagramError({
      message: `Couldn't read the ${type.title.toLowerCase()}:\n${formatDiagnostics(errors.length ? errors : diagnostics)}`,
      diagnostics,
    })
  const { ctx, seed } = contextFor({ values, options, body: drawn })
  const { tokens } = ctx
  const drawing = await span('draw', () => draw(ctx))
  const width = Math.ceil(drawing.width)
  const height = Math.ceil(drawing.height)
  const organic = tokens.look === 'sketch' && !options.transparent
  const wrapped = svgDocument({
    width,
    height,
    kind: type.id,
    scroll: drawing.scroll,
    family: tokens.font.family,
    heading: tokens.font.heading.family,
    title: drawing.title,
    background: options.transparent ? undefined : tokens.bg,
    defs: lookDefs({ tokens, seed }) + (drawing.defs ?? ''),
    css: (drawing.css ?? '') + (hooks.size ? HOOK_CSS : ''),
    body: placeIcons({ body: drawing.body, kit: ctx.text }) + (organic ? grainLayer({ width, height }) : ''),
  })
  const hooked = applyHooks({ svg: wrapped, hooks })
  return {
    svg: hooked.svg,
    width,
    height,
    kind: type.id,
    diagnostics: [...diagnostics, ...(drawing.diagnostics ?? []), ...iconDiagnostics(raw), ...hooked.diagnostics],
  }
}

function unknownType(source: string): DiagramError {
  const keyword = keywordOf(source)
  return new DiagramError({
    message: keyword
      ? `No diagram type called "${keyword}". Known: ${[...BY_KEYWORD.keys()].join(', ')}.`
      : 'The diagram is empty.',
    diagnostics: [],
  })
}

/** The theme, text kit and seeded randomness a render draws with; frontmatter beats options. */
function contextFor({
  values,
  options,
  body,
}: {
  values: Record<string, string>
  options: RenderOptions
  body: string
}): { ctx: Context; seed: number } {
  const dark = values.dark ? values.dark === 'true' : options.dark
  const base = resolveTheme({ theme: values.theme ?? options.theme, dark })
  const look = parseLook(values.look) ?? options.look ?? base.look
  const tokens = { ...base, look }
  const seed = Number(values.seed ?? options.seed ?? 0) + hash(body)
  const ctx: Context = {
    tokens,
    text: textKit({
      font: tokens.font.id,
      family: tokens.font.family,
      heading: tokens.font.heading.id,
    }),
    rng: rng(seed),
    options: values,
  }
  return { ctx, seed }
}

/** Like render, but returns the error message instead of throwing. */
export async function tryRender(
  source: string,
  options: RenderOptions = {},
): Promise<RenderResult | { error: string }> {
  try {
    return await render(source, options)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
