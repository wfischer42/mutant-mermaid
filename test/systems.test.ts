import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chooseLoops, classify, findCycles } from '../src/diagrams/systems/cycles.ts'
import type { Link } from '../src/diagrams/systems/model.ts'
import { parseSystems } from '../src/diagrams/systems/parse.ts'
import { flowLinks } from '../src/diagrams/systems/stockflow.ts'
import { causalLoop } from '../src/diagrams/systems/systems.ts'
import { render } from '../src/index.ts'

function link({
  from,
  to,
  polarity = '+',
}: {
  from: string
  to: string
  polarity?: '+' | '-'
}): Link {
  return { from, to, polarity, delay: false, line: 1 }
}

/** The two centers an arc of radius r through (x0, y0) and (x1, y1) could have. */
function centers([x0, y0, r, x1, y1]: number[]): { options: { x: number; y: number }[] } {
  const half = Math.hypot(x1 - x0, y1 - y0) / 2
  const d = Math.sqrt(Math.max(0, r * r - half * half))
  const ux = (y0 - y1) / (2 * half)
  const uy = (x1 - x0) / (2 * half)
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  return { options: [1, -1].map((s) => ({ x: mx + s * d * ux, y: my + s * d * uy })) }
}

describe('parsing', () => {
  it('reads every polarity spelling, delays and quoted names', () => {
    const { model, diagnostics } = parseSystems(
      [
        'cld "Adoption"',
        '  "Word of mouth" -> Sales : +',
        '  Sales -> "Word of mouth" : s ||',
        '  Sales -> Saturation -',
        '  Saturation -> Sales : opposite delay',
        '  A -> B : o',
      ].join('\n'),
    )
    expect(diagnostics).toEqual([])
    expect(model?.title).toBe('Adoption')
    expect(model?.mode).toBe('cld')
    expect(model?.links.map((l) => [l.from, l.to, l.polarity, l.delay])).toEqual([
      ['Word of mouth', 'Sales', '+', false],
      ['Sales', 'Word of mouth', '+', true],
      ['Sales', 'Saturation', '-', false],
      ['Saturation', 'Sales', '-', true],
      ['A', 'B', '-', false],
    ])
  })

  it('reads kinds and trends, and warns about names that are no variable', () => {
    const { model, diagnostics } = parseSystems(
      [
        'cld',
        '  A -> B : +',
        '  B -> A : +',
        '  kind Market: A, "B"',
        '  kind Market: Ghost',
        '  trend A: logistic',
        '  trend R1: oscillate',
        '  Kind words -> A : +',
      ].join('\n'),
    )
    expect(model?.kinds).toEqual([{ name: 'Market', members: ['A', 'B', 'Ghost'] }])
    expect(model?.trends).toEqual({ A: 's-curve', R1: 'oscillate' })
    expect(model?.links).toHaveLength(3)
    expect(diagnostics.map((d) => d.message)).toEqual([
      `"Ghost" isn't a variable in this diagram, so nothing is marked.`,
    ])
  })

  it('reads a variable named like a keyword as a link', () => {
    const { model, diagnostics } = parseSystems('cld\n  Rate -> Stock : +\n  Loop -> Rate : -')
    expect(diagnostics).toEqual([])
    expect(model?.links).toHaveLength(2)
  })

  it('reads loop declarations, pinned or not', () => {
    const { model } = parseSystems(
      'cld\n  A -> B : +\n  loop R "Growth"\n  loop B2 "Limit": A, "Big B"',
    )
    expect(model?.loops).toEqual([
      { kind: 'R', number: null, name: 'Growth', members: [], line: 3 },
      { kind: 'B', number: 2, name: 'Limit', members: ['A', 'Big B'], line: 4 },
    ])
  })

  it('warns about a link without polarity and fails on nonsense', () => {
    const missing = parseSystems('cld\n  A -> B')
    expect(missing.diagnostics[0]).toMatchObject({ line: 2, severity: 'warning' })
    const broken = parseSystems('cld\n  just words')
    expect(broken.diagnostics[0]).toMatchObject({ line: 2, severity: 'error' })
  })

  it('reads stocks, flows with clouds and auxiliaries', () => {
    const { model } = parseSystems(
      'stockflow\n  stock Population\n  flow births : cloud -> Population\n  flow deaths : Population -> cloud\n  aux birth_rate\n  birth_rate -> births',
    )
    expect(model?.mode).toBe('stockflow')
    expect(model?.stocks).toEqual(['Population'])
    expect(model?.flows.map((f) => [f.id, f.from, f.to])).toEqual([
      ['births', null, 'Population'],
      ['deaths', 'Population', null],
    ])
    expect(model?.labels.birth_rate).toBe('birth rate')
  })
})

