import { wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import { corner, render, resolveTheme, themeFromColors } from '../src/index.ts'
import { parseOklch } from '../src/theme/color.ts'

function measure({ theme, dark }: { theme: string; dark: boolean }) {
  const t = resolveTheme({ theme, dark })
  return {
    canvas: parseOklch(t.bg)?.l ?? 0,
    text: wcagContrast(t.fg, t.bg),
    muted: wcagContrast(t.muted, t.bg),
    stroke: Math.min(...t.palette.map((s) => wcagContrast(s.stroke, t.bg))),
    ink: Math.min(...t.palette.map((s) => wcagContrast(s.ink, s.fill))),
  }
}

describe('dark and high-contrast presets', () => {
  it('sinks midnight, carbon and neon below the designed dark canvas', () => {
    const designed = measure({ theme: 'meadow', dark: true }).canvas
    for (const theme of ['midnight', 'carbon', 'neon'])
      expect(measure({ theme, dark: true }).canvas).toBeLessThan(designed - 0.05)
  })

  it('opens dark by default', () => {
    for (const theme of ['midnight', 'carbon', 'neon'])
      expect(resolveTheme({ theme }).dark).toBe(true)
  })

  it('pushes text and lines further from the canvas in stark and neon', () => {
    for (const [theme, dark] of [
      ['stark', false],
      ['stark', true],
      ['neon', true],
    ] as const) {
      const base = measure({ theme: 'meadow', dark })
      const high = measure({ theme, dark })
      expect(high.text).toBeGreaterThan(base.text)
      expect(high.muted).toBeGreaterThan(base.muted)
      expect(high.stroke).toBeGreaterThan(base.stroke)
      expect(high.text).toBeGreaterThanOrEqual(15)
      expect(high.muted).toBeGreaterThanOrEqual(7)
      expect(high.stroke).toBeGreaterThanOrEqual(4.5)
      expect(high.ink).toBeGreaterThanOrEqual(7)
    }
  })
})

describe('boxy look', () => {
  it('squares corners only for boxy', () => {
    expect(corner({ tokens: resolveTheme({}), r: 10 })).toBe(10)
    expect(corner({ tokens: { ...resolveTheme({}), look: 'boxy' }, r: 10 })).toBe(0)
  })

  it('draws no arcs in a boxy card diagram', async () => {
    const source = 'compare "Plans"\n  Free\n    Basics\n  Pro\n    Everything'
    const round = await render(source)
    const boxy = await render(source, { look: 'boxy' })
    expect(round.svg).toMatch(/A\d/)
    expect(boxy.svg).not.toMatch(/A\d/)
  })
})

describe('themeFromColors', () => {
  const host = {
    bg: 'rgb(30, 30, 46)',
    fg: '#cdd6f4',
    accent: '#89b4fa',
    colors: ['#f38ba8', '#a6e3a1', '#89b4fa', '#f9e2af', '#cba6f7'],
  }

  it("uses the host's colors as written", () => {
    const t = resolveTheme({ theme: themeFromColors(host, { dark: true, name: 'framed' }) })
    expect(t.name).toBe('framed')
    expect(t.dark).toBe(true)
    expect(t.fixed).toBe(true)
    expect(t.bg).toBe('#1e1e2e')
    expect(t.fg).toBe('#cdd6f4')
    expect(t.palette).toHaveLength(host.colors.length)
  })

  it('picks semantic roles from the colors by hue', () => {
    const { scheme } = themeFromColors(host, { dark: true })
    expect(scheme?.dark.roles.positive).toBe('#a6e3a1')
    expect(scheme?.dark.roles.negative).toBe('#f38ba8')
    expect(scheme?.dark.roles.caution).toBe('#f9e2af')
  })

  it('keeps roles the host names', () => {
    const { scheme } = themeFromColors({ ...host, roles: { negative: '#ff0000' } }, { dark: false })
    expect(scheme?.light.roles.negative).toBe('#ff0000')
  })

  it('names the field holding a color it cannot read', () => {
    expect(() => themeFromColors({ ...host, accent: 'var(--accent)' }, { dark: true })).toThrow(
      /accent "var\(--accent\)"/,
    )
  })

  it('renders with the theme', async () => {
    const theme = themeFromColors(host, { dark: true })
    const { svg } = await render('pyramid "x"\n  a\n  b', { theme })
    expect(svg).toContain('#1e1e2e')
  })
})
