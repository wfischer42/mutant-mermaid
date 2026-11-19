import { formatAgo, formatYear, fromCalendar, MONTHS, toCalendar } from './dates.ts'

/**
 * Time scales for the dated timeline. `linear` is plain proportional time. `log` is the log of
 * time before the present: deep time is compressed on the left, the recent past expanded toward
 * the right edge, which is "now".
 */
export type ScaleKind = 'linear' | 'log'
export type ScaleRequest = ScaleKind | 'auto'

export interface Scale {
  kind: ScaleKind
  /** The domain, in fractional years, already padded. */
  t0: number
  t1: number
  x0: number
  x1: number
  now: number
  /** log only: the present all ages count back from (now, or the latest date if later). */
  ref: number
  /** log only: the youngest age with its own position; anything younger sits on the right edge. */
  floor: number
  /** Whether BCE dates are in range, so early CE years should say "CE". */
  era: boolean
  x(t: number): number
}

export interface Tick {
  t: number
  x: number
  label: string
  /** Round values (a power of ten, a millennium, January) drawn a little stronger. */
  major: boolean
}

/** Ages, in years, of the times that lie before the present. */
function agesOf({ times, ref }: { times: number[]; ref: number }): number[] {
  return times.map((t) => ref - t).filter((age) => age > 1e-6)
}

/**
 * The scale `auto` resolves to: log when the data spans many orders of magnitude of time before
 * now (the Big Bang and the printing press on one axis), otherwise linear.
 */
export function chooseScale({
  requested,
  times,
  now,
}: {
  requested: ScaleRequest
  times: number[]
  now: number
}): ScaleKind {
  if (requested !== 'auto') return requested
  if (!times.length) return 'linear'
  const ref = Math.max(now, ...times)
  const ages = agesOf({ times, ref })
  if (!ages.length) return 'linear'
  const oldest = Math.max(...ages)
  const youngest = Math.min(...ages)
  return oldest / youngest > 1e4 && oldest > 2e4 ? 'log' : 'linear'
}

export function makeScale({
  kind,
  times,
  now,
  x0,
  x1,
}: {
  kind: ScaleKind
  times: number[]
  now: number
  x0: number
  x1: number
}): Scale {
  const known = times.length ? times : [now - 1, now]
  const lo = Math.min(...known)
  const hi = Math.max(...known)
  if (kind === 'log') return logScale({ lo, hi, now, x0, x1, times: known })
  const pad = (hi - lo) * 0.035 || 1
  const t0 = lo - pad
  const t1 = hi + pad
  return {
    kind,
    t0,
    t1,
    x0,
    x1,
    now,
    ref: now,
    floor: 0,
    era: t0 < 1,
    x(t) {
      return x0 + ((t - t0) / (t1 - t0)) * (x1 - x0)
    },
  }
}

function logScale({
  lo,
  hi,
  now,
  x0,
  x1,
  times,
}: {
  lo: number
  hi: number
  now: number
  x0: number
  x1: number
  times: number[]
}): Scale {
  const ref = Math.max(now, hi)
  const ages = agesOf({ times, ref })
  const oldest = Math.max(ref - lo, 10)
  const youngest = ages.length ? Math.min(...ages) : oldest / 1e4
  const floor = Math.min(youngest / 3, 10, oldest / 100)
  const left = Math.log10(oldest) + 0.04 * Math.log10(oldest / floor)
  const right = Math.log10(floor)
  return {
    kind: 'log',
    t0: ref - 10 ** left,
    t1: ref,
    x0,
    x1,
    now,
    ref,
    floor,
    era: true,
    x(t) {
      const age = Math.max(ref - t, floor)
      return x0 + ((left - Math.log10(age)) / (left - right)) * (x1 - x0)
    },
  }
}

interface Candidate {
  t: number
  label: string
  /** Lower goes first when ticks compete for room. */
  priority: number
}

const GAP = 18

/** Whether labels of these widths, centered on their ticks, keep clear of each other. */
function clear({ ticks, measure }: { ticks: Tick[]; measure: (label: string) => number }): boolean {
  for (let i = 1; i < ticks.length; i++) {
    const a = ticks[i - 1]
    const b = ticks[i]
    if (b.x - a.x < (measure(a.label) + measure(b.label)) / 2 + GAP) return false
  }
  return true
}

/** Historical year numbering (no year zero) to astronomical: 500 BCE is -500 → -499. */
function astronomical(year: number): number {
  if (year > 0) return year
  return year === 0 ? 1 : year + 1
}

function historical(t: number): number {
  return t < 1 ? t - 1 : t
}

function yearTicks({ scale, step }: { scale: Scale; step: number }): Tick[] {
  const out: Tick[] = []
  const first = Math.ceil(historical(scale.t0) / step) * step
  for (let v = first; v <= historical(scale.t1); v += step) {
    if (step === 1 && v === 0) continue
    const t = astronomical(v)
    out.push({
      t,
      x: scale.x(t),
      label: formatYear({ year: t, era: scale.era }),
      major: v % (step * 5) === 0,
    })
  }
  return out
}

function monthTicks({ scale, months }: { scale: Scale; months: number }): Tick[] {
  const out: Tick[] = []
  for (let year = Math.floor(scale.t0); year <= Math.floor(scale.t1); year++)
    for (let month = 1; month <= 12; month += months) {
      const t = fromCalendar({ year, month })
      if (t < scale.t0 || t > scale.t1) continue
      const withYear = month === 1 || !out.length
      out.push({
        t,
        x: scale.x(t),
        label: withYear ? `${MONTHS[month - 1]} ${formatYear({ year })}` : MONTHS[month - 1],
        major: month === 1,
      })
    }
  return out
}

