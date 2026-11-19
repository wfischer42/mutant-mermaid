import { oklch, parseOklch } from './color.ts'
import {
  nearestSwatch,
  PHOSPHOR,
  SCHEMES,
  type Scheme,
  type SchemeRoles,
  type SchemeSet,
  schemeNeutrals,
  schemeSwatch,
} from './schemes.ts'

export { alpha, mix, oklch, parseOklch } from './color.ts'
export { SCHEMES, type Scheme, type SchemeRoles, type SchemeSet } from './schemes.ts'

export type Look = 'organic' | 'clean' | 'sketch' | 'boxy'

export const LOOKS: readonly Look[] = ['clean', 'organic', 'sketch', 'boxy']

/** A look from free text, or null when it names none. */
export function parseLook(value: unknown): Look | null {
  return LOOKS.find((look) => look === value) ?? null
}
export const FONT_IDS = ['nunito', 'inter', 'plex', 'dm-sans', 'source-sans', 'figtree'] as const

export type FontId = (typeof FONT_IDS)[number]

/** The bundled fonts a theme can name, with a display name and the CSS family list each draws in. */
export const FONTS: Record<FontId, { label: string; family: string }> = {
  nunito: {
    label: 'Nunito',
    family: "Nunito, 'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif",
  },
  inter: {
    label: 'Inter',
    family: "Inter, 'Helvetica Neue', Helvetica, 'Segoe UI', system-ui, sans-serif",
  },
  plex: {
    label: 'IBM Plex Sans',
    family: "'IBM Plex Sans', 'Helvetica Neue', Helvetica, 'Segoe UI', system-ui, sans-serif",
  },
  'dm-sans': {
    label: 'DM Sans',
    family: "'DM Sans', 'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif",
  },
  'source-sans': {
    label: 'Source Sans 3',
    family: "'Source Sans 3', 'Source Sans Pro', 'Segoe UI', system-ui, sans-serif",
  },
  figtree: {
    label: 'Figtree',
    family: "Figtree, 'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif",
  },
}

/** A font id from free text, or null when it names none. */
export function parseFont(value: unknown): FontId | null {
  return FONT_IDS.find((id) => id === value) ?? null
}

/** What a theme is made from. Every color is derived from these in OKLCH. */
export interface ThemeSpec {
  name: string
  dark: boolean
  /** Hue the neutrals (canvas, text) lean toward, in OKLCH degrees. */
  neutralHue: number
  /** How strongly the neutrals lean toward their hue, 0 (grey) to 1. */
  tint: number
  /** Categorical hues in the order they're handed out. Neighbours should contrast. */
  hues: number[]
  /** Chroma multiplier for the categorical colors; 1 is the designed default. */
  vivid: number
  accentHue: number
  /** Body text: what nodes and cards say. */
  font: FontId
  /** Titles and headings, drawn at WEIGHT.heading and up. The body font when left out. */
  headingFont?: FontId
  look: Look
  /** How far the dark canvas sinks, 0 (the designed slate) to 1 (near black). */
  depth?: number
  /** How far text, lines and borders stand off the canvas, 0 (designed) to 1 (high contrast). */
  contrast?: number
  /** A borrowed palette whose exact colors replace the hue-derived ones. */
  scheme?: SchemeSet
}

/** One categorical color in the tones a diagram needs. */
export interface Swatch {
  hue: number
  /** Lines, outlines and branches. */
  stroke: string
  /** A deeper stroke for emphasis, arrowheads and small marks. */
  strong: string
  /** Large areas behind text. */
  fill: string
  /** A step deeper than fill, for nested areas or hover. */
  soft: string
  /** Text on `fill` or `soft`. */
  ink: string
}

export interface Tokens {
  name: string
  dark: boolean
  look: Look
  /** True when the colors come from a borrowed scheme, so author colors snap to its palette. */
  fixed?: boolean
  /** The spec's depth and contrast, so colors made later match the palette. */
  depth?: number
  contrast?: number
  /** The canvas. */
  bg: string
  /** Cards and boxes that sit on the canvas. */
  surface: string
  /** Wells and bands set into the canvas. */
  sunken: string
  border: string
  fg: string
  muted: string
  faint: string
  accent: Swatch
  palette: Swatch[]
  semantic: {
    positive: Swatch
    negative: Swatch
    caution: Swatch
    neutral: Swatch
    /** Reinforcing loops: warm. */
    reinforcing: Swatch
    /** Balancing loops: cool. */
    balancing: Swatch
  }
  font: FontTokens
}

