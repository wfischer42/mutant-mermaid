import { clickSyntax } from '../../core/hooks.ts'
import type { Context, DiagramType, Drawing } from '../../core/types.ts'
import { renderDated } from './dated.ts'
import { renderSequential } from './sequential.ts'
import { renderSequentialVertical } from './sequential-vertical.ts'
import { parseTimeline, type TimelineModel } from './syntax.ts'
import { renderVertical } from './vertical.ts'

/**
 * A timeline in either of two syntaxes.
 *
 * Mermaid's, ordered periods grouped into sections:
 *
 *   timeline
 *     title History of Social Media
 *     section 2002-2006
 *       2004 : Facebook : Google
 *
 * Ours, real dates on a linear or log axis, with lanes, eras, spans and events:
 *
 *   timeline "From Big Bang to launch"
 *     scale log now=2026
 *     era Mesozoic -252Ma .. -66Ma #moss
 *     lane Life
 *       span  Non-avian dinosaurs -233Ma .. -66Ma
 *       event Chicxulub impact -66Ma !major
 */
export function renderTimeline(model: TimelineModel, ctx: Context): Drawing {
  const drawing = drawTimeline(model, ctx)
  const long = model.direction === 'vertical' || drawing.width > SCROLL_PAST
  return long ? { ...drawing, scroll: model.direction === 'vertical' ? 'y' : 'x' } : drawing
}

/** Wider than this, a timeline scrolls instead of shrinking past reading. */
const SCROLL_PAST = 1400

function drawTimeline(model: TimelineModel, ctx: Context): Drawing {
  if (model.mode === 'sequential')
    return model.direction === 'vertical'
      ? renderSequentialVertical(model, ctx)
      : renderSequential(model, ctx)
  if (model.direction === 'vertical') return renderVertical(model, ctx)
  return renderDated(model, ctx)
}

