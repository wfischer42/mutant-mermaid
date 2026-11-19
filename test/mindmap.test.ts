import { describe, expect, it } from 'vitest'
import { parseArgue } from '../src/diagrams/mindmap/argue.ts'
import { parseIssues } from '../src/diagrams/mindmap/issues.ts'
import { splitEmoji } from '../src/diagrams/mindmap/label.ts'
import { parseLinkText, parseMindmap } from '../src/diagrams/mindmap/mindmap.ts'
import { splitPoint } from '../src/diagrams/mindmap/mindmap-layout.ts'
import { cleanLabel, stripShape } from '../src/diagrams/mindmap/outline.ts'
import { type Tidy, tidy } from '../src/diagrams/mindmap/tidy.ts'
import { render, tryRender } from '../src/index.ts'

describe('outline helpers', () => {
  it('strips Mermaid node shapes', () => {
    expect(stripShape('root((Big idea))')).toBe('Big idea')
    expect(stripShape('id[Square]')).toBe('Square')
    expect(stripShape('id(Rounded)')).toBe('Rounded')
    expect(stripShape('id{{Hexagon}}')).toBe('Hexagon')
    expect(stripShape('id))Bang((')).toBe('Bang')
    expect(stripShape('id)Cloud(')).toBe('Cloud')
    expect(stripShape('[Bare square]')).toBe('Bare square')
    expect(stripShape('Kyoto (Gion)')).toBe('Kyoto (Gion)')
    expect(stripShape('a["`Markdown`"]')).toBe('Markdown')
  })

  it('drops icons and classes but keeps colors and emoji', () => {
    const clean = cleanLabel('🏯 Kyoto ::icon(fa fa-torii) #coral')
    expect(clean.label).toBe('🏯 Kyoto')
    expect(clean.color).toBe('coral')
    expect(cleanLabel('id[Urgent]:::hot big').label).toBe('Urgent')
  })

  it('splits a leading emoji off a label', () => {
    expect(splitEmoji('🏯 Kyoto')).toEqual({ emoji: '🏯', rest: 'Kyoto' })
    expect(splitEmoji('Kyoto')).toEqual({ emoji: '', rest: 'Kyoto' })
  })
})

describe('tidy layout', () => {
  interface N extends Tidy<N> {
    name: string
  }
  const node = ({ name, lo, children = [] }: { name: string; lo: number; children?: N[] }): N => ({
    name,
    lo,
    hi: lo + 10,
    size: 20,
    children,
    offset: 0,
    center: 0,
  })

  it('keeps siblings apart and centres parents on their children', () => {
    const a = node({ name: 'a', lo: 20 })
    const b = node({ name: 'b', lo: 20 })
    const c = node({ name: 'c', lo: 20 })
    const root = node({ name: 'r', lo: 0, children: [a, b, c] })
    tidy({ root, gap: () => 10 })
    expect(b.center - a.center).toBe(30)
    expect(c.center - b.center).toBe(30)
    expect(b.center).toBe(0)
  })

  it('lets a shallow subtree tuck beside a deep one', () => {
    const deep = node({
      name: 'deep',
      lo: 20,
      children: [node({ name: 'x', lo: 40 }), node({ name: 'y', lo: 40 })],
    })
    const shallow = node({ name: 'shallow', lo: 20 })
    const root = node({ name: 'r', lo: 0, children: [deep, shallow] })
    tidy({ root, gap: () => 10 })
    expect(shallow.center - deep.center).toBe(30)
  })
})

