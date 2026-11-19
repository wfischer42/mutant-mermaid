/**
 * Dates as fractional astronomical years, so a timeline can run from the Big Bang to next Tuesday
 * without leaving plain numbers. Year 1 BCE is 0, 44 BCE is -43, and 2026-07-02 is about 2026.5.
 * JS `Date` is never used for positions: it can't reach deep time.
 */

export type Unit = 'year' | 'quarter' | 'month' | 'day' | 'ago' | 'now'
/** Deep-time suffixes count back from `now`; `BP` counts back from 1950, as radiocarbon does. */
export type AgoUnit = 'Ga' | 'Ma' | 'ka' | 'yr' | 'BP'

export interface TimePoint {
  /** Fractional astronomical year at the start of what was written. */
  t: number
  /** Where the written precision ends: `1440` runs to 1441, `2026-03` to the start of April. */
  end: number
  unit: Unit
  /** For deep time, the suffix the author used, so labels echo it. */
  ago?: AgoUnit
  /** EDTF `~` (or `%`), or a leading `c.`. */
  approximate: boolean
  /** EDTF `?` (or `%`). */
  uncertain: boolean
}

export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const AGO_FACTORS: Record<AgoUnit, number> = { Ga: 1e9, Ma: 1e6, ka: 1e3, yr: 1, BP: 1 }

/** The year "before present" counts back from. */
const PRESENT = 1950

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/** A year as written to an astronomical one: there is no year 0, so -44 (44 BCE) is -43. */
function historicalYear(written: number): number {
  return written < 0 ? written + 1 : written
}

export function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInYear(year: number): number {
  return isLeap(year) ? 366 : 365
}

export function daysInMonth({ year, month }: { year: number; month: number }): number {
  return month === 2 && isLeap(year) ? 29 : MONTH_DAYS[month - 1]
}

/** The fractional year at the start of a calendar day (month and day are 1-based). */
export function fromCalendar({
  year,
  month = 1,
  day = 1,
}: {
  year: number
  month?: number
  day?: number
}): number {
  let before = day - 1
  for (let m = 1; m < month; m++) before += daysInMonth({ year, month: m })
  return year + before / daysInYear(year)
}

/** The calendar day a fractional year falls on. */
export function toCalendar(t: number): { year: number; month: number; day: number } {
  const year = Math.floor(t)
  let rest = Math.round((t - year) * daysInYear(year) * 1000) / 1000
  for (let month = 1; month <= 12; month++) {
    const days = daysInMonth({ year, month })
    if (rest < days || month === 12) return { year, month, day: Math.floor(rest) + 1 }
    rest -= days
  }
  return { year, month: 12, day: 31 }
}

/** The fractional year at the start of the month after `month` (which may be 12). */
function monthEnd({ year, month }: { year: number; month: number }): number {
  return month === 12 ? year + 1 : fromCalendar({ year, month: month + 1 })
}

interface Qualified {
  core: string
  approximate: boolean
  uncertain: boolean
}

/** Peels EDTF qualifiers (`~ ? %`, before or after) and `c.`/`circa` off a date. */
export function qualifiers(text: string): Qualified {
  let core = text.trim()
  let approximate = false
  let uncertain = false
  for (;;) {
    const lead = /^(?:(c\.|ca\.|circa\s)\s*|([~?%]))/i.exec(core)
    const trail = /([~?%])$/.exec(core)
    const mark = lead?.[2] ?? trail?.[1] ?? (lead ? '~' : '')
    if (!mark) break
    approximate ||= mark === '~' || mark === '%'
    uncertain ||= mark === '?' || mark === '%'
    core = lead ? core.slice(lead[0].length).trim() : core.slice(0, -1).trim()
  }
  return { core, approximate, uncertain }
}

function number(text: string): number {
  return Number(text.replace(/[,_]/g, '').replace('−', '-'))
}

function agoUnit(suffix: string): AgoUnit {
  if (suffix.toUpperCase() === 'BP') return 'BP'
  const first = suffix[0].toLowerCase()
  if (first === 'g' || first === 'b') return 'Ga'
  if (first === 'm') return 'Ma'
  if (first === 'k') return 'ka'
  return 'yr'
}

/** A month's number from its full name, its three-letter abbreviation or `Sept`; else 0. */
function monthIndex(name: string): number {
  const lower = name.toLowerCase()
  if (lower === 'sept') return 9
  return MONTH_NAMES.findIndex((m) => m === lower || m.slice(0, 3) === lower) + 1
}

