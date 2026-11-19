import { describe, expect, it } from 'vitest'
import { textKit } from '../src/core/text.ts'
import { formatPoint, formatRange, formatYear, parseDate } from '../src/diagrams/timeline/dates.ts'
import { chooseScale, makeScale, makeTicks } from '../src/diagrams/timeline/scale.ts'
import { parseTimeline } from '../src/diagrams/timeline/syntax.ts'
import { dodge } from '../src/diagrams/timeline/vertical-layout.ts'
import { render } from '../src/index.ts'

const now = 2026

function date(text: string) {
  const parsed = parseDate({ text, now })
  if (!parsed) throw new Error(`no date: ${text}`)
  return parsed
}

describe('timeline dates', () => {
  it('reads years, negatives as BCE, and BCE/CE', () => {
    expect(date('1969').t).toBe(1969)
    expect(date('-27').t).toBe(-26)
    expect(formatYear({ year: date('-27').t })).toBe('27 BCE')
    expect(date('-500-03').t).toBe(date('500 BCE').t + 59 / 365)
    expect(date('44 BCE').t).toBe(-43)
    expect(date('44 BC').t).toBe(-43)
    expect(date('1200 CE').t).toBe(1200)
    expect(date('AD 800').t).toBe(800)
    expect(date('1440').end).toBe(1441)
  })

  it('reads months, days and quarters as fractional years', () => {
    expect(date('2026-01').t).toBe(2026)
    expect(date('2026-07').t).toBeCloseTo(2026 + 181 / 365)
    expect(date('2026-03').end).toBeCloseTo(date('2026-04').t)
    expect(date('2024-03-01').t).toBeCloseTo(2024 + 60 / 366)
    expect(date('2026-Q3').t).toBeCloseTo(date('2026-07').t)
    expect(date('Mar 2026').t).toBeCloseTo(date('2026-03').t)
    expect(parseDate({ text: '2026-13', now })).toBeNull()
    expect(parseDate({ text: '2026-02-30', now })).toBeNull()
  })

  it('reads deep-time units as years before now', () => {
    expect(date('-66Ma').t).toBe(now - 66e6)
    expect(date('66 Ma').t).toBe(now - 66e6)
    expect(date('13.8Ga').t).toBeCloseTo(now - 13.8e9)
    expect(date('11.7ka').t).toBeCloseTo(now - 11700)
    expect(date('now').t).toBe(now)
    expect(date('-66Ma').ago).toBe('Ma')
  })

  it('reads EDTF qualifiers before or after', () => {
    expect(date('1440~')).toMatchObject({ t: 1440, approximate: true, uncertain: false })
    expect(date('2026-09?')).toMatchObject({ approximate: false, uncertain: true })
    expect(date('1500%')).toMatchObject({ approximate: true, uncertain: true })
    expect(date('~-233Ma')).toMatchObject({ approximate: true, t: now - 233e6 })
    expect(date('c. 1440')).toMatchObject({ t: 1440, approximate: true })
  })

  it('rejects text that is not a date', () => {
    expect(parseDate({ text: 'Printing press', now })).toBeNull()
    expect(parseDate({ text: '', now })).toBeNull()
  })

  it('formats dates humanly', () => {
    expect(formatYear({ year: -9999 })).toBe('10,000 BCE')
    expect(formatYear({ year: 1500 })).toBe('1500')
    expect(formatYear({ year: 476, era: true })).toBe('476 CE')
    expect(formatPoint({ point: date('1440~'), now })).toBe('c. 1440')
    expect(formatPoint({ point: date('-66Ma'), now })).toBe('66 Ma')
    expect(formatPoint({ point: date('2026-03'), now })).toBe('Mar 2026')
    expect(formatPoint({ point: date('2026-03-15?'), now })).toBe('Mar 15, 2026?')
    expect(formatRange({ from: date('-233Ma'), to: date('-66Ma'), now })).toBe('233–66 Ma')
    expect(formatRange({ from: date('2026-01'), to: date('2026-04'), now })).toBe('Jan–Apr 2026')
  })
})

describe('timeline date edge cases', () => {
  it('reads only real month names', () => {
    expect(date('March 2026').t).toBe(date('2026-03').t)
    expect(date('Sept 2026').t).toBe(date('2026-09').t)
    for (const word of ['Big', 'Marketing', 'Junior', 'Maybe', 'Decision'])
      expect(parseDate({ text: `${word} 2026`, now })).toBeNull()
  })

  it('counts BP from 1950', () => {
    expect(date('12,000 BP').t).toBe(1950 - 12000)
    expect(formatPoint({ point: date('12,000 BP'), now })).toBe('12,000 BP')
  })
})