describe('mindmap', () => {
  it('reads a titled outline with colors and cross-links', () => {
    const { model, diagnostics } = parseMindmap(
      'mindmap "Trip" layout=right\n  Kyoto #coral\n    Gion\n  Tokyo\n~ Gion -- "near" --> Tokyo',
    )
    expect(diagnostics).toEqual([])
    expect(model?.root.label).toBe('Trip')
    expect(model?.root.children.map((c) => c.label)).toEqual(['Kyoto', 'Tokyo'])
    expect(model?.root.children[0].color).toBe('coral')
    expect(model?.layout).toBe('right')
    expect(model?.links).toHaveLength(1)
    expect(model?.links[0].from.label).toBe('Gion')
    expect(model?.links[0].label).toBe('near')
  })

  it("reads Mermaid's own mindmap syntax", () => {
    const { model, diagnostics } = parseMindmap(
      'mindmap\n  root((Ideas))\n    a[One]\n      ::icon(fa fa-book)\n      b(Two)\n    c{{Three}}:::urgent',
    )
    expect(diagnostics).toEqual([])
    expect(model?.root.label).toBe('Ideas')
    expect(model?.root.children.map((c) => c.label)).toEqual(['One', 'Three'])
    expect(model?.root.children[0].children.map((c) => c.label)).toEqual(['Two'])
  })

  it('parses cross-link variants', () => {
    expect(parseLinkText('A --> B')).toEqual({ from: 'A', to: 'B', label: '', both: false })
    expect(parseLinkText('A <--> B : feeds')).toEqual({
      from: 'A',
      to: 'B',
      label: 'feeds',
      both: true,
    })
    expect(parseLinkText('no arrow here')).toBeNull()
  })

  it('keeps a node name with " - " or " : " in it whole', () => {
    const { model, diagnostics } = parseMindmap(
      [
        'mindmap "T"',
        '  Plan - B',
        '  Q3 : launch',
        '  X',
        '~ Plan - B --> X',
        '~ X --> Q3 : launch',
        '~ X -- "backs" --> Plan - B',
      ].join('\n'),
    )
    expect(diagnostics).toEqual([])
    expect(model?.links.map((l) => [l.from.label, l.to.label, l.label])).toEqual([
      ['Plan - B', 'X', ''],
      ['X', 'Q3 : launch', ''],
      ['X', 'Plan - B', 'backs'],
    ])
  })

  it('gives the root the header color and flags', () => {
    const { model } = parseMindmap('mindmap "Topic" #coral !key\n  One')
    expect(model?.root.color).toBe('coral')
    expect(parseIssues('issues "Q?" #violet !key\n  A').model?.root).toMatchObject({
      color: 'violet',
      key: true,
    })
  })

  it('warns about cross-links to unknown nodes', () => {
    const { model, diagnostics } = parseMindmap('mindmap "T"\n  A\n~ A --> Nowhere')
    expect(model?.links).toHaveLength(0)
    expect(diagnostics[0]).toMatchObject({ line: 3, severity: 'warning' })
    expect(diagnostics[0].message).toMatch(/Nowhere/)
  })

  it('fails clearly when empty', async () => {
    const result = await tryRender('mindmap')
    expect('error' in result && result.error).toMatch(/line 1/)
  })

  it('balances branches by leaf count', () => {
    expect(splitPoint({ weights: [3, 1, 1, 1] })).toBe(1)
    expect(splitPoint({ weights: [1, 1, 1, 1] })).toBe(2)
    expect(splitPoint({ weights: [5] })).toBe(1)
  })

  it('renders deterministically, without NaN', async () => {
    const source =
      'mindmap "Trip"\n  Kyoto\n    Gion\n    Arashiyama\n  Tokyo\n  Food\n~ Gion --> Tokyo'
    const a = await render(source)
    const b = await render(source, { dark: true })
    expect(a.kind).toBe('mindmap')
    expect(a.svg).toBe((await render(source)).svg)
    expect(a.svg).not.toMatch(/NaN|Infinity/)
    expect(b.svg).not.toMatch(/NaN|Infinity/)
    expect(a.svg).toContain('Arashiyama')
  })

  it('renders in the sketch look', async () => {
    const result = await render('---\nlook: sketch\n---\nmindmap "T"\n  A\n    B\n  C')
    expect(result.svg).not.toMatch(/NaN/)
  })
})

describe('argue', () => {
  it('reads support, attack and questions', () => {
    const { model, diagnostics } = parseArgue(
      'argue "Claim"\n  + For\n    - Against that\n  ? Why\n  Plain',
    )
    expect(model?.root.relation).toBe('claim')
    expect(model?.root.children.map((c) => c.relation)).toEqual(['support', 'question', 'note'])
    expect(model?.root.children[0].children[0]).toMatchObject({
      label: 'Against that',
      relation: 'attack',
    })
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].line).toBe(5)
  })

  it('takes the first line as the claim when the header has no title', () => {
    const { model } = parseArgue('argue\n  Claim\n    + Reason')
    expect(model?.root.label).toBe('Claim')
    expect(model?.root.children[0].relation).toBe('support')
  })

  it('renders cards and badges', async () => {
    const result = await render('argue "C"\n  + A reason\n  - An objection')
    expect(result.kind).toBe('argue')
    expect(result.svg).toContain('An objection')
    expect(result.svg).not.toMatch(/NaN/)
  })
})

describe('issues', () => {
  it('reads flags and colors', () => {
    const { model } = parseIssues(
      'issues "Why?"\n  Revenue #teal\n    Price !hypothesis\n  Costs !key',
    )
    expect(model?.root.children[0].color).toBe('teal')
    expect(model?.root.children[0].children[0].hypothesis).toBe(true)
    expect(model?.root.children[1].key).toBe(true)
  })

  it('renders under both keywords', async () => {
    const a = await render('issues "Q"\n  A\n    A1\n  B')
    const b = await render('tree "Q"\n  A\n    A1\n  B')
    expect(a.kind).toBe('issues')
    expect(b.kind).toBe('issues')
    expect(a.svg).not.toMatch(/NaN/)
  })
})