type Core = Omit<TimePoint, 'approximate' | 'uncertain'>

interface Reader {
  pattern: RegExp
  read(match: RegExpExecArray, now: number): Core | null
}

function yearPoint(year: number): Core {
  return { t: year, end: Number.isInteger(year) ? year + 1 : year, unit: 'year' }
}

/** A deep-time age: back from `now`, or from 1950 for BP. The sign is optional either way. */
function agoPoint({ amount, suffix, now }: { amount: number; suffix: string; now: number }): Core {
  const unit = agoUnit(suffix)
  const from = unit === 'BP' ? PRESENT : now
  const t = from - amount * AGO_FACTORS[unit]
  return { t, end: t, unit: 'ago', ago: unit }
}

function monthPoint({ year, month }: { year: number; month: number }): Core | null {
  if (month < 1 || month > 12) return null
  return { t: fromCalendar({ year, month }), end: monthEnd({ year, month }), unit: 'month' }
}

function quarterPoint({ year, quarter }: { year: number; quarter: number }): Core {
  return {
    t: fromCalendar({ year, month: quarter * 3 - 2 }),
    end: monthEnd({ year, month: quarter * 3 }),
    unit: 'quarter',
  }
}

function isRealDay({ year, month, day }: { year: number; month: number; day: number }): boolean {
  const monthOk = month >= 1 && month <= 12
  return monthOk && day >= 1 && day <= daysInMonth({ year, month })
}

function dayPoint(date: { year: number; month: number; day: number }): Core | null {
  if (!isRealDay(date)) return null
  const t = fromCalendar(date)
  return { t, end: t + 1 / daysInYear(date.year), unit: 'day' }
}

/** Every date form, tried in order; the first whose pattern matches decides. */
const READERS: Reader[] = [
  {
    pattern: /^(now|today|present)$/i,
    read: (_, now) => ({ t: now, end: now, unit: 'now' }),
  },
  {
    pattern: /^[-+−]?(\d[\d,]*(?:\.\d+)?)\s*(Ga|Gya|bya|Ma|Mya|ka|kya|BP|years ago|yr ago)$/i,
    read: (m, now) => agoPoint({ amount: number(m[1]), suffix: m[2], now }),
  },
  { pattern: /^(\d[\d,]*)\s*(?:BCE|BC|B\.C\.)$/i, read: (m) => yearPoint(1 - number(m[1])) },
  { pattern: /^(?:BCE|BC)\s*(\d[\d,]*)$/i, read: (m) => yearPoint(1 - number(m[1])) },
  { pattern: /^(\d[\d,]*)\s*(?:CE|AD|A\.D\.)$/i, read: (m) => yearPoint(number(m[1])) },
  { pattern: /^(?:CE|AD)\s*(\d[\d,]*)$/i, read: (m) => yearPoint(number(m[1])) },
  {
    pattern: /^(-?\d{1,6})-?Q([1-4])$/i,
    read: (m) => quarterPoint({ year: year(m[1]), quarter: number(m[2]) }),
  },
  {
    pattern: /^Q([1-4])\s+(-?\d{1,6})$/i,
    read: (m) => quarterPoint({ year: year(m[2]), quarter: number(m[1]) }),
  },
  {
    pattern: /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/,
    read: (m) => dayPoint({ year: year(m[1]), month: number(m[2]), day: number(m[3]) }),
  },
  {
    pattern: /^(-?\d{1,6})-(\d{1,2})$/,
    read: (m) => monthPoint({ year: year(m[1]), month: number(m[2]) }),
  },
  {
    pattern: /^([A-Za-z]{3,9})\.?\s+(-?\d{1,6})$/,
    read: (m) => monthPoint({ year: year(m[2]), month: monthIndex(m[1]) }),
  },
  { pattern: /^[-+−]?\d[\d,]*(\.\d+)?$/, read: (m) => yearPoint(year(m[0])) },
]

/** A written year, negatives meaning BCE: -27 is 27 BCE. */
function year(text: string): number {
  return historicalYear(number(text))
}