export interface FontTokens {
  id: FontId
  family: string
  size: number
  heading: { id: FontId; family: string }
}

function fontTokens(spec: ThemeSpec): FontTokens {
  const heading = spec.headingFont ?? spec.font
  return {
    id: spec.font,
    family: FONTS[spec.font].family,
    size: 14,
    heading: { id: heading, family: FONTS[heading].family },
  }
}

/** Coral, green, blue, amber, pink, teal, violet, orange: each next to hues it stands apart from. */
const HUES = [28, 150, 250, 82, 345, 195, 295, 55]

/**
 * Yellows and greens look muddy at the lightness that suits blue and red, so their strokes are
 * lifted a little, most around 100°.
 */
function lift(hue: number): number {
  const distance = Math.min(Math.abs(hue - 100), 360 - Math.abs(hue - 100))
  return 0.09 * Math.exp(-(distance * distance) / (2 * 35 * 35))
}

/**
 * Contrast moves strokes away from the canvas and ink toward pure text. Depth sinks dark fills
 * with the canvas so they still sit just above it.
 */
export function swatch({
  hue,
  dark,
  vivid = 1,
  contrast = 0,
  depth = 0,
}: {
  hue: number
  dark: boolean
  vivid?: number
  contrast?: number
  depth?: number
}): Swatch {
  const up = lift(hue)
  const k = contrast
  if (dark)
    return {
      hue,
      stroke: oklch({ l: 0.6 + up * 0.5 + k * 0.15, c: 0.065 * vivid * (1 + k * 0.7), h: hue }),
      strong: oklch({ l: 0.76 + up * 0.3 + k * 0.1, c: 0.075 * vivid, h: hue }),
      fill: oklch({ l: 0.26 - depth * 0.07 - k * 0.03, c: 0.028 * vivid * (1 + k), h: hue }),
      soft: oklch({ l: 0.31 - depth * 0.07 - k * 0.02, c: 0.04 * vivid * (1 + k * 0.5), h: hue }),
      ink: oklch({ l: 0.94 + k * 0.05, c: 0.025 * (1 - k * 0.6), h: hue }),
    }
  return {
    hue,
    stroke: oklch({
      l: 0.74 + up * (1 - k / 2) - k * 0.22,
      c: 0.08 * vivid * (1 + k * 0.6),
      h: hue,
    }),
    strong: oklch({ l: 0.52 + up * 0.6 - k * 0.13, c: 0.11 * vivid, h: hue }),
    fill: oklch({ l: 0.96 + k * 0.01, c: 0.022 * vivid, h: hue }),
    soft: oklch({ l: 0.92 - k * 0.02, c: 0.04 * vivid * (1 + k * 0.3), h: hue }),
    ink: oklch({ l: 0.32 - k * 0.15, c: 0.08 * (1 - k * 0.3), h: hue }),
  }
}

/** A fresh swatch for a hue, toned to match the theme's own palette; `vivid` below 1 mutes it. */
export function toned({
  tokens,
  hue,
  vivid,
}: {
  tokens: Tokens
  hue: number
  vivid?: number
}): Swatch {
  return swatch({ hue, vivid, dark: tokens.dark, contrast: tokens.contrast, depth: tokens.depth })
}

/** A corner radius as the look wants it: as designed, or square for the boxy look. */
export function corner({ tokens, r }: { tokens: Tokens; r: number }): number {
  return tokens.look === 'boxy' ? 0 : r
}

/**
 * Text weights every diagram shares, kept light so rounded faces stay clean: body for what a
 * node says, heading for the name over a group, title for the diagram's own.
 */
export const WEIGHT = { body: 500, heading: 600, title: 700 } as const

/** Outline widths for nodes and cards: the usual, and one step up for emphasis. */
export const OUTLINE = { thin: 1.25, strong: 1.5 } as const

type Step = [lightness: number, atDepth: number, atContrast: number, chroma: number]

/** Each neutral's lightness, how far full depth and full contrast shift it, and its chroma. */
const NEUTRALS: Record<
  'dark' | 'light',
  Record<'bg' | 'surface' | 'sunken' | 'border' | 'faint' | 'muted' | 'fg', Step>