describe('timeline scales', () => {
  const kit = textKit({ font: 'nunito', family: 'Nunito' })
  const measure = (label: string) => kit.width(label, { size: 12, weight: 600 })

  it('picks log for deep time and linear otherwise', () => {
    expect(chooseScale({ requested: 'auto', times: [now - 13.8e9, 1440, 1969], now })).toBe('log')
    expect(chooseScale({ requested: 'auto', times: [1822, 1945, 2017], now })).toBe('linear')
    expect(chooseScale({ requested: 'auto', times: [2026.1, 2026.9], now })).toBe('linear')
    expect(chooseScale({ requested: 'linear', times: [now - 13.8e9, 2000], now })).toBe('linear')
  })

  it('puts the past on the left and now on the right of a log scale', () => {
    const scale = makeScale({ kind: 'log', times: [now - 13.8e9, 1440], now, x0: 0, x1: 1000 })
    expect(scale.x(now - 13.8e9)).toBeLessThan(scale.x(now - 66e6))
    expect(scale.x(now - 66e6)).toBeLessThan(scale.x(1440))
    expect(scale.x(now)).toBeCloseTo(1000)
  })

  it('snaps log ticks to human units', () => {
    const scale = makeScale({
      kind: 'log',
      times: [now - 13.8e9, 1440, 1969],
      now,
      x0: 0,
      x1: 1000,
    })
    const labels = makeTicks({ scale, measure }).map((t) => t.label)
    expect(labels).toEqual(expect.arrayContaining(['1 Ga', '1 Ma', 'now']))
    expect(labels.some((l) => /^\d+ (Ga|Ma|ka)$|^\d{3,4}( CE)?$|BCE|now/.test(l))).toBe(true)
    for (const l of labels) expect(l).toMatch(/^([\d,.]+ (Ga|Ma|ka)|[\d,]+( CE| BCE)?|now)$/)
  })

  it('ticks centuries as years and short ranges as months', () => {
    const century = makeScale({ kind: 'linear', times: [1822, 2017], now, x0: 0, x1: 900 })
    const years = makeTicks({ scale: century, measure })
    expect(years.every((t) => /^\d{4}$/.test(t.label))).toBe(true)
    expect(years.every((t) => t.t % 10 === 0)).toBe(true)
    const months = makeScale({ kind: 'linear', times: [2026, 2026.9], now, x0: 0, x1: 900 })
    const labels = makeTicks({ scale: months, measure }).map((t) => t.label)
    expect(labels).toContain('Jan 2026')
    expect(labels).toContain('Mar')
  })

  it('labels BCE years across the era boundary', () => {
    const scale = makeScale({ kind: 'linear', times: [-1999, 1500], now, x0: 0, x1: 900 })
    const labels = makeTicks({ scale, measure }).map((t) => t.label)
    expect(labels.some((l) => l.endsWith('BCE'))).toBe(true)
    expect(labels).toContain('1000 CE')
  })
})

describe('vertical label dodging', () => {
  it('leaves labels that fit where they want to be', () => {
    expect(dodge({ wants: [100, 200], heights: [20, 20], gap: 5, min: 0 })).toEqual([90, 190])
  })

  it('spreads a crowd evenly around where it wants to be', () => {
    const tops = dodge({ wants: [100, 100, 100], heights: [20, 20, 20], gap: 5, min: 0 })
    expect(tops).toEqual([65, 90, 115])
  })

  it('never pushes a label above the minimum', () => {
    const tops = dodge({ wants: [0, 0], heights: [20, 20], gap: 5, min: 0 })
    expect(tops).toEqual([0, 25])
  })
})

