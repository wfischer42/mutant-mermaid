import { mix, parseOklch } from './color.ts'
import type { Swatch } from './index.ts'

/** The semantic roles a scheme assigns: success, error and warning, plus warm and cool loops. */
export interface SchemeRoles {
  positive: string
  negative: string
  caution: string
  reinforcing: string
  balancing: string
}

/**
 * A borrowed color scheme: the exact colors of a well-known editor palette, used as written
 * rather than re-derived from hues. Categorical colors are listed so neighbours contrast, using
 * every official accent; a palette with few hues (Gruvbox) continues with its alternate shades,
 * so the colors after the first round differ in tone instead of repeating.
 */
export interface Scheme {
  bg: string
  fg: string
  /** Cards that sit on the canvas; derived from bg when left out. */
  surface?: string
  /** The scheme's comment or secondary-text color. */
  muted?: string
  colors: string[]
  accent: string
  roles: SchemeRoles
}

export interface SchemeSet {
  light: Scheme
  dark: Scheme
  /** The variant shown when dark mode isn't asked for either way. */
  prefers: 'light' | 'dark'
}

const SOLARIZED_ACCENTS = [
  '#dc322f',
  '#859900',
  '#268bd2',
  '#b58900',
  '#d33682',
  '#2aa198',
  '#6c71c4',
  '#cb4b16',
]

const SOLARIZED_ROLES: SchemeRoles = {
  positive: '#859900',
  negative: '#dc322f',
  caution: '#b58900',
  reinforcing: '#cb4b16',
  balancing: '#268bd2',
}

/**
 * Pod's Phosphor: an amber terminal. Warm black, amber text and accent, and the bright CRT
 * primaries for categories, with cyan (amber's complement) for balancing. Pod has no light
 * variant; this one is amber ink on warm paper, the same wheel darkened for a light ground.
 */
export const PHOSPHOR: SchemeSet = {
  prefers: 'dark',
  dark: {
    bg: '#0b0906',
    surface: '#120f0b',
    fg: '#f9cc87',
    muted: '#c0965d',
    colors: ['#ffa733', '#36dede', '#ea6ae2', '#a1e24c', '#75a9ff', '#fa6863', '#efd956'],
    accent: '#ffa733',
    roles: {
      positive: '#a1e24c',
      negative: '#fa6863',
      caution: '#efd956',
      reinforcing: '#ffa733',
      balancing: '#36dede',
    },
  },
  light: {
    bg: '#fbf3e6',
    surface: '#fffaf2',
    fg: '#3a2a14',
    muted: '#86663c',
    colors: ['#b45f00', '#00808a', '#a8329f', '#4c8510', '#2f5fc4', '#c0302b', '#8a7400'],
    accent: '#b45f00',
    roles: {
      positive: '#4c8510',
      negative: '#c0302b',
      caution: '#8a7400',
      reinforcing: '#b45f00',
      balancing: '#00808a',
    },
  },
}

