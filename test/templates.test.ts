import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCanvas } from '../src/diagrams/templates/canvas.ts'
import { between } from '../src/diagrams/templates/common.ts'
import { parseCompare } from '../src/diagrams/templates/compare.ts'
import { parseCycle } from '../src/diagrams/templates/cycle.ts'
import { parseLayers } from '../src/diagrams/templates/layers.ts'
import { parseMatrix } from '../src/diagrams/templates/matrix.ts'
import { parsePyramid } from '../src/diagrams/templates/pyramid.ts'
import { parseSpectrum } from '../src/diagrams/templates/spectrum.ts'
import { render, tryRender } from '../src/index.ts'

const examples = join(import.meta.dirname, '../examples/templates')

describe('pyramid and funnel', () => {
  it('reads tiers with notes and colors', () => {
    const { model } = parsePyramid('funnel "Sales"\n  Visitors : 1,000 #blue\n  Paying')
    expect(model?.inverted).toBe(true)
    expect(model?.tiers[0]).toMatchObject({ label: 'Visitors', note: '1,000', color: 'blue' })
  })

  it('reads the hues an ordered series runs between', () => {
    expect(parsePyramid('pyramid "P" colors=green-teal\n  A').model?.hues).toEqual([150, 195])
    expect(parsePyramid('pyramid "P" colors=amber\n  A').model?.hues).toEqual([82, 82])
    const bad = parsePyramid('pyramid "P" colors=mauve-blue\n  A')
    expect(bad.model?.hues).toBeUndefined()
    expect(bad.diagnostics[0]).toMatchObject({ severity: 'warning' })
    expect(bad.diagnostics[0].message).toContain('colors=teal-blue')
  })

  it('slides the short way round the hue wheel', () => {
    expect(between({ hues: [345, 10], t: 0.4 })).toBeCloseTo(355)
    expect(between({ hues: [195, 250], t: 0.5 })).toBeCloseTo(222.5)
  })
})

describe('cycle', () => {
  it('reads stages and a flywheel hub', () => {
    const { model } = parseCycle('flywheel "Growth"\n  center Momentum\n  A : note\n  B\n  C')
    expect(model?.flywheel).toBe(true)
    expect(model?.center).toBe('Momentum')
    expect(model?.stages.map((s) => s.label)).toEqual(['A', 'B', 'C'])
    expect(model?.stages[0].note).toBe('note')
  })

  it('takes the hub from the header too', () => {
    expect(parseCycle('flywheel center="Hub"\n  A\n  B').model?.center).toBe('Hub')
  })

  it('needs two stages', () => {
    expect(parseCycle('cycle\n  Only').diagnostics[0].severity).toBe('error')
  })
})

describe('layers', () => {
  it('reads layers, chips and numbering', () => {
    const { model } = parseLayers(
      'layers "OSI" numbered=reverse\n  App : top\n    HTTP\n  Physical',
    )
    expect(model?.numbering).toBe('up')
    expect(model?.layers[0].items[0].label).toBe('HTTP')
    expect(model?.onion).toBe(false)
  })

  it('switches to onion rings', () => {
    expect(parseLayers('layers style=onion\n  Outer\n  Core').model?.onion).toBe(true)
    expect(parseLayers('onion\n  Outer\n  Core').model?.onion).toBe(true)
  })
})

describe('matrix', () => {
  it('reads axes, named quadrants and points', () => {
    const { model, diagnostics } = parseMatrix(
      [
        'matrix "Prioritize"',
        '  x Low effort .. High effort',
        '  y-axis Low --> High',
        '  quadrant "Quick wins" top-left : first',
        '    Fix copy',
        '  Big bets top-right',
        '  quadrant-3 Fill-ins',
        '  Later',
        '  Dark mode @ 0.3,0.6',
        '  Search: [0.8, 0.9]',
      ].join('\n'),
    )
    expect(diagnostics).toEqual([])
    expect(model?.x).toEqual(['Low effort', 'High effort'])
    expect(model?.y).toEqual(['Low', 'High'])
    const corners = Object.fromEntries(model?.quadrants.map((q) => [q.corner, q.label]) ?? [])
    expect(corners).toEqual({ tl: 'Quick wins', tr: 'Big bets', bl: 'Fill-ins', br: 'Later' })
    expect(model?.quadrants[0]).toMatchObject({ note: 'first' })
    expect(model?.points.map((p) => p.at)).toEqual([
      [0.3, 0.6],
      [0.8, 0.9],
    ])
  })

  it('moves a point label that would land on another', async () => {
    const { svg } = await render('matrix\n  Onboarding @ 0.2,0.8\n  Referrals @ 0.21,0.79')
    const [a, b] = [...svg.matchAll(/text-anchor="(\w+)"><tspan x="[\d.]+" y="([\d.]+)">\w+</g)]
    const apart = a[1] !== b[1] || Math.abs(Number(a[2]) - Number(b[2])) >= 15
    expect(apart).toBe(true)
  })
})

describe('canvas and swot', () => {
  it('fills in and orders the SWOT regions', () => {
    const { model } = parseCanvas('swot\n  T\n    Rivals\n  Strengths\n    Team')
    expect(model?.regions.map((r) => r.label)).toEqual([
      'Strengths',
      'Weaknesses',
      'Opportunities',
      'Threats',
    ])
    expect(model?.regions[3].items[0].label).toBe('Rivals')
  })

  it('sizes the grid from the region count or cols', () => {
    expect(parseCanvas('canvas\n  A\n  B\n  C').model?.cols).toBe(3)
    expect(parseCanvas('canvas\n  A\n  B\n  C\n  D').model?.cols).toBe(2)
    expect(parseCanvas('canvas cols=4\n  A\n  B span=2').model?.regions[1].span).toBe(2)
  })
})