describe('timeline syntax', () => {
  it("reads Mermaid's timeline syntax with sections and continuations", () => {
    const { model, diagnostics } = parseTimeline(`timeline
    title History of Social Media Platform
    section 2002-2006
      2002 : LinkedIn
      2004 : Facebook : Google
    section 2007
      2007 : Tumblr
             : Twitter`)
    expect(diagnostics).toEqual([])
    if (model?.mode !== 'sequential') throw new Error('expected sequential')
    expect(model.title).toBe('History of Social Media Platform')
    expect(model.sections.map((s) => s.label)).toEqual(['2002-2006', '2007'])
    expect(model.periods.map((p) => p.label)).toEqual(['2002', '2004', '2007'])
    expect(model.periods[1].events).toEqual(['Facebook', 'Google'])
    expect(model.periods[2]).toMatchObject({ events: ['Tumblr', 'Twitter'], section: 1 })
  })

  it('reads the extended syntax: scale, now, eras, lanes, spans, events, flags', () => {
    const { model, diagnostics } = parseTimeline(`timeline "From Big Bang to launch"
  scale log now=2026
  era Mesozoic  -252Ma .. -66Ma #moss
  era Holocene  -11.7ka .. now
  lane Life
    event First dinosaurs   ~-233Ma
    span  Non-avian dinosaurs -233Ma .. -66Ma
    event Chicxulub impact  -66Ma !major
  lane Humans
    span  Roman Empire  -27 .. 476
    event Printing press 1440~
    span  Project X  2026-03 .. 2026-09?
    milestone Launch 2026-10-01`)
    expect(diagnostics).toEqual([])
    if (model?.mode !== 'dated') throw new Error('expected dated')
    expect(model).toMatchObject({ title: 'From Big Bang to launch', scale: 'log', now: 2026 })
    expect(model.eras.map((e) => e.label)).toEqual(['Mesozoic', 'Holocene'])
    expect(model.eras[0].color).toBe('moss')
    const [life, humans] = model.lanes
    expect(life.items[0]).toMatchObject({ kind: 'event', label: 'First dinosaurs' })
    expect(life.items[1]).toMatchObject({ kind: 'span', label: 'Non-avian dinosaurs' })
    expect(life.items[2]).toMatchObject({ major: true, label: 'Chicxulub impact' })
    expect(humans.items[1]).toMatchObject({ label: 'Printing press' })
    expect(humans.items[2]).toMatchObject({ kind: 'span', to: { uncertain: true } })
    expect(humans.items[3]).toMatchObject({ milestone: true })
  })

  it('reads direction and axis length from the header', () => {
    const vertical = parseTimeline('timeline TB "Roadmap" length=3000\n  event Launch 2026-09-01')
    expect(vertical.model).toMatchObject({
      title: 'Roadmap',
      direction: 'vertical',
      length: 3000,
    })
    const named = parseTimeline('timeline "Roadmap" direction=vertical length=wide\n  event A 2026')
    expect(named.model).toMatchObject({ direction: 'vertical', length: 'wide' })
    const mermaid = parseTimeline('timeline TD\n  title T\n  2004 : Facebook')
    expect(mermaid.model).toMatchObject({ mode: 'sequential', title: 'T', direction: 'vertical' })
    const plain = parseTimeline('timeline LR\n  2004 : Facebook')
    expect(plain.model).toMatchObject({ title: '', direction: 'horizontal', length: 'fit' })
    const bad = parseTimeline('timeline length=huge\n  event A 2026')
    expect(bad.diagnostics[0]).toMatchObject({ severity: 'warning' })
    expect(bad.diagnostics[0].message).toContain('length=wide')
  })

  it('says how to fix a missing date', () => {
    const { diagnostics } = parseTimeline('timeline\n  event Something vague')
    expect(diagnostics[0]).toMatchObject({ line: 2, severity: 'error' })
    expect(diagnostics[0].message).toContain('event Moon landing')
  })
})

function firstEvent(source: string) {
  const { model, diagnostics } = parseTimeline(`timeline\n  ${source}`)
  const item = model?.mode === 'dated' ? model.lanes[0]?.items[0] : undefined
  return { item, diagnostics }
}