/**
 * Reads one date: `1969`, `-500` (500 BCE), `44 BCE`, `1200 CE`, `2026-03`, `2026-03-15`,
 * `2026-Q2`, `Mar 2026`, `March 2026`, `66Ma`, `4.5 Ga`, `11.7ka`, `12,000 BP`, `now`, each
 * optionally qualified with EDTF `~` (approximate), `?` (uncertain) or `%` (both), or a leading
 * `c.`. Deep-time units count back from `now`, and BP from 1950. Returns null when the text isn't
 * a date.
 */
export function parseDate({ text, now }: { text: string; now: number }): TimePoint | null {
  const { core, approximate, uncertain } = qualifiers(text)
  if (!core) return null
  for (const reader of READERS) {
    const match = reader.pattern.exec(core)
    if (!match) continue
    const found = reader.read(match, now)
    return found && { ...found, approximate, uncertain }
  }
  return null
}

/** Groups thousands with commas from five digits up: 5000, 10,000. */
export function group(value: number): string {
  const rounded = Math.round(value)
  if (Math.abs(rounded) < 10000) return String(rounded)
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** A number with at most `digits` decimals and no trailing zeros. */
export function trim({ value, digits = 2 }: { value: number; digits?: number }): string {
  const factor = 10 ** digits
  return String(Math.round(value * factor) / factor)
}

/** The unit an age reads best in: 4.5 Ga, 66 Ma, 11.7 ka. */
export function bestAgoUnit(age: number): AgoUnit {
  if (age >= 1e9) return 'Ga'
  if (age >= 1e6) return 'Ma'
  if (age >= 1e4) return 'ka'
  return 'yr'
}

/** An age in years as a human label, in a given unit or the one that reads best. */
export function formatAgo({ age, unit }: { age: number; unit?: AgoUnit }): string {
  const u = unit ?? bestAgoUnit(age)
  if (u === 'yr') return `${group(age)} yr ago`
  if (u === 'BP') return `${group(age)} BP`
  return `${trim({ value: age / AGO_FACTORS[u] })} ${u}`
}

/**
 * A calendar year: `1500`, `44 BCE`, `10,000 BCE`. With `era`, early CE years say so (`476 CE`),
 * which helps once BCE dates are on the same axis.
 */
export function formatYear({ year, era = false }: { year: number; era?: boolean }): string {
  const whole = Math.floor(year + 1e-9)
  if (whole <= 0) return `${group(1 - whole)} BCE`
  if (era && whole <= 1000) return `${whole} CE`
  return group(whole)
}

/** How a point reads in a label, at the precision it was written. */
export function formatPoint({
  point,
  now,
  era = false,
}: {
  point: TimePoint
  now: number
  era?: boolean
}): string {
  const body = formatCore({ point, now, era })
  const prefix = point.approximate ? 'c. ' : ''
  const suffix = point.uncertain ? '?' : ''
  return `${prefix}${body}${suffix}`
}

function formatCore({ point, now, era }: { point: TimePoint; now: number; era: boolean }): string {
  if (point.unit === 'now') return 'now'
  if (point.unit === 'ago') {
    const from = point.ago === 'BP' ? PRESENT : now
    return formatAgo({ age: from - point.t, unit: point.ago })
  }
  if (point.unit === 'year') return formatYear({ year: point.t, era })
  const { year, month, day } = toCalendar(point.t + 1e-9)
  if (point.unit === 'quarter') return `Q${Math.ceil(month / 3)} ${formatYear({ year })}`
  if (point.unit === 'month') return `${MONTHS[month - 1]} ${formatYear({ year })}`
  return `${MONTHS[month - 1]} ${day}, ${formatYear({ year })}`
}

/** A span's dates, sharing a unit where they can: `233–66 Ma`, `27 BCE – 476`. */
export function formatRange({
  from,
  to,
  now,
  era = false,
}: {
  from: TimePoint
  to: TimePoint
  now: number
  era?: boolean
}): string {
  const a = formatPoint({ point: from, now, era })
  const b = formatPoint({ point: to, now, era })
  const shared = /^(c\. )?([\d.,]+) (Ga|Ma|ka)(\??)$/
  const ma = shared.exec(a)
  const mb = shared.exec(b)
  if (ma && mb && ma[3] === mb[3]) return `${a.replace(` ${ma[3]}`, '')}–${b}`
  const sameYear = /^(\w{3}) (-?\d+)$/
  const ya = sameYear.exec(a)
  const yb = sameYear.exec(b)
  if (ya && yb && ya[2] === yb[2]) return `${ya[1]}–${b}`
  return `${a} – ${b}`
}