export const SCHEMES: Record<string, SchemeSet> = {
  gruvbox: {
    prefers: 'dark',
    dark: {
      bg: '#282828',
      surface: '#32302f',
      fg: '#ebdbb2',
      muted: '#a89984',
      colors: [
        '#fb4934',
        '#b8bb26',
        '#83a598',
        '#fabd2f',
        '#d3869b',
        '#8ec07c',
        '#fe8019',
        '#458588',
        '#d79921',
        '#b16286',
        '#98971a',
        '#d65d0e',
        '#689d6a',
        '#cc241d',
      ],
      accent: '#fe8019',
      roles: {
        positive: '#b8bb26',
        negative: '#fb4934',
        caution: '#fabd2f',
        reinforcing: '#fe8019',
        balancing: '#83a598',
      },
    },
    light: {
      bg: '#fbf1c7',
      surface: '#f9f5d7',
      fg: '#3c3836',
      muted: '#7c6f64',
      colors: [
        '#cc241d',
        '#98971a',
        '#458588',
        '#d79921',
        '#b16286',
        '#689d6a',
        '#d65d0e',
        '#076678',
        '#b57614',
        '#8f3f71',
        '#79740e',
        '#af3a03',
        '#427b58',
        '#9d0006',
      ],
      accent: '#d65d0e',
      roles: {
        positive: '#98971a',
        negative: '#cc241d',
        caution: '#d79921',
        reinforcing: '#d65d0e',
        balancing: '#458588',
      },
    },
  },
  dracula: {
    prefers: 'dark',
    dark: {
      bg: '#282a36',
      surface: '#2f3241',
      fg: '#f8f8f2',
      muted: '#7f8bc2',
      colors: ['#ff79c6', '#50fa7b', '#bd93f9', '#f1fa8c', '#ff5555', '#8be9fd', '#ffb86c'],
      accent: '#bd93f9',
      roles: {
        positive: '#50fa7b',
        negative: '#ff5555',
        caution: '#f1fa8c',
        reinforcing: '#ffb86c',
        balancing: '#8be9fd',
      },
    },
    light: {
      bg: '#fffbeb',
      fg: '#1f1f1f',
      muted: '#635d97',
      colors: ['#a3144d', '#14710a', '#644ac9', '#846e15', '#cb3a2a', '#036a96', '#a34d14'],
      accent: '#644ac9',
      roles: {
        positive: '#14710a',
        negative: '#cb3a2a',
        caution: '#846e15',
        reinforcing: '#a34d14',
        balancing: '#036a96',
      },
    },
  },
  nord: {
    prefers: 'dark',
    dark: {
      bg: '#2e3440',
      surface: '#3b4252',
      fg: '#eceff4',
      muted: '#a3abb9',
      colors: [
        '#bf616a',
        '#a3be8c',
        '#81a1c1',
        '#ebcb8b',
        '#b48ead',
        '#88c0d0',
        '#d08770',
        '#8fbcbb',
        '#5e81ac',
      ],
      accent: '#88c0d0',
      roles: {
        positive: '#a3be8c',
        negative: '#bf616a',
        caution: '#ebcb8b',
        reinforcing: '#d08770',
        balancing: '#81a1c1',
      },
    },
    light: {
      bg: '#eceff4',
      surface: '#f5f7fa',
      fg: '#2e3440',
      muted: '#4c566a',
      colors: [
        '#bf616a',
        '#a3be8c',
        '#5e81ac',
        '#ebcb8b',
        '#b48ead',
        '#88c0d0',
        '#d08770',
        '#8fbcbb',
        '#81a1c1',
      ],
      accent: '#5e81ac',
      roles: {
        positive: '#a3be8c',
        negative: '#bf616a',
        caution: '#ebcb8b',
        reinforcing: '#d08770',
        balancing: '#5e81ac',
      },
    },
  },
  solarized: {
    prefers: 'light',
    dark: {
      bg: '#002b36',
      surface: '#073642',
      fg: '#93a1a1',
      muted: '#657b83',
      colors: SOLARIZED_ACCENTS,
      accent: '#268bd2',
      roles: SOLARIZED_ROLES,
    },
    light: {
      bg: '#fdf6e3',
      fg: '#586e75',
      muted: '#839496',
      colors: SOLARIZED_ACCENTS,
      accent: '#268bd2',
      roles: SOLARIZED_ROLES,
    },
  },
  catppuccin: {
    prefers: 'dark',
    dark: {
      bg: '#1e1e2e',
      surface: '#262637',
      fg: '#cdd6f4',
      muted: '#9399b2',
      colors: [
        '#f38ba8',
        '#a6e3a1',
        '#89b4fa',
        '#f9e2af',
        '#cba6f7',
        '#94e2d5',
        '#fab387',
        '#f5c2e7',
        '#74c7ec',
        '#b4befe',
        '#eba0ac',
        '#89dceb',
      ],
      accent: '#cba6f7',
      roles: {
        positive: '#a6e3a1',
        negative: '#f38ba8',
        caution: '#f9e2af',
        reinforcing: '#fab387',
        balancing: '#89b4fa',
      },
    },
    light: {
      bg: '#eff1f5',
      surface: '#f7f8fa',
      fg: '#4c4f69',
      muted: '#7c7f93',
      colors: [
        '#d20f39',
        '#40a02b',
        '#1e66f5',
        '#df8e1d',
        '#8839ef',
        '#179299',
        '#fe640b',
        '#ea76cb',
        '#209fb5',
        '#7287fd',
        '#e64553',
        '#04a5e5',
      ],
      accent: '#8839ef',
      roles: {
        positive: '#40a02b',
        negative: '#d20f39',
        caution: '#df8e1d',
        reinforcing: '#fe640b',
        balancing: '#1e66f5',
      },
    },
  },
  'tokyo-night': {
    prefers: 'dark',
    dark: {
      bg: '#1a1b26',
      surface: '#24283b',
      fg: '#c0caf5',
      muted: '#737aa2',
      colors: [
        '#f7768e',
        '#9ece6a',
        '#7aa2f7',
        '#e0af68',
        '#bb9af7',
        '#73daca',
        '#ff9e64',
        '#7dcfff',
        '#9d7cd8',
        '#2ac3de',
        '#db4b4b',
      ],
      accent: '#7aa2f7',
      roles: {
        positive: '#9ece6a',
        negative: '#f7768e',
        caution: '#e0af68',
        reinforcing: '#ff9e64',
        balancing: '#7aa2f7',
      },
    },
    light: {
      bg: '#e1e2e7',
      surface: '#eceef3',
      fg: '#3760bf',
      muted: '#6172b0',
      colors: [
        '#f52a65',
        '#587539',
        '#2e7de9',
        '#8c6c3e',
        '#9854f1',
        '#118c74',
        '#b15c00',
        '#007197',
        '#7847bd',
        '#188092',
        '#c64343',
      ],
      accent: '#2e7de9',
      roles: {
        positive: '#587539',
        negative: '#f52a65',
        caution: '#8c6c3e',
        reinforcing: '#b15c00',
        balancing: '#2e7de9',
      },
    },
  },
  'rose-pine': {
    prefers: 'dark',
    dark: {
      bg: '#191724',
      surface: '#1f1d2e',
      fg: '#e0def4',
      muted: '#908caa',
      colors: ['#eb6f92', '#9ccfd8', '#c4a7e7', '#f6c177', '#ebbcba', '#31748f'],
      accent: '#c4a7e7',
      roles: {
        positive: '#9ccfd8',
        negative: '#eb6f92',
        caution: '#f6c177',
        reinforcing: '#ebbcba',
        balancing: '#c4a7e7',
      },
    },
    light: {
      bg: '#faf4ed',
      surface: '#fffaf3',
      fg: '#575279',
      muted: '#797593',
      colors: ['#b4637a', '#56949f', '#907aa9', '#ea9d34', '#d7827e', '#286983'],
      accent: '#907aa9',
      roles: {
        positive: '#56949f',
        negative: '#b4637a',
        caution: '#ea9d34',
        reinforcing: '#d7827e',
        balancing: '#907aa9',
      },
    },
  },
  one: {
    prefers: 'dark',
    dark: {
      bg: '#282c34',
      surface: '#2f343e',
      fg: '#abb2bf',
      muted: '#7f848e',
      colors: [
        '#e06c75',
        '#98c379',
        '#61afef',
        '#e5c07b',
        '#c678dd',
        '#56b6c2',
        '#d19a66',
        '#be5046',
      ],
      accent: '#61afef',
      roles: {
        positive: '#98c379',
        negative: '#e06c75',
        caution: '#e5c07b',
        reinforcing: '#d19a66',
        balancing: '#61afef',
      },
    },
    light: {
      bg: '#fafafa',
      surface: '#ffffff',
      fg: '#383a42',
      muted: '#696c77',
      colors: [
        '#e45649',
        '#50a14f',
        '#4078f2',
        '#c18401',
        '#a626a4',
        '#0184bc',
        '#986801',
        '#ca1243',
      ],
      accent: '#4078f2',
      roles: {
        positive: '#50a14f',
        negative: '#e45649',
        caution: '#c18401',
        reinforcing: '#986801',
        balancing: '#4078f2',
      },
    },
  },
}

