import { describe, expect, it } from 'vitest'
import { BUILT_IN } from '../src/diagrams/index.ts'
import { analyse } from '../src/diagrams/systems/cld.ts'
import { parseSystems } from '../src/diagrams/systems/parse.ts'
import { diagramTypes, guide, render } from '../src/index.ts'

describe('guide', () => {
  it('lists every type in the catalog', () => {
    const text = guide() ?? ''
    for (const type of diagramTypes()) expect(text).toContain(`\`${type.keywords[0]}\``)
  })

  it('gives a type its syntax and example, by any of its keywords', () => {
    const text = guide('causal') ?? ''
    expect(text).toContain('# Causal loop diagram')
    expect(text).toContain('## Syntax')
    expect(text).toContain('cld "Product adoption"')
  })

  it('finds mixed-case keywords in any case', () => {
    expect(guide('stateDiagram-v2')).toContain('## Syntax')
    expect(guide('STATEDIAGRAM')).toContain('## Syntax')
  })

  it('returns null for a keyword no type claims', () => {
    expect(guide('nope')).toBeNull()
  })

  it('has a guide for every type', () => {
    expect(BUILT_IN.filter((type) => !type.guide).map((type) => type.id)).toEqual([])
  })

  it('has examples that render without warnings, as their own type', async () => {
    for (const type of BUILT_IN.filter((t) => t.guide)) {
      const { kind, diagnostics } = await render(type.guide?.example.trim() ?? '')
      expect(kind, type.id).toBe(type.id)
      expect(diagnostics, type.id).toEqual([])
    }
  })
})

describe('cld guide', () => {
  it('returns loop warnings from render, where an agent can see them', async () => {
    const { diagnostics } = await render(
      ['cld', '  A -> B : +', '  B -> A : +', '  loop B "Brake"'].join('\n'),
    )
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Loop "Brake" is declared balancing, but its links (A → B) make it reinforcing.',
    ])
  })

  it('returns stock & flow loop warnings too, with flows counted on the loop', async () => {
    const { diagnostics } = await render(
      [
        'stockflow',
        '  stock Population',
        '  flow births : -> Population',
        '  Population -> births : +',
        '  loop B "Growth": Population, births',
      ].join('\n'),
    )
    expect(diagnostics.map((d) => d.message)).toEqual([
      'Loop "Growth" is declared balancing, but its links (Population → births) make it reinforcing.',
    ])
  })

  it('names the loops it declares, with the kinds its links give', () => {
    const { model } = parseSystems(
      BUILT_IN.find((t) => t.id === 'cld')?.guide?.example.trim() ?? '',
    )
    if (!model) throw new Error('example did not parse')
    const { loops, diagnostics } = analyse(model)
    expect(diagnostics).toEqual([])
    expect(loops.map((l) => `${l.tag} ${l.name}`)).toEqual([
      'R1 Word of mouth',
      'B1 Market saturation',
    ])
  })
})