describe('loop analysis', () => {
  it('finds each elementary cycle once', () => {
    const links = [
      link({ from: 'A', to: 'B' }),
      link({ from: 'B', to: 'A' }),
      link({ from: 'B', to: 'C' }),
      link({ from: 'C', to: 'A' }),
      link({ from: 'C', to: 'D' }),
    ]
    const cycles = findCycles({ nodes: ['A', 'B', 'C', 'D'], links })
    expect(cycles.map((c) => c.nodes.join(''))).toEqual(['AB', 'ABC'])
  })

  it('classifies by the count of negative links', () => {
    expect(classify(['+', '+'])).toBe('R')
    expect(classify(['+', '-'])).toBe('B')
    expect(classify(['-', '-'])).toBe('R')
    expect(classify(['-', '-', '-'])).toBe('B')
    expect(classify(['+', '?'])).toBeNull()
  })

  it('names declared loops in order and auto-labels the rest', () => {
    const links = [
      link({ from: 'A', to: 'B' }),
      link({ from: 'B', to: 'A' }),
      link({ from: 'B', to: 'C' }),
      link({ from: 'C', to: 'B', polarity: '-' }),
      link({ from: 'C', to: 'D' }),
      link({ from: 'D', to: 'C' }),
    ]
    const cycles = findCycles({ nodes: ['A', 'B', 'C', 'D'], links })
    const decls = [{ kind: 'B' as const, number: null, name: 'Limit', members: [], line: 9 }]
    const { loops, diagnostics } = chooseLoops({ cycles, links, decls })
    expect(diagnostics).toEqual([])
    expect(loops.map((l) => [l.tag, l.name, l.cycle.nodes.join('')])).toEqual([
      ['B1', 'Limit', 'BC'],
      ['R1', '', 'AB'],
      ['R2', '', 'CD'],
    ])
  })

  it('warns when a declared type disagrees with the links', () => {
    const links = [link({ from: 'A', to: 'B' }), link({ from: 'B', to: 'A', polarity: '-' })]
    const cycles = findCycles({ nodes: ['A', 'B'], links })
    const decls = [{ kind: 'R' as const, number: 1, name: 'Oops', members: ['A', 'B'], line: 4 }]
    const { loops, diagnostics } = chooseLoops({ cycles, links, decls })
    expect(loops[0].kind).toBe('B')
    expect(diagnostics[0]).toMatchObject({ line: 4, severity: 'warning' })
    expect(diagnostics[0].message).toMatch(/balancing/)
  })

  it('warns that a diagram with too many loops round one hub should be split', () => {
    const petal = (i: number) => [`  H -> A${i} : +`, `  A${i} -> B${i} : +`, `  B${i} -> H : +`]
    const source = (n: number) =>
      ['cld "Hub"', ...Array.from({ length: n }, (_, i) => petal(i)).flat()].join('\n')
    const warnings = (n: number) =>
      causalLoop.parse(source(n)).diagnostics.filter((d) => /Split it/.test(d.message))
    expect(warnings(4)).toHaveLength(0)
    expect(warnings(5)[0]?.message).toMatch(/5 loops through "H" \(keep to 4\)/)
  })

  it('reads stock and flow structure as causal links', () => {
    const { model } = parseSystems(
      'stockflow\n  flow births : cloud -> P\n  flow deaths : P -> cloud\n  P -> births : +\n  P -> deaths : +',
    )
    if (!model) throw new Error('no model')
    const links = flowLinks(model)
    const kinds = findCycles({ nodes: model.variables, links }).map((c) => c.kind)
    expect(kinds.sort()).toEqual(['B', 'R'])
  })
})

