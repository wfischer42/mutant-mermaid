import './diagrams/index.ts'

export { guide } from './core/guide.ts'
export type { Hook } from './core/hooks.ts'
export { parseClick } from './core/hooks.ts'
export type { Diagnostic } from './core/parse.ts'
export type { Registered, RenderOptions } from './core/render.ts'
export {
  detect,
  diagramTypes,
  formatDiagnostics,
  keywordOf,
  register,
  render,
  tryRender,
} from './core/render.ts'
export type { Context, DiagramType, Drawing, Guide, Parsed, RenderResult } from './core/types.ts'
export { DiagramError } from './core/types.ts'
export type { BindOptions, PartEvent, PartHandler } from './interact.ts'
export { bind, highlight } from './interact.ts'
export type {
  FontId,
  FontTokens,
  HostColors,
  Look,
  Swatch,
  ThemeInput,
  ThemeSpec,
  Tokens,
} from './theme/index.ts'
export {
  corner,
  createTokens,
  FONT_IDS,
  FONTS,
  LOOKS,
  OUTLINE,
  PRESETS,
  parseFont,
  parseLook,
  pick,
  resolveTheme,
  SCHEMES,
  swatch,
  swatchFor,
  themeFromColors,
  toned,
  WEIGHT,
} from './theme/index.ts'