> = {
  dark: {
    bg: [0.2, -0.07, -0.08, 0.025],
    surface: [0.245, -0.075, -0.07, 0.028],
    sunken: [0.175, -0.065, -0.07, 0.022],
    border: [0.34, -0.06, 0.12, 0.03],
    faint: [0.47, -0.03, 0.13, 0.03],
    muted: [0.7, 0, 0.13, 0.025],
    fg: [0.94, 0, 0.05, 0.012],
  },
  light: {
    bg: [0.982, 0, 0.018, 0.012],
    surface: [0.997, 0, 0.003, 0.006],
    sunken: [0.953, 0, -0.01, 0.018],
    border: [0.875, 0, -0.3, 0.025],
    faint: [0.74, 0, -0.22, 0.03],
    muted: [0.54, 0, -0.18, 0.035],
    fg: [0.27, 0, -0.13, 0.03],
  },
}

/** The canvas and text tones: the designed steps, sunk by depth and spread apart by contrast. */
function neutralsFor({ spec }: { spec: ThemeSpec }) {
  const { dark, neutralHue: h, tint, depth = 0, contrast = 0 } = spec
  const t = dark ? NEUTRALS.dark : NEUTRALS.light
  const tone = ([l, dl, cl, c]: Step) =>
    oklch({ l: l + dl * depth + cl * contrast, c: c * tint * (1 - contrast * 0.4), h })
  return {
    bg: tone(t.bg),
    surface: tone(t.surface),
    sunken: tone(t.sunken),
    border: tone(t.border),
    faint: tone(t.faint),
    muted: tone(t.muted),
    fg: tone(t.fg),
  }
}

/** Tokens from a borrowed scheme: its own colors, and the semantic roles it assigns. */
function schemeTokens({ spec, set }: { spec: ThemeSpec; set: SchemeSet }): Tokens {
  const { dark } = spec
  const scheme = dark ? set.dark : set.light
  const neutrals = schemeNeutrals({ scheme, dark })
  const palette = scheme.colors.map((color) => schemeSwatch({ color, scheme, dark }))
  const role = (color: string) => schemeSwatch({ color, scheme, dark })
  const base = role(neutrals.muted)
  const { roles } = scheme
  return {
    name: spec.name,
    dark,
    look: spec.look,
    fixed: true,
    ...neutrals,
    accent: schemeSwatch({ color: scheme.accent, scheme, dark }),
    palette,
    semantic: {
      positive: role(roles.positive),
      negative: role(roles.negative),
      caution: role(roles.caution),
      neutral: { ...base, stroke: neutrals.muted, strong: neutrals.fg, ink: neutrals.fg },
      reinforcing: role(roles.reinforcing),
      balancing: role(roles.balancing),
    },
    font: fontTokens(spec),
  }
}

export function createTokens(spec: ThemeSpec): Tokens {
  if (spec.scheme) return schemeTokens({ spec, set: spec.scheme })
  const { dark, neutralHue: h, depth = 0, contrast = 0 } = spec
  const make = (hue: number) => swatch({ hue, dark, vivid: spec.vivid, contrast, depth })
  const neutrals = neutralsFor({ spec })
  return {
    name: spec.name,
    dark,
    look: spec.look,
    depth,
    contrast,
    ...neutrals,
    accent: make(spec.accentHue),
    palette: spec.hues.map(make),
    semantic: {
      positive: make(150),
      negative: make(25),
      caution: make(78),
      neutral: { ...make(h), stroke: neutrals.muted, strong: neutrals.fg },
      reinforcing: make(40),
      balancing: make(235),
    },
    font: fontTokens(spec),
  }
}

/** The i-th categorical swatch, wrapping round the palette. */
export function pick({ tokens, index }: { tokens: Tokens; index: number }): Swatch {
  const { palette } = tokens
  return palette[((index % palette.length) + palette.length) % palette.length]
}

/** Color names an author can use in place of an index or a hex value. */
export const NAMED_HUES: Record<string, number> = {
  red: 25,
  coral: 28,
  orange: 55,
  amber: 82,
  yellow: 100,
  lime: 125,
  green: 150,
  moss: 130,
  teal: 195,
  cyan: 210,
  sky: 230,
  blue: 250,
  indigo: 275,
  violet: 295,
  purple: 310,
  magenta: 330,
  pink: 345,
  rose: 10,
  brown: 60,
}

const NEUTRAL_NAMES = new Set(['grey', 'gray', 'neutral', 'muted', 'faint'])

/** True for a palette name an author can write as `#name`, such as `coral` or `grey`. */
export function isColorName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower in NAMED_HUES || NEUTRAL_NAMES.has(lower)
}

/**
 * A swatch for a color an author wrote: a palette name, a hex value or an index. A hex value
 * keeps its hue but takes the theme's lightness and chroma, so it sits with the rest.
 */