describe('compare', () => {
  it('lines rows up when columns match', () => {
    const { model } = parseCompare('before-after\n  Before\n    a\n    b\n  After\n    c\n    d')
    expect(model?.beforeAfter).toBe(true)
    expect(model?.rows).toBe(true)
    expect(parseCompare('compare\n  A\n    a\n  B\n    b\n    c').model?.rows).toBe(false)
    expect(parseCompare('compare style=vs\n  A\n  B').model?.style).toBe('vs')
  })
})

describe('spectrum', () => {
  it('reads poles after the title, or on their own line', () => {
    const a = parseSpectrum('spectrum "Styles" Control .. Autonomy\n  Coach @ 0.4\n  Delegate')
    expect(a.model?.title).toBe('Styles')
    expect(a.model?.poles).toEqual(['Control', 'Autonomy'])
    expect(a.model?.items[0].at).toEqual([0.4])
    const b = parseSpectrum('spectrum "Styles"\n  Cold .. Hot\n  Warm')
    expect(b.model?.poles).toEqual(['Cold', 'Hot'])
    expect(b.model?.items.map((i) => i.label)).toEqual(['Warm'])
  })

  it('says how to name the poles', () => {
    expect(parseSpectrum('spectrum "x"\n  a').diagnostics[0].message).toMatch(
      /Control \.\. Autonomy/,
    )
  })
})

describe('rendering', () => {
  const files = readdirSync(examples).filter((f) => f.endsWith('.mmd'))

  it('has examples for every template type', () => {
    const kinds = new Set(files.map((f) => f.split('-')[0]))
    for (const kind of [
      'pyramid',
      'funnel',
      'cycle',
      'flywheel',
      'layers',
      'matrix',
      'swot',
      'canvas',
      'compare',
      'spectrum',
    ])
      expect(kinds).toContain(kind)
  })

  for (const file of files)
    it(`renders ${file} in light, dark and sketch`, async () => {
      const source = readFileSync(join(examples, file), 'utf8')
      const light = await render(source)
      expect(light.svg).toContain('<svg')
      expect(light.width).toBeGreaterThan(200)
      expect(light.svg).not.toMatch(/NaN|undefined/)
      const again = await render(source)
      expect(again.svg).toBe(light.svg)
      const dark = await render(source, { dark: true, look: 'sketch' })
      expect(dark.svg).not.toMatch(/NaN|undefined/)
    })

  it('renders small and edge-case inputs', async () => {
    const sources = [
      'pyramid\n  Only',
      'cycle\n  A\n  B',
      'cycle "Eight"\n  A\n  B\n  C\n  D\n  E\n  F\n  G\n  H',
      'layers style=onion\n  Core',
      'matrix\n  A dot @ 0.5,0.5',
      'swot',
      'compare\n  A\n  B',
      'spectrum Low .. High',
    ]
    for (const source of sources) {
      const result = await tryRender(source)
      expect('svg' in result ? result.svg : result.error).toMatch(/<svg/)
    }
  })

  it('fails clearly on empty templates', async () => {
    for (const source of ['cycle "x"', 'layers', 'matrix', 'canvas', 'compare\n  Only'])
      expect(await tryRender(source)).toHaveProperty('error')
  })
})

describe('text the template parsers keep', () => {
  it('keeps @ and a number where nothing is placed', () => {
    const { model } = parseCanvas('canvas\n  Plan\n    Lunch @ 12\n    user@5x.png')
    expect(model?.regions[0].items.map((i) => [i.label, i.at])).toEqual([
      ['Lunch @ 12', undefined],
      ['user@5x.png', undefined],
    ])
  })

  it('reads a position only at the end of the line', () => {
    const { model } = parseSpectrum('spectrum Cold .. Hot\n  Meet @ 3pm\n  Coach : a note @ 0.4')
    expect(model?.items.map((i) => [i.label, i.note, i.at])).toEqual([
      ['Meet @ 3pm', undefined, undefined],
      ['Coach', 'a note', [0.4]],
    ])
  })

  it("doesn't start a note at a colon inside quotes", () => {
    const { model } = parseCompare('compare\n  "Plan: Pro" : yearly\n    "Ratio: 3"\n  Free')
    expect(model?.columns[0]).toMatchObject({ label: 'Plan: Pro', note: 'yearly' })
    expect(model?.columns[0].items[0]).toMatchObject({ label: 'Ratio: 3', note: undefined })
  })

  it('reads keywords only in lowercase, so capitalized names stay names', () => {
    const cycle = parseCycle('cycle\n  Hub launch\n  Growth\n  hub: Momentum').model
    expect(cycle?.stages.map((s) => s.label)).toEqual(['Hub launch', 'Growth'])
    expect(cycle?.center).toBe('Momentum')
  })

  it('takes "X factor" for a quadrant, not an axis', () => {
    const { model, diagnostics } = parseMatrix('matrix\n  X factor tl\n  x Low .. High')
    expect(diagnostics).toEqual([])
    expect(model?.quadrants.map((q) => [q.label, q.corner])).toEqual([['X factor', 'tl']])
    expect(model?.x).toEqual(['Low', 'High'])
  })
})
