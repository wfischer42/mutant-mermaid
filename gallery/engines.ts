import { detect, type RenderOptions, resolveTheme, tryRender } from '../src/index.ts'
import { renderMermaid } from '../src/mermaid/index.ts'

export type Rendered =
  | { svg: string; width: number; height: number; engine: 'ours' | 'mermaid' }
  | { error: string }

async function ours(source: string, options: RenderOptions): Promise<Rendered> {
  const result = await tryRender(source, options)
  if ('error' in result) return result
  return { ...result, engine: 'ours' }
}

async function mermaid(source: string, options: RenderOptions): Promise<Rendered> {
  const tokens = resolveTheme({ theme: options.theme, dark: options.dark })
  const result = await renderMermaid({ source, tokens, background: !options.transparent })
  if ('error' in result) return result
  return { ...result, engine: 'mermaid' }
}

/**
 * Renders with our renderer when a type claims the source, otherwise with Mermaid. `engine:
 * 'mermaid'` forces Mermaid, for side-by-side comparison.
 */
export async function renderAny(
  source: string,
  options: RenderOptions & { engine?: 'mermaid' } = {},
): Promise<Rendered> {
  if (options.engine !== 'mermaid' && detect(source)) return ours(source, options)
  return mermaid(source, options)
}