export function swatchFor({ tokens, color }: { tokens: Tokens; color: string }): Swatch | null {
  const name = color.toLowerCase()
  if (NEUTRAL_NAMES.has(name)) return tokens.semantic.neutral
  if (name in NAMED_HUES) return hued({ tokens, hue: NAMED_HUES[name] })
  if (/^\d+$/.test(name)) return pick({ tokens, index: Number(name) })
  const parsed = parseOklch(color)
  if (!parsed) return null
  if (parsed.c < 0.012) return tokens.semantic.neutral
  return hued({ tokens, hue: parsed.h })
}

/** A swatch for a hue: made fresh, or the nearest palette color when the scheme is borrowed. */
function hued({ tokens, hue }: { tokens: Tokens; hue: number }): Swatch {
  if (tokens.fixed) return nearestSwatch({ swatches: tokens.palette, hue })
  return toned({ tokens, hue })
}

type Preset = Omit<ThemeSpec, 'dark' | 'name'> & { dark?: boolean }

/** The non-color settings borrowed schemes share; their hues are unused. */
const BORROWED_BASE: Preset = {
  neutralHue: 0,
  tint: 0,
  hues: HUES,
  vivid: 1,
  accentHue: 250,
  font: 'nunito',
  look: 'clean',
}

export const PRESETS: Record<string, Preset> = {
  /** Warm paper, rounded type, soft organic color. The default. */
  meadow: {
    neutralHue: 85,
    tint: 0.55,
    hues: HUES,
    vivid: 1,
    accentHue: 250,
    font: 'nunito',
    look: 'clean',
  },
  /** Cool and crisp, for technical diagrams. */
  ink: {
    neutralHue: 255,
    tint: 0.35,
    hues: [250, 28, 160, 300, 75, 200, 340, 120],
    vivid: 0.9,
    accentHue: 250,
    font: 'inter',
    look: 'clean',
  },
  /** Dusky violet neutrals with jewel tones. Dark by default. */
  dusk: {
    neutralHue: 285,
    tint: 0.8,
    hues: [340, 195, 82, 265, 150, 25, 305, 55],
    vivid: 1.1,
    accentHue: 305,
    font: 'nunito',
    look: 'clean',
    dark: true,
  },
  /** Cream paper and muted earth tones. */
  paper: {
    neutralHue: 70,
    tint: 1,
    hues: [40, 140, 230, 85, 10, 185, 280, 60],
    vivid: 0.75,
    accentHue: 40,
    font: 'nunito',
    look: 'clean',
  },
  /** Bright, saturated, playful. */
  candy: {
    neutralHue: 330,
    tint: 0.3,
    hues: [350, 200, 95, 285, 150, 40, 230, 320],
    vivid: 1.3,
    accentHue: 350,
    font: 'nunito',
    look: 'clean',
  },
  /** Deep blue-black night with cool, clear color. Dark by default. */
  midnight: {
    neutralHue: 258,
    tint: 1,
    hues: [215, 28, 160, 300, 82, 250, 345, 125],
    vivid: 1.05,
    accentHue: 215,
    font: 'inter',
    look: 'clean',
    dark: true,
    depth: 1,
  },
  /** Near-black graphite with no tint, so the colors carry everything. Dark by default. */
  carbon: {
    neutralHue: 250,
    tint: 0.12,
    hues: HUES,
    vivid: 1.1,
    accentHue: 55,
    font: 'inter',
    look: 'clean',
    dark: true,
    depth: 1,
  },
  /** High contrast: white and near-black, with deep, saturated lines. */
  stark: {
    neutralHue: 250,
    tint: 0,
    hues: [25, 150, 250, 82, 330, 195, 295, 55],
    vivid: 1.2,
    accentHue: 250,
    font: 'inter',
    look: 'clean',
    contrast: 1,
  },
  /** High contrast on black: bright, saturated lines that glow. Dark by default. */
  neon: {
    neutralHue: 285,
    tint: 0.25,
    hues: [345, 150, 210, 95, 295, 55, 250, 15],
    vivid: 1.35,
    accentHue: 330,
    font: 'inter',
    look: 'clean',
    dark: true,
    depth: 1,
    contrast: 1,
  },
  /** Pod's amber terminal: warm black, amber type, bright CRT colors. Dark by default. */
  phosphor: { ...BORROWED_BASE, font: 'inter', scheme: PHOSPHOR, dark: true },
  ...borrowedPresets(),
}

