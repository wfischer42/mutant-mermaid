import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { profiling, span } from '../src/core/profile.ts'
import { inside, insideRow, rowCrossings } from '../src/diagrams/systems/cld-spots.ts'
import { render } from '../src/index.ts'

describe('profiling', () => {
  it('times spans only while collecting', async () => {
    expect(span('idle', () => 2)).toBe(2)
    const { result, totals } = await profiling(async () =>
      span('outer', () => span('inner', () => 3)),
    )
    expect(result).toBe(3)
    expect(Object.keys(totals).sort()).toEqual(['inner', 'outer'])
    expect(totals.outer).toBeGreaterThanOrEqual(totals.inner)
  })

  it('counts an async span until it settles', async () => {
    const { totals } = await profiling(() =>
      span('wait', () => new Promise((done) => setTimeout(done, 20))),
    )
    expect(totals.wait).toBeGreaterThanOrEqual(15)
  })

  it('collects the phases of a render', async () => {
    const source = readFileSync('examples/systems/cld-fixes-that-fail.mmd', 'utf8')
    const { totals } = await profiling(() => render(source))
    expect(Object.keys(totals)).toEqual(
      expect.arrayContaining(['parse', 'draw', 'cld:layout', 'cld:untangle', 'cld:place']),
    )
  })
})

describe('row crossings', () => {
  it('agree with the point-in-polygon test', () => {
    const star = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 40 : 100
      const angle = (i / 10) * Math.PI * 2
      return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
    })
    for (let y = -110; y <= 110; y += 7) {
      const xs = rowCrossings({ polygon: star, y })
      for (let x = -110; x <= 110; x += 7)
        expect(insideRow({ xs, x })).toBe(inside({ p: { x, y }, polygon: star }))
    }
  })
})