describe('rendering', () => {
  const cld =
    'cld "Adoption"\n  Adopters -> WoM : +\n  WoM -> Rate : +\n  Rate -> Adopters : +\n  Potential -> Rate : +\n  Rate -> Potential : -'
  const sfd =
    'stockflow "Pop"\n  stock Population\n  flow births : cloud -> Population\n  aux rate\n  rate -> births : +\n  Population -> births : +'

  it('draws a causal loop diagram deterministically', async () => {
    const a = await render(cld)
    const b = await render(cld)
    expect(a.svg).toBe(b.svg)
    expect(a.kind).toBe('cld')
    expect(a.svg).toContain('data-mm-id="R1"')
    expect(a.svg).toContain('data-mm-id="B1"')
    expect(a.svg.match(/stroke-dasharray="0 6"/g)).toHaveLength(1)
  })

  it('draws a two-variable loop as a circle touching the loop it shares a variable with', async () => {
    const { svg } = await render(cld)
    const arcs = [
      ...svg.matchAll(
        /<path d="M(\S+) (\S+)A(\S+) \S+ 0 [01] [01] (\S+) (\S+)" fill="none" stroke="([^"]+)" stroke-width="(?:2|2\.6)" stroke-linecap/g,
      ),
    ].map(([, x0, y0, r, x1, y1, stroke]) => ({ stroke, r: Number(r), ...centers([x0, y0, r, x1, y1].map(Number)) }))
    const loops = [...new Set(arcs.map((arc) => arc.stroke))].map((stroke) => {
      const [a, b] = arcs.filter((arc) => arc.stroke === stroke)
      const center = a.options.find((c) => b.options.some((d) => Math.hypot(c.x - d.x, c.y - d.y) < 0.5))
      expect(center).toBeDefined()
      return { r: a.r, center: center ?? { x: 0, y: 0 } }
    })
    expect(loops).toHaveLength(2)
    const [one, two] = loops
    const apart = Math.hypot(one.center.x - two.center.x, one.center.y - two.center.y)
    expect(apart).toBeCloseTo(one.r + two.r, 0)
  })

  it('draws a loop that shares one link with a primary circle as its mirror image', async () => {
    const tragedy = [
      'cld "Commons"',
      "  A -> AG : +",
      "  AG -> A : +",
      "  B -> BG : +",
      "  BG -> B : +",
      '  A -> Total : +',
      '  B -> Total : +',
      '  Total -> Res : -',
      '  Res -> AG : +',
      '  Res -> BG : +',
    ].join('\n')
    const { svg } = await render(tragedy)
    const radius = new Map(
      [...svg.matchAll(/data-mm-id="([^"]+)" data-mm-kind="link"[^>]*><path d="M\S+ \S+A(\S+) /g)].map(
        ([, id, r]) => [id.replace('-&gt;', '->'), r],
      ),
    )
    const both = ['A->Total', 'Total->Res', 'Res->AG', 'B->Total', 'Res->BG']
    expect(new Set(both.map((id) => radius.get(id))).size).toBe(1)
  })

  it('fans loops that share only a hub out round it as petals, none thrown far off', async () => {
    const petals = [
      ['Infrastructure ownership', 'Captured surplus', '+'],
      ['Narrative control', 'Perceived legitimacy', '+'],
      ['Feedback visibility', 'Corrective pressure', '-'],
      ["Alternatives' substrate access", 'Viable alternatives', '-'],
    ]
    const source = [
      'cld "Compound attractor"',
      ...petals.flatMap(([a, b, sign]) => [
        `  "Concentrated control" -> "${a}" : ${sign}`,
        `  "${a}" -> "${b}" : +`,
        `  "${b}" -> "Concentrated control" : ${sign}`,
      ]),
    ].join('\n')
    const { svg } = await render(source)
    const [, , w, h] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map(Number)
    expect(Math.max(w, h)).toBeLessThan(800)
  })

  it('rounds a loop whose variables nearly lie on a circle onto one', async () => {
    const source = readFileSync('examples/systems/cld-city.mmd', 'utf8')
    const { svg } = await render(source)
    const dot = (id: string) => {
      const m = new RegExp(`data-mm-id="${id}"[^>]*><circle cx="([-\\d.]+)" cy="([-\\d.]+)"`).exec(svg)
      return { x: Number(m?.[1]), y: Number(m?.[2]) }
    }
    const [a, b, c] = ['Housing demand', 'House prices', 'Construction'].map(dot)
    const d1 = a.x * a.x + a.y * a.y
    const d2 = b.x * b.x + b.y * b.y
    const d3 = c.x * c.x + c.y * c.y
    const det = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
    const center = {
      x: (d1 * (b.y - c.y) + d2 * (c.y - a.y) + d3 * (a.y - b.y)) / det,
      y: (d1 * (c.x - b.x) + d2 * (a.x - c.x) + d3 * (b.x - a.x)) / det,
    }
    const r = Math.hypot(a.x - center.x, a.y - center.y)
    const ids = ['Housing demand-&gt;House prices', 'House prices-&gt;Construction', 'Construction-&gt;Housing demand']
    const radii = ids.map((id) => Number(new RegExp(`data-mm-id="${id}"[^>]*><path d="M[-\\d. ]+A([\\d.]+)`).exec(svg)?.[1]))
    for (const rx of radii) expect(Math.abs(rx - r)).toBeLessThan(2)
  })

  it('warns when the drawing comes out tangled, naming the link and what it runs through', async () => {
    const tangled = await render(`cld
  "Demand" -> "Prices" : +
  "Prices" -> "Pollution" : -
  "Pollution" -> "Demand" : +
  "Prices" -> "Market share" : +
  "Market share" -> "Investment" : +
  "Investment" -> "Demand" : +
  "Prices" -> "Investment" : -`)
    expect(tangled.diagnostics.map((d) => d.message).join()).toContain(
      'Prices → Investment runs through "Market share"',
    )
    const clean = await render(cld)
    expect(clean.diagnostics.filter((d) => d.message.includes('tangled'))).toEqual([])
  })

  it('keeps a hemmed-in variable label beside its own dot, not out past the loops', async () => {
    const { svg } = await render(`cld
  "Word of mouth" -> "Housing stock" : +
  "Housing stock" -> "Road building" : +
  "Road building" -> "Burnout" : +
  "Burnout" -> "Word of mouth" : -
  "Housing stock" -> "Wages" : +
  "Wages" -> "Burnout" : +
  "Wages" -> "Tax base" : -
  "Tax base" -> "Housing stock" : +
  "Housing stock" -> "Burnout" : +`)
    const variable =
      /data-mm-id="([^"]+)" data-mm-kind="variable"[^>]*><circle cx="([-\d.]+)" cy="([-\d.]+)"[^>]*\/><text[^>]*text-anchor="(\w+)"><tspan x="([-\d.]+)" y="([-\d.]+)">/g
    const shift: Record<string, number> = { start: 0, middle: 0.5, end: 1 }
    const gaps = [...svg.matchAll(variable)].map((m) => {
      const [x, y, tx, ty] = [m[2], m[3], m[5], m[6]].map(Number)
      const w = m[1].length * 7.5
      const left = tx - w * shift[m[4]]
      const nx = Math.max(left, Math.min(x, left + w))
      const ny = Math.max(ty - 13, Math.min(y, ty + 4))
      return Math.hypot(nx - x, ny - y)
    })
    expect(gaps).toHaveLength(6)
    expect(Math.max(...gaps)).toBeLessThan(36)
  })

  it('nests two loops that share a path through one variable like a yin-yang', async () => {
    const { svg } = await render(`cld
  Power -> Enclosure : +
  Enclosure -> Commons : -
  Commons -> Counter : +
  Counter -> Power : -
  Commons -> Access : +
  Access -> Power : -`)
    const dot = (id: string) => {
      const m = new RegExp(`data-mm-id="${id}"[^>]*><circle cx="([-\\d.]+)" cy="([-\\d.]+)"`).exec(svg)
      return { x: Number(m?.[1]), y: Number(m?.[2]) }
    }
    const [power, middle, commons, counter, access] = ['Power', 'Enclosure', 'Commons', 'Counter', 'Access'].map(dot)
    const center = { x: (power.x + commons.x) / 2, y: (power.y + commons.y) / 2 }
    const r = Math.hypot(power.x - center.x, power.y - center.y)
    expect(Math.hypot(middle.x - center.x, middle.y - center.y)).toBeLessThan(1)
    for (const p of [counter, access]) expect(Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r)).toBeLessThan(1)
    const radius = (id: string) =>
      Number(new RegExp(`data-mm-id="${id}"[^>]*><path d="M[-\\d. ]+A([\\d.]+)`).exec(svg)?.[1])
    expect(Math.abs(radius('Power-&gt;Enclosure') - r / 2)).toBeLessThan(r * 0.15)
    expect(Math.abs(radius('Enclosure-&gt;Commons') - r / 2)).toBeLessThan(r * 0.15)
  })

  it('fills kinds with a legend, and sketches trends on variables and every loop', async () => {
    const { svg } = await render(`${cld}\n  kind Market: Potential, Rate\n  trend Adopters: s-curve`)
    expect(svg).toContain('class="legend"')
    expect(svg).toContain('>Market<')
    expect(svg.match(/class="trend"/g)).toHaveLength(3)
    const plain = await render(cld)
    expect(plain.svg).not.toContain('class="legend"')
    expect(plain.svg.match(/class="trend"/g)).toHaveLength(2)
  })

  it('draws a stock and flow deterministically', async () => {
    const a = await render(sfd, { dark: true })
    const b = await render(sfd, { dark: true })
    expect(a.svg).toBe(b.svg)
    expect(a.kind).toBe('stockflow')
    expect(a.svg).toContain('class="stock"')
    expect(a.svg).toContain('data-mm-id="R1"')
    expect(a.svg).not.toContain('>R1<')
  })

  it('draws a stock and flow loop through an aux on one circle', async () => {
    const source = [
      'stockflow',
      '  stock Prospects',
      '  stock Customers',
      '  flow acquisition : Prospects -> Customers',
      '  Customers -> referrals : +',
      '  referrals -> acquisition : +',
      '  Customers -> acquisition : -',
    ].join('\n')
    const { svg } = await render(source)
    const radius = new Map(
      [...svg.matchAll(/data-mm-id="([^"]+)" data-mm-kind="link"[^>]*><path d="M\S+ \S+A(\S+) /g)].map(
        ([, id, r]) => [id.replace('-&gt;', '->'), Number(r)],
      ),
    )
    expect(radius.get('Customers->referrals')).toBeCloseTo(radius.get('referrals->acquisition') ?? 0, 0)
    expect(svg.match(/stroke-dasharray="0 6"/g)).toHaveLength(1)
  })

  it('draws delay ticks on a stock and flow link', async () => {
    const paths = (svg: string) => (svg.match(/<path/g) ?? []).length
    const plain = await render(sfd)
    const delayed = await render(sfd.replace('rate -> births : +', 'rate -> births : + ||'))
    expect(paths(delayed.svg)).toBeGreaterThan(paths(plain.svg))
  })

  it('draws a cloud-to-cloud flow as an aux, and warns', async () => {
    const { model, diagnostics } = parseSystems(
      'stockflow\n  stock Water\n  flow rain : cloud -> Water\n  flow wind : cloud -> cloud',
    )
    expect(model?.flows.map((f) => f.id)).toEqual(['rain'])
    expect(model?.auxes).toEqual(['wind'])
    expect(diagnostics.map((d) => [d.line, d.severity])).toEqual([[4, 'warning']])
  })

  it('switches to stock and flow when a cld declares stocks', async () => {
    const result = await render('cld\n  stock Water\n  flow rain : cloud -> Water')
    expect(result.svg).toContain('class="flow"')
  })
})