export const timeline: DiagramType<TimelineModel> = {
  id: 'timeline',
  keywords: ['timeline'],
  title: 'Timeline',
  summary:
    'Events and spans in lanes on a real time axis (linear or log, Big Bang to next month), or Mermaid timeline syntax.',
  guide: {
    useWhen: 'things happen at dates, or in an order, and when they happen is the point.',
    syntax: `
Two syntaxes. **Prefer ours** whenever items have real dates: it places them to scale, in
lanes. Use the Mermaid form only for ordered steps with no dates ("Week 1", "Phase 2") or to
paste an existing Mermaid timeline.

Ours:

\`\`\`
timeline "Title" now=2026-05-12             %% header options: see Header
  scale linear                              %% linear, log or auto (the default)
  era H1 2026-01 .. 2026-06 #sky            %% a shaded band across every lane
  lane Platform #blue                       %% a row; its items are indented under it
    event Postgres 17 2026-02-10            %% a dot at one date
    span  Storage rewrite 2026-01 .. 2026-04  %% a bar from one date to another
    milestone GA 2026-09-01 !major          %% a diamond; !major makes it stand out
  note Dates after now are targets.         %% a line of text under the chart
\`\`\`

Mermaid's:

\`\`\`
timeline TD
  title Launching a product
  section Discover #coral                   %% groups the periods under it
    Week 1 : Customer interviews : Teardown %% a period, then its events
           : Pricing survey                 %% a line starting with : adds to the period above
    Week 2 : Problem statement
\`\`\`

**Which syntax is read**
- The source is ours if any line starts with \`lane\`, \`era\`, \`event\`, \`span\`, \`milestone\`,
  \`scale\` or \`now\`, has text after that word, and has no \` : \` in it. Otherwise it is Mermaid's.
- So Mermaid periods such as \`Now : Kickoff\` or \`Event day : Doors open\` stay Mermaid's.
- One exception: an item line with a date after its colon (\`event Kickoff : 2026-03\`) is ours.

**Header**
- \`timeline [LR|TD] "Title" key=value …\`. Both syntaxes take it. The direction word, if any,
  comes straight after \`timeline\`. Quotes round the title are optional.
- \`direction=horizontal\` (the default) or \`direction=vertical\`. \`TD\` and \`TB\` mean vertical,
  \`LR\` horizontal. Earliest is always left or top: \`RL\` and \`BT\` warn and draw like \`LR\` and
  \`TD\`. An unknown direction warns and stays horizontal.
- \`length=fit\` (the default: the time axis fits a page), \`length=wide\` (it grows until
  labels sit side by side; good for dense histories) or a size in pixels, \`length=3000\`, from
  200 up (above 40000 is cut to 40000). Anything else warns and uses \`fit\`. Ours only: on a
  Mermaid-syntax timeline it warns and is ignored.
- Vertical timelines, and horizontal ones wider than 1400px, scroll instead of shrinking.
- \`now=<date>\` and \`scale=<kind>\` can also go here; see Time scale and now.
- A \`title Text\` line under the header replaces the header's title.

**Lanes and eras** (ours)
- \`lane Name #color\` starts a row. Indent its items under it. \`section\` means the same here.
  Lanes are drawn in the order written, each in the next theme color unless \`#color\` is set.
  Colors are \`#hex\` or a name: red, coral, orange, amber, yellow, lime, green, moss, teal, cyan,
  sky, blue, indigo, violet, purple, magenta, pink, rose, brown, grey.
- Items not under any lane go in one unnamed lane at the top. A \`lane\` with no name is called
  "Lane 2" and so on. A named lane with no items is still drawn.
- \`era Name from .. to #color\` is a labelled band behind every lane, wherever it is indented.
  It needs a range, or it is an error. Overlapping eras stack in rows.

**Events, spans and milestones** (ours)
- \`event Label date\` is a dot. \`span Label from .. to\` is a bar. \`milestone Label date\` is a
  diamond; \`!milestone\` on an event does the same.
- The dates decide, not the word: \`event\` with a range draws a span, \`span\` with one date
  draws an event. A milestone with a range warns and is drawn at its start. A range written
  backwards is swapped.
- \`!major\` draws the item bigger and bolder, with a line down to the axis. \`#color\` overrides
  the lane's color for one item. An unknown color name is ignored.
- Options go before or after the date: \`event GA 2026-09 !major\` or \`event GA !major 2026-09\`.
- \`note Text\` adds a line under the chart; several notes stack.
- Any other line is an error.

**Writing the date on a line** (ours)
- The date goes at the end of the label (\`Moon landing 1969-07-20\`) or at the start
  (\`1969-07-20 Moon landing\`). The last one to three words are tried first, then the first ones.
- Separate them with \` : \` or \` @ \` (spaces both sides) when a label ends in a number that
  could pass for a date: \`Windows 95 : 1995\`.
- A bare one- or two-digit number is never an event's year, so \`event Apollo 11\` is an error
  asking for a date. Write a year before 100 as \`11 CE\`. Inside a range it reads as a year:
  \`span Augustus -27 .. 14\`.
- Quote a label to keep text that would otherwise be read as an option or a date:
  \`event "Ship #launch" 2026-01\`. The quotes aren't shown.
- **Ranges:** \`from .. to\` (spaces optional), an en or em dash (\`1995 – 2001\`), \`from to to\`,
  or a hyphen with no spaces when the right side has 3 or more digits (\`1939-1945\`). \`2026-03\`
  is a month, not a range.
- A date covers all of what it names: \`2026-06\` runs to the end of June, so \`.. 2026-06\`
  ends on July 1. Labels show dates at the precision written.

**Date forms** (ours)
- **Years:** \`1969\`, \`2026.5\`, \`10,000\`. \`44 BCE\`, \`BC 44\`, \`500 BC\`, \`476 CE\`, \`AD 476\`.
  A negative year is BCE: \`-27\` is 27 BCE.
- **Calendar:** \`2026-03\`, \`Mar 2026\`, \`March 2026\` or \`Sept 2026\` (full month names and
  three-letter ones only), \`2026-03-15\`, \`2026-Q2\`, \`2026Q2\` or \`Q2 2026\`. A month or day that doesn't exist (\`2026-02-30\`) is an error. There are no times
  of day.
- **Deep time,** counted back from \`now\` (years ago, not years after the Big Bang):
  \`66Ma\`, \`4.5 Ga\`, \`11.7ka\`; the space before the unit is optional, and \`~\` works too. Units:
  \`Ga\` \`Gya\` \`bya\`; \`Ma\` \`Mya\`; \`ka\` \`kya\`; \`years ago\` \`yr ago\` (years). The sign is
  ignored: \`-66Ma\` and \`66Ma\` are the same.
- **BP** counts back from 1950, as radiocarbon dates do: \`11700 BP\` is shown as "11,700 BP".
- \`now\`, \`today\` or \`present\` is the \`now\` date.
- **Approximate and uncertain:** \`~\` (shown as "c."), \`?\` (shown with a "?") or \`%\` (both),
  before or after the date: \`~1440\`, \`1440~\`, \`753 BCE?\`. \`c.\`, \`ca.\` or \`circa\` before
  it also means approximate. An uncertain event is drawn dashed; a fuzzy end of a span fades.

**Time scale and now** (ours)
- \`scale linear\`, \`scale log\` (or \`logarithmic\`) or \`scale auto\`, on its own line or as
  \`scale=log\` in the header. \`auto\` picks log when the oldest item is over 20,000 years ago and
  over 10,000 times older than the newest. An unknown value warns and uses \`auto\`.
- Log spaces items by how long before \`now\` they were: the deep past is squeezed to the left,
  the recent past stretched to the right. Use it to put the Big Bang and the printing press on one
  axis.
- **Use log for any history that gets busier toward the present,** not only deep time: a few
  early events, then most of them in the last decades. On a linear axis the recent ones pile up
  at the right edge; log gives them room. Write \`scale=log now=<today>\` in the header. \`auto\`
  won't pick it for this, so ask for it.
- If the recent part is still crowded on a log scale, split: one timeline for the whole sweep,
  with the busy period as a single \`span\`, and a second for that period alone, on a linear scale.
- \`now=<date>\` in the header, \`now=\` on the \`scale\` line, or a \`now <date>\` line; the header
  wins. Without it, \`now\` is today, so deep-time dates and the chart change from day to day. Set
  it for output that stays the same. An unreadable \`now\` warns.
- With \`now\` set and inside the axis, a dashed "Now" line is drawn. Not on a log scale.

**Mermaid's syntax**
- \`Period : event : event\`. Periods are evenly spaced columns, in the order written; their
  labels are any text, not dates. A colon splits only when a space or the line end follows it,
  so \`10:30\` stays whole.
- A line starting with \`:\` adds events to the period above it.
- \`section Name #color\` groups the periods under it into a colored band. Periods before the
  first section are ungrouped. With no sections, each period takes its own color.
- \`title Text\` and \`note Text\` work as in ours. \`accTitle\` and \`accDescr\` lines are ignored.
- Every other line becomes a period, even with no colon, so a typo shows up as an empty
  period, not an error.
- \`timeline TD\` or \`direction=vertical\` stacks the periods top to bottom. \`length\` warns and is ignored.
${clickSyntax("In ours, an event or span goes by its `id=` option (`event Launch 2026-09 id=ga`), or else its label as a lowercase slug (`launch`). In Mermaid's, periods and their events go by their text as a slug (`Week 1` is `week-1`). A repeat gets `-2`, `-3`.")}`,
    example: `
timeline "Atlas 2027 roadmap" now=2027-03-01
  era Build  2027-01 .. 2027-06 #sky
  era Launch 2027-07 .. 2027-12 #violet
  lane Platform #blue
    span  Storage rewrite      2027-01 .. 2027-04
    span  Multi-region         2027-04 .. 2027-08?
    event Postgres upgrade     2027-02-10
    milestone General availability 2027-09-01 !major
  lane Product #coral
    span  Onboarding v2        2027-02 .. 2027-05
    span  Mobile app           2027-06 .. 2027-11~
    event Beta invites         2027-03-15
  lane Go-to-market #green
    span  Private beta         2027-03 .. 2027-06
    event Launch week          2027-09-14 !major
    event Conference talk      2027-10-22?
  note Dates after now are targets; ? marks a date still being negotiated.`,
  },
  parse: parseTimeline,
  render: renderTimeline,
}