/** One preset per borrowed scheme, shown in its preferred variant unless dark is set. */
function borrowedPresets(): Record<string, Preset> {
  return Object.fromEntries(
    Object.entries(SCHEMES).map(([name, scheme]) => [
      name,
      { ...BORROWED_BASE, scheme, dark: scheme.prefers === 'dark' },
    ]),
  )
}

export type ThemeInput = string | Partial<ThemeSpec> | Tokens

/** A host's own colors, for `themeFromColors`. Any CSS color works. */
export interface HostColors {
  bg: string
  fg: string
  accent: string
  /** Categorical colors in the order they're handed out. */
  colors: string[]
  surface?: string
  muted?: string
  /** Picked from `colors` by hue when left out. */
  roles?: Partial<SchemeRoles>
}

/** The hue each semantic role is picked near when the host doesn't name it. */
const ROLE_HUES: Record<keyof SchemeRoles, number> = {
  positive: 150,
  negative: 25,
  caution: 80,
  reinforcing: 40,
  balancing: 235,
}

/** A CSS color as hex, or an error naming the field that held it. */
function hexOf({ color, field }: { color: string; field: string }): string {
  const parsed = parseOklch(color)
  if (!parsed) throw new Error(`themeFromColors: ${field} "${color}" isn't a CSS color.`)
  return oklch(parsed)
}

/** The color in `colors` whose hue is nearest `hue`, skipping greys. */
function nearestHue({ colors, hue }: { colors: string[]; hue: number }): string | null {
  let best: { color: string; distance: number } | null = null
  for (const color of colors) {
    const parsed = parseOklch(color)
    if (!parsed || parsed.c < 0.03) continue
    const turn = Math.abs(parsed.h - hue) % 360
    const distance = Math.min(turn, 360 - turn)
    if (!best || distance < best.distance) best = { color, distance }
  }
  return best?.color ?? null
}

/**
 * A theme made from a host app's colors, used exactly as given, like the editor palettes. Pass the
 * result as `theme` to `render`, or to `renderMermaid`, so diagrams match the app around them.
 */
export function themeFromColors(
  input: HostColors,
  {
    dark,
    name = 'host',
    look = 'clean',
    font = 'nunito',
    headingFont,
  }: {
    dark: boolean
    name?: string
    look?: Look
    font?: FontId
    headingFont?: FontId
  },
): ThemeSpec {
  const colors = input.colors.map((color, i) => hexOf({ color, field: `colors[${i}]` }))
  if (colors.length === 0) throw new Error('themeFromColors: colors needs at least one color.')
  const accent = hexOf({ color: input.accent, field: 'accent' })
  const role = (key: keyof SchemeRoles) => {
    const given = input.roles?.[key]
    if (given) return hexOf({ color: given, field: `roles.${key}` })
    return nearestHue({ colors, hue: ROLE_HUES[key] }) ?? accent
  }
  const scheme: Scheme = {
    bg: hexOf({ color: input.bg, field: 'bg' }),
    fg: hexOf({ color: input.fg, field: 'fg' }),
    surface: input.surface ? hexOf({ color: input.surface, field: 'surface' }) : undefined,
    muted: input.muted ? hexOf({ color: input.muted, field: 'muted' }) : undefined,
    colors,
    accent,
    roles: {
      positive: role('positive'),
      negative: role('negative'),
      caution: role('caution'),
      reinforcing: role('reinforcing'),
      balancing: role('balancing'),
    },
  }
  return {
    ...BORROWED_BASE,
    name,
    dark,
    look,
    font,
    headingFont,
    scheme: { light: scheme, dark: scheme, prefers: dark ? 'dark' : 'light' },
  }
}

export function isTokens(input: ThemeInput): input is Tokens {
  return typeof input === 'object' && 'palette' in input && 'semantic' in input
}

/** Tokens from a preset name, a partial spec (laid over meadow), or tokens already made. */
export function resolveTheme({
  theme = 'meadow',
  dark,
}: {
  theme?: ThemeInput
  dark?: boolean
}): Tokens {
  if (typeof theme === 'object' && isTokens(theme)) return theme
  const named = typeof theme === 'string' ? theme : (theme.name ?? 'meadow')
  const preset = PRESETS[named] ?? PRESETS.meadow
  const overrides = typeof theme === 'string' ? {} : theme
  return createTokens({
    ...preset,
    ...overrides,
    name: named,
    dark: dark ?? overrides.dark ?? preset.dark ?? false,
  })
}
