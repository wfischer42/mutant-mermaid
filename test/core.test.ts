import { describe, expect, it } from 'vitest'
import { frontmatter, indentTree, labeled, readLines, splitNote } from '../src/core/parse.ts'
import { headingCss } from '../src/core/svg.ts'
import { textKit } from '../src/core/text.ts'
import { render, resolveTheme, tryRender } from '../src/index.ts'

describe('parse helpers', () => {
  it('splits trailing attributes off a label', () => {
    const parsed = labeled('Food & drink #coral weight=2 !major :::hot')
    expect(parsed.label).toBe('Food & drink')
    expect(parsed.color).toBe('coral')
    expect(parsed.attrs).toEqual({ weight: '2' })
    expect([...parsed.flags]).toEqual(['major'])
    expect(parsed.classes).toEqual(['hot'])
  })

  it('keeps # and = inside a label', () => {
    expect(labeled('C# basics').label).toBe('C# basics')
    expect(labeled('#e4572e').color).toBe('#e4572e')
    expect(labeled('Tea #e4572e').color).toBe('#e4572e')
  })

  it('reads a trailing #word as a color only when it names one', () => {
    expect(labeled('Ship #launch').label).toBe('Ship #launch')
    expect(labeled('Ship #launch').color).toBeUndefined()
    const flagged = labeled('Ship #launch !major')
    expect(flagged.label).toBe('Ship #launch')
    expect([...flagged.flags]).toEqual(['major'])
    expect(labeled('Issue #482').label).toBe('Issue #482')
    expect(labeled('Tea #fff')).toMatchObject({ label: 'Tea', color: '#fff' })
    expect(labeled('Tea #Coral')).toMatchObject({ label: 'Tea', color: 'Coral' })
  })

  it('splits a note at the first colon outside quotes', () => {
    expect(splitNote('"Ratio: 3" : the note')).toEqual(['"Ratio: 3"', 'the note'])
    expect(splitNote('"Ratio: 3"')).toBeNull()
    expect(splitNote('12:30 standup')).toBeNull()
  })

  it('nests lines by indentation and drops comments', () => {
    const tree = indentTree(readLines('root\n  a %% note\n    b\n  c\n%% gone'))
    expect(tree).toHaveLength(1)
    expect(tree[0].children.map((c) => c.line.text)).toEqual(['a', 'c'])
    expect(tree[0].children[0].children[0].line.no).toBe(3)
  })

  it('reads frontmatter and keeps line numbers', () => {
    const { values, body } = frontmatter('---\ntheme: dusk\nlook: sketch\n---\npyramid\n  A')
    expect(values).toEqual({ theme: 'dusk', look: 'sketch' })
    expect(readLines(body)[0].no).toBe(5)
  })
})

describe('text', () => {
  it('measures wider text as wider, bold wider than regular', () => {
    const kit = textKit({ font: 'nunito', family: 'Nunito' })
    const a = kit.width('Hello', { size: 14 })
    expect(a).toBeGreaterThan(20)
    expect(kit.width('Hello world', { size: 14 })).toBeGreaterThan(a)
    expect(kit.width('Hello', { size: 14, weight: 800 })).toBeGreaterThan(a)
  })

  it('wraps to a maximum width', () => {
    const kit = textKit({ font: 'nunito', family: 'Nunito' })
    const lines = kit.wrap('the quick brown fox jumps over the lazy dog', { size: 14, max: 100 })
    expect(lines.length).toBeGreaterThan(2)
    for (const line of lines) expect(kit.width(line, { size: 14 })).toBeLessThanOrEqual(100)
  })

  it('measures heading weights in the heading font', () => {
    const plain = textKit({ font: 'inter', family: 'Inter' })
    const paired = textKit({ font: 'inter', family: 'Inter', heading: 'source-sans' })
    const style = { size: 14, weight: 700 }
    expect(paired.width('Heading', style)).not.toBe(plain.width('Heading', style))
    expect(paired.width('Body', { size: 14 })).toBe(plain.width('Body', { size: 14 }))
  })
})

describe('headingCss', () => {
  it('sets heading-weight text in the heading family, and nothing when they match', () => {
    expect(headingCss({ family: 'Inter', heading: 'Figtree' })).toContain('text[font-weight="700"]')
    expect(headingCss({ family: 'Inter', heading: 'Inter' })).toBe('')
  })
})

describe('render', () => {
  it('renders a pyramid deterministically', async () => {
    const source = 'pyramid "Needs"\n  Top\n  Middle\n  Bottom'
    const a = await render(source)
    const b = await render(source)
    expect(a.svg).toBe(b.svg)
    expect(a.svg).toContain('<svg')
    expect(a.kind).toBe('pyramid')
  })

  it('says what is wrong, with a line number', async () => {
    const result = await tryRender('pyramid "Empty"')
    expect('error' in result && result.error).toMatch(/line 1/)
    const unknown = await tryRender('nonsense\n  a')
    expect('error' in unknown && unknown.error).toMatch(/No diagram type called "nonsense"/)
  })

  it('resolves every preset in light and dark', () => {
    for (const theme of [
      'meadow',
      'ink',
      'dusk',
      'paper',
      'candy',
      'midnight',
      'carbon',
      'stark',
      'neon',
    ])
      for (const dark of [false, true]) {
        const tokens = resolveTheme({ theme, dark })
        expect(tokens.bg).toMatch(/^#[0-9a-f]{6}$/)
        expect(tokens.palette).toHaveLength(8)
      }
  })
})
