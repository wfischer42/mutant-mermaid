/**
 * Mermaid with our theme, for the browser. The headless (Node) renderer is in `./headless.ts`,
 * kept apart so browser bundles never import playwright.
 */
export type {
  MermaidRendered,
  MermaidRenderOptions,
  MermaidResult,
} from './browser.ts'
export { renderMermaid } from './browser.ts'
export type { MermaidKeyword } from './keywords.ts'
export { explainMermaidError, MERMAID_KEYWORDS, mermaidKeyword } from './keywords.ts'
export type { PostprocessOptions, Sized } from './postprocess.ts'
export { postprocess } from './postprocess.ts'
export type { MermaidConfig } from './theme.ts'
export { MERMAID_FONT_SIZE, mermaidConfig, themeCSS, themeVariables } from './theme.ts'