/**
 * A swatch built around one exact scheme color: it stays the stroke, fills are washes of it over
 * the canvas, and the darker or lighter tones lean toward the scheme's text color.
 */
export function schemeSwatch({
  color,
  scheme,
  dark,
}: {
  color: string
  scheme: Scheme
  dark: boolean
}): Swatch {
  const wash = (amount: number) => mix({ from: scheme.bg, to: color, amount })
  return {
    hue: parseOklch(color)?.h ?? 0,
    stroke: color,
    strong: mix({ from: color, to: scheme.fg, amount: 0.3 }),
    fill: wash(dark ? 0.18 : 0.13),
    soft: wash(dark ? 0.3 : 0.24),
    ink: mix({ from: color, to: scheme.fg, amount: 0.62 }),
  }
}

/** The neutrals of a scheme: its own canvas, text and comment colors, with the steps between. */
export function schemeNeutrals({ scheme, dark }: { scheme: Scheme; dark: boolean }) {
  const toward = (amount: number) => mix({ from: scheme.bg, to: scheme.fg, amount })
  const lifted = dark ? toward(0.05) : mix({ from: scheme.bg, to: '#ffffff', amount: 0.6 })
  return {
    bg: scheme.bg,
    surface: scheme.surface ?? lifted,
    sunken: dark ? mix({ from: scheme.bg, to: '#000000', amount: 0.18 }) : toward(0.05),
    border: toward(dark ? 0.2 : 0.16),
    faint: toward(0.4),
    muted: scheme.muted ?? toward(0.62),
    fg: scheme.fg,
  }
}

function hueGap({ a, b }: { a: number; b: number }): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/** How much closer in hue a later palette color must be to beat an earlier one. */
const TIE = 8

/**
 * The swatch whose hue is nearest the one asked for, for colors an author writes. Earlier colors
 * win near-ties, so a scheme's main accents come ahead of its alternate shades.
 */
export function nearestSwatch({ swatches, hue }: { swatches: Swatch[]; hue: number }): Swatch {
  return swatches.reduce((best, s) =>
    hueGap({ a: s.hue, b: hue }) < hueGap({ a: best.hue, b: hue }) - TIE ? s : best,
  )
}