function dayTicks({ scale, weekly }: { scale: Scale; weekly: boolean }): Tick[] {
  const out: Tick[] = []
  const days = weekly ? [1, 8, 15, 22] : Array.from({ length: 31 }, (_, i) => i + 1)
  const start = toCalendar(scale.t0)
  for (let t = fromCalendar({ year: start.year, month: start.month }); t <= scale.t1; ) {
    const { year, month } = toCalendar(t + 1e-9)
    for (const day of days) {
      const at = fromCalendar({ year, month, day })
      if (at < scale.t0 || at > scale.t1 || toCalendar(at + 1e-9).month !== month) continue
      const label = `${MONTHS[month - 1]} ${day}`
      out.push({
        t: at,
        x: scale.x(at),
        label: out.length ? label : `${label}, ${year}`,
        major: day === 1,
      })
    }
    t = month === 12 ? year + 1 : fromCalendar({ year, month: month + 1 })
  }
  return out
}

function ageTicks({ scale, step }: { scale: Scale; step: number }): Tick[] {
  const out: Tick[] = []
  const youngest = scale.now - scale.t1
  const oldest = scale.now - scale.t0
  for (let age = Math.max(0, Math.ceil(youngest / step) * step); age <= oldest; age += step) {
    const t = scale.now - age
    out.push({
      t,
      x: scale.x(t),
      label: age === 0 ? 'now' : formatAgo({ age }),
      major: age % (step * 5) === 0,
    })
  }
  return out
}

const SUB_YEAR = [1 / 365.25, 7 / 365.25, 1 / 12, 2 / 12, 3 / 12, 6 / 12]

function steps(): number[] {
  const out = [...SUB_YEAR]
  for (let k = 0; k <= 10; k++) out.push(10 ** k, 2 * 10 ** k, 5 * 10 ** k)
  return out
}

function ticksForStep({ scale, step }: { scale: Scale; step: number }): Tick[] {
  const deep = scale.now - scale.t0 > 5e4 && step >= 1000
  if (deep) return ageTicks({ scale, step })
  if (step >= 1) return yearTicks({ scale, step })
  if (step >= 1 / 12 - 1e-9) return monthTicks({ scale, months: Math.round(step * 12) })
  return dayTicks({ scale, weekly: step > 2 / 365.25 })
}

function linearTicks({
  scale,
  measure,
}: {
  scale: Scale
  measure: (label: string) => number
}): Tick[] {
  const span = scale.t1 - scale.t0
  const most = Math.max(60, Math.abs(scale.x1 - scale.x0) / 40)
  let last: Tick[] = []
  for (const step of steps()) {
    if (span / step > most) continue
    const ticks = ticksForStep({ scale, step })
    if (ticks.length < 2 && last.length >= 2) return last
    if (clear({ ticks, measure })) return ticks
    last = ticks
  }
  return last
}

function ageCandidates(scale: Scale): Candidate[] {
  const out: Candidate[] = []
  const oldest = scale.ref - scale.t0
  const lowest = Math.floor(Math.log10(scale.floor))
  for (let k = lowest; k <= Math.ceil(Math.log10(oldest)); k++)
    for (const [m, priority] of [
      [1, 0],
      [5, 1],
      [2, 2],
    ]) {
      const age = m * 10 ** k
      if (age < 1e4 || age > oldest) continue
      out.push({ t: scale.ref - age, label: formatAgo({ age }), priority })
    }
  return out
}

const CALENDAR_STEPS = [
  [1000, 0],
  [500, 1],
  [100, 1],
  [50, 2],
  [10, 3],
]

function calendarCandidates(scale: Scale): Candidate[] {
  const out: Candidate[] = []
  const start = historical(Math.max(scale.ref - 1e4 + 1, scale.t0))
  const end = historical(scale.ref - scale.floor)
  for (const [step, priority] of CALENDAR_STEPS)
    for (let v = Math.ceil(start / step) * step; v <= end; v += step) {
      if (step === 1 && v === 0) continue
      const t = astronomical(v)
      const room = scale.x(astronomical(v + step)) - scale.x(t)
      if (room < 28) continue
      out.push({ t, label: formatYear({ year: t, era: true }), priority })
    }
  return out
}

/** Ticks for a log scale: ages in Ga/Ma/ka for deep time, calendar years once they're recent. */
function logTicks({
  scale,
  measure,
}: {
  scale: Scale
  measure: (label: string) => number
}): Tick[] {
  const candidates = [...ageCandidates(scale), ...calendarCandidates(scale)]
  if (scale.floor <= 10) candidates.push({ t: scale.ref, label: 'now', priority: -1 })
  candidates.sort((a, b) => a.priority - b.priority || a.t - b.t)
  const accepted: Tick[] = []
  const seen = new Set<number>()
  for (const c of candidates) {
    if (seen.has(c.t)) continue
    seen.add(c.t)
    const tick = { t: c.t, x: scale.x(c.t), label: c.label, major: c.priority <= 0 }
    const trial = [...accepted, tick].sort((a, b) => a.x - b.x)
    if (clear({ ticks: trial, measure })) accepted.push(tick)
  }
  return accepted.sort((a, b) => a.x - b.x)
}

/** Ticks at human units whose labels don't collide: 1 Ga, 66 Ma, 10,000 BCE, 1500, Mar 2026. */
export function makeTicks({
  scale,
  measure,
}: {
  scale: Scale
  measure: (label: string) => number
}): Tick[] {
  if (scale.kind === 'log') return logTicks({ scale, measure })
  return linearTicks({ scale, measure })
}
