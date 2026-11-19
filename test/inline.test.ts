import { describe, expect, it } from 'vitest'
import { inlineImg } from '../src/inline.ts'
import { renderAuto } from '../src/node.ts'

const SOURCE = `stockflow "Community space membership"
  stock Visitors
  stock Members
  flow arrivals : cloud -> Visitors
  flow joining : Visitors -> Members
  flow leaving : Members -> cloud
  aux events
  aux word_of_mouth
  aux crowding
  events -> arrivals : +
  Members -> word_of_mouth : +
  word_of_mouth -> arrivals : +
  Visitors -> joining : +
  Members -> events : +
  Members -> crowding : +
  crowding -> leaving : +
  loop R "Word of mouth": Members, word_of_mouth, arrivals, Visitors, joining
  loop B "Crowding": Members, crowding, leaving`

describe('inlineImg', () => {
  it('wraps the drawing in an img tag that decodes back to it, minus hooks and unused filters', async () => {
    const { svg } = await renderAuto(SOURCE)
    const tag = inlineImg(svg)
    expect(tag).toMatch(/^<img alt="Community space membership" style="[^"]*" src='data:image\/svg\+xml,[^']*'>$/)
    const body = tag.slice(tag.indexOf(',') + 1, -2)
    expect(body).not.toMatch(/["'#<>{}\n]/)
    const decoded = decodeURIComponent(body)
    expect(decoded).not.toContain('data-mm-')
    expect(decoded).not.toContain('--mm-tint')
    expect(decoded).not.toContain('mm-grain')
    const paths = (s: string) => s.match(/<path /g)?.length
    expect(paths(decoded)).toBe(paths(svg))
  })
})