describe('timeline syntax edge cases', () => {
  it('keeps Mermaid timelines whose periods start with one of our keywords', () => {
    const { model, diagnostics } = parseTimeline(
      'timeline\n  Now : Kickoff\n  Era : Growth\n  event Launch : 2026',
    )
    expect(model?.mode).toBe('dated')
    const mermaid = parseTimeline('timeline\n  Now : Kickoff\n  Later : Ship')
    expect(mermaid.model?.mode).toBe('sequential')
    expect(mermaid.diagnostics).toEqual([])
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('does not read a word as a month or a short number as a year', () => {
    expect(firstEvent('event Big Decision 2026').item).toMatchObject({
      label: 'Big Decision',
      at: { t: 2026, unit: 'year' },
    })
    const apollo = firstEvent('event Apollo 11')
    expect(apollo.item).toBeUndefined()
    expect(apollo.diagnostics[0].message).toContain('11 CE')
    expect(firstEvent('event Apollo 11 1969-07-20').item).toMatchObject({ label: 'Apollo 11' })
    expect(firstEvent('span Augustus -27 .. 14').item).toMatchObject({ kind: 'span' })
  })

  it('reads options written before the date, and drops quotes', () => {
    expect(firstEvent('event Launch !major #red 2026').item).toMatchObject({
      label: 'Launch',
      major: true,
      color: 'red',
    })
    expect(firstEvent('event "Apollo 11" 1969').item).toMatchObject({ label: 'Apollo 11' })
  })

  it('reads hyphenated year ranges and warns on a ranged milestone', () => {
    const war = firstEvent('span War 1939-1945').item
    expect(war?.kind === 'span' && [war.label, war.from.t, war.to.t]).toEqual(['War', 1939, 1945])
    expect(firstEvent('event Spring 2026-03').item).toMatchObject({ at: { unit: 'month' } })
    const ranged = firstEvent('milestone A 2000 .. 2001')
    expect(ranged.item).toMatchObject({ label: 'A', at: { t: 2000 }, milestone: true })
    expect(ranged.diagnostics[0]).toMatchObject({ severity: 'warning' })
  })

  it('warns about settings it cannot honour', () => {
    const scale = parseTimeline('timeline scale=wobbly\n  event A 2026')
    expect(scale.diagnostics[0].message).toContain('Unknown scale')
    const rl = parseTimeline('timeline RL\n  event A 2026')
    expect(rl.diagnostics[0].message).toContain('LR')
    const length = parseTimeline('timeline length=wide\n  2004 : Facebook')
    expect(length.diagnostics[0].message).toContain('length=')
  })
})

describe('timeline render', () => {
  it("breaks a major event's guide line where another lane's label crosses it", async () => {
    const guide = async (source: string) =>
      (
        /<path d="([^"]*)"[^>]*stroke-dasharray="5 4"/.exec((await render(source)).svg)?.[1] ?? ''
      ).split('M').length - 1
    const lanes = (a: string) =>
      `timeline\n  lane A\n    event Start 1900${a}\n  lane B\n    event Peak 2002 !major\n    event End 2100`
    expect(await guide(lanes('\n    event Recombination 2000'))).toBeGreaterThan(1)
    expect(await guide(lanes(''))).toBe(1)
  })

  it('renders both syntaxes to SVG', async () => {
    const mermaid = await render(
      'timeline\n  title T\n  2002 : LinkedIn\n  2004 : Facebook : Google',
    )
    expect(mermaid.kind).toBe('timeline')
    expect(mermaid.svg).toContain('Facebook')
    const dated = await render(
      'timeline "Computing" now=2026\n  lane Machines\n    event ENIAC 1945 !major\n    span ARPANET 1969 .. 1990',
      { dark: true },
    )
    expect(dated.svg).toContain('ENIAC')
    expect(dated.svg).toContain('1969 – 1990')
    expect(dated.width).toBeGreaterThan(400)
  })

  it('scrolls a wide timeline sideways with its lane names pinned', async () => {
    const events = Array.from({ length: 30 }, (_, i) => `    event Event number ${i} ${1950 + i}`)
    const source = `timeline "Wide" length=wide now=2026\n  lane Things\n${events.join('\n')}`
    const wide = await render(source)
    expect(wide.svg).toContain('data-scroll="x"')
    expect(wide.svg).toContain('data-sticky="left"')
    const fit = await render(source.replace(' length=wide', ''))
    expect(fit.svg).not.toContain('data-scroll')
    expect(wide.width).toBeGreaterThan(fit.width)
  })

  it('draws both syntaxes top to bottom', async () => {
    const dated = await render(
      'timeline TD "Computing" now=2026\n  era Electronic 1940 .. 2026\n  lane Machines\n    event ENIAC 1945 !major\n    span ARPANET 1969 .. 1990\n  lane Ideas\n    event Transistor 1947',
    )
    expect(dated.svg).toContain('data-scroll="y"')
    expect(dated.svg).toContain('data-sticky="top"')
    expect(dated.svg).toContain('ENIAC')
    expect(dated.height).toBeGreaterThan(dated.width / 2)
    const mermaid = await render(
      'timeline TD\n  title T\n  2002 : LinkedIn\n  2004 : Facebook : Google',
    )
    expect(mermaid.svg).toContain('data-scroll="y"')
    expect(mermaid.svg).toContain('Facebook')
  })

  it('is deterministic when now is given', async () => {
    const source = 'timeline now=2026\n  event Big Bang -13.8Ga\n  event Moon 1969'
    expect((await render(source)).svg).toBe((await render(source)).svg)
  })
})
