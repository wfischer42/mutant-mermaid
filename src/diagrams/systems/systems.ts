import { clickSyntax } from '../../core/hooks.ts'
import type { Context, DiagramType, Drawing, Parsed } from '../../core/types.ts'
import { analyse, renderCld } from './cld.ts'
import type { SystemsModel } from './model.ts'
import { parseSystems } from './parse.ts'
import { analyseStockFlow, renderStockFlow } from './stockflow.ts'

/**
 * Parses, then adds what the loop analysis has to say about declared loops (a letter the links
 * contradict, a name with no loop left), so those warnings reach the render result.
 */
function parseWithLoops(source: string): Parsed<SystemsModel> {
  const parsed = parseSystems(source)
  if (!parsed.model) return parsed
  const analysis =
    parsed.model.mode === 'stockflow' ? analyseStockFlow(parsed.model) : analyse(parsed.model)
  return { model: parsed.model, diagnostics: [...parsed.diagnostics, ...analysis.diagnostics] }
}

/** Draws whichever kind the source turned out to be: any stock or flow makes it stock & flow. */
function renderSystems(model: SystemsModel, ctx: Context): Drawing {
  return model.mode === 'stockflow' ? renderStockFlow(model, ctx) : renderCld(model, ctx)
}

export const causalLoop: DiagramType<SystemsModel> = {
  id: 'cld',
  keywords: ['cld', 'causal'],
  title: 'Causal loop diagram',
  summary:
    'Variables linked by + and − influences; feedback loops are found, classed reinforcing or balancing and drawn as rings.',
  guide: {
    useWhen: 'things influence each other and the feedback loops are the point.',
    syntax: `
One link per line, \`From -> To : polarity\`:

\`\`\`
cld "Title"
  Sales -> "Word of mouth" : +        %% + : To moves the same way as From
  Price -> Demand : -                 %% - : To moves the opposite way
  Construction -> Supply : + ||       %% || marks a delay
  loop R "Word of mouth"              %% names a reinforcing loop
  loop B1 "Saturation": Demand, Price %% names the loop through exactly these
  kind Market: Demand, Price          %% fills these dots in one color, with a legend
  trend Sales: s-curve                %% sketches how Sales moves over time
\`\`\`

- **Variables** come from the links, so nothing is declared. Name them as quantities that can rise
  or fall ("Housing demand", not "Demand goes up"). Quote names that have spaces; single words
  need no quotes. Spell a name the same way, case included, everywhere it appears. A bare
  \`snake_case\` name is shown with spaces.
- **Arrows:** \`->\`, \`-->\` or \`→\`.
- **Polarity:** \`+\`, \`s\` or \`same\`; \`-\`, \`o\` or \`opposite\`. A link without one gets a
  warning and counts as \`+\`. The colon can be left out: \`A -> B +\`.
- **Delay:** \`||\`, \`//\` or \`delay\` after the polarity, or joined to it: \`-||\`.
- **Loops are found for you.** Each is classed by its links: an even number of \`-\` makes it
  reinforcing (R), an odd number balancing (B). Each loop gets a tag (R1, B1…) for \`loop\`, \`trend\`
  and \`click\` lines to use, but the drawing shows no tags: loops are told apart by color and by
  name, and an unnamed loop's marker shows only its sketch.
- **\`loop\` only names a loop.** It never adds links, so a loop exists only if the links close it.
  Write \`loop\` lines after the links. Naming loops is optional.
- **Picking which loop a name goes on:**
  - \`loop R "Name"\` takes the most important loop of that kind not yet named. Several such
    lines take distinct loops, in order.
  - \`loop B "Name": A, B, C\` takes the loop whose variables are exactly A, B and C, in any order.
    Every variable on the loop must be listed. With more than one loop of a kind, list them.
  - A number (\`R2\`) fixes the tag. Without one, tags are numbered in order.
- **Get the letter right:** count the \`-\` links around the loop before writing R or B. If the
  letter disagrees with the links, the links win and you get a warning.
- Links take their loop's color: clay for reinforcing, slate for balancing. Set \`tint: off\` in frontmatter to keep them grey.
- **\`kind Name: A, B\`** groups variables by type: each kind fills its dots in its own color, and a
  legend lists the kinds. Optional; use it when the types matter to the reader.
- **\`trend X: shape\`** draws a small sketch of how X behaves over time inside its dot, which
  grows to hold it. Shapes: \`grow\`, \`decline\`, \`approach\` (settles at a level), \`s-curve\`,
  \`oscillate\`. Every loop's marker holds one for you, above its name: R
  grows, B approaches, a B with a delay oscillates. \`trend B1: s-curve\` overrides a loop's.
- **Keep it small:** at most 6 loops, 4 through any one variable, 12 variables and 15 links; past
  that you get a warning and a tangle. Up to 4 loops draws cleanly almost every time. Split a bigger story into several diagrams, 3–5 loops each (the
  engine, each brake, the counter-move), repeating shared variables, spelled the same, in each.
  Don't go smaller: a 1–2 loop diagram belongs merged with its neighbour.
- Don't add \`stock\` or \`flow\` lines: they turn the diagram into a \`stockflow\`.
${clickSyntax('Variables go by their name as written, quoted when it has spaces (`click "Word of mouth" openCard`), links as `Adopters->Word of mouth` (quoted the same way), loops by their tag (`R1`, `B2`).')}`,
    example: `
cld "Product adoption"
  Adopters -> "Word of mouth" : +
  "Word of mouth" -> "Adoption rate" : +
  "Adoption rate" -> Adopters : +
  "Potential adopters" -> "Adoption rate" : +
  "Adoption rate" -> "Potential adopters" : - ||
  loop R "Word of mouth"
  loop B "Market saturation"`,
  },
  parse: parseWithLoops,
  render: renderSystems,
}

export const stockFlow: DiagramType<SystemsModel> = {
  id: 'stockflow',
  keywords: ['stockflow', 'sfd'],
  title: 'Stock and flow',
  summary:
    'Stocks filled and drained by flows through valves, with auxiliaries and information links.',
  guide: {
    useWhen: 'something accumulates, and what fills and drains it is the point.',
    syntax: `
Declare stocks and flows, then link what drives the flows:

\`\`\`
stockflow "Title"
  stock Population                    %% a box: something that accumulates
  flow births : cloud -> Population   %% a pipe with a valve, From -> To
  flow deaths : Population -> cloud   %% cloud: outside the model
  aux birth_rate                      %% a small circle: a constant or a calculation
  birth_rate -> births : +            %% an information link, as in cld
  Population -> deaths : +
  loop B "Mortality"                  %% names a loop, as in cld
\`\`\`

- **Stocks:** \`stock A\`, or several at once: \`stock A, "B c"\`. A name at either end of a flow
  becomes a stock even if not declared. Stocks sit in one row, in the order flows chain them;
  stocks no flow touches go at the end.
- **Flows:** \`flow name : From -> To\` (\`rate\` means the same). The colon and the arrow are
  required. Each end is a stock or a cloud: \`cloud\`, \`source\`, \`sink\`, \`()\` or \`*\`. Give every
  flow at least one stock: a flow from cloud to cloud warns and is drawn as an aux.
- **Auxiliaries:** \`aux\`, \`auxiliary\`, \`var\` or \`variable\`, then one name or a comma list.
  Declaring them is optional: any name in a link that isn't a stock or a flow is drawn as an
  auxiliary, above the row, near what it drives.
- **Names** work as in cld: quote names with spaces, spell them the same everywhere (case
  included), and a bare \`snake_case\` name is shown with spaces.
- **Links:** \`From -> To : polarity\`, exactly as in cld (\`->\`, \`-->\` or \`→\`; \`+\` or \`-\` and
  their aliases). Point links at flows to drive a rate; only flows change a stock. A link with an
  unknown mark warns. A delay (\`||\`) draws two ticks across the link, as in cld.
- **Sign every link on a loop.** Polarity is optional here and nothing warns without it, but a
  loop through an unsigned link isn't found.
- **Loops are found for you,** through links and flows: an inflow raises its stock (+), an
  outflow lowers it (-). A \`+\` link means more of the source, more of the target, whether the
  target is a flow or an aux. So \`Population -> births : +\` closes a reinforcing loop and
  \`Population -> deaths : +\` a balancing one. Every loop found gets a badge. Links show
  direction and sign only: there's no way to write an equation or a time constant.
- **\`loop\` names a loop,** with cld's rules: \`loop R "Name"\` takes the most important unnamed
  loop of that kind; \`loop B "Name": A, b, c\` takes the loop through exactly those names, flows
  included. With several loops of a kind, list the members, or a name can land on the wrong one.
- **Loop lines warn as in cld:** a wrong R or B warns and the loop is drawn as the kind its links give, and
  a member list that matches no loop warns and is dropped.
- Links on a loop take that loop's color. There is no \`tint\` option here.
- A \`cld\` source with a \`stock\` or \`flow\` line is drawn as this type.
${clickSyntax('Stocks, flows and auxiliaries go by their name as written (quoted when it has spaces), links as `From->To`, loops by their tag (`R1`, `B2`).')}`,
    example: `
stockflow "Customer base"
  stock Prospects
  stock Customers
  flow leads : cloud -> Prospects
  flow acquisition : Prospects -> Customers
  flow churn : Customers -> cloud
  aux marketing_spend
  aux referrals
  aux churn_rate
  marketing_spend -> leads : +
  Prospects -> acquisition : +
  Customers -> referrals : +
  referrals -> acquisition : +
  Customers -> churn : +
  churn_rate -> churn : +
  loop R "Word of mouth": Customers, referrals, acquisition
  loop B "Running out of prospects": Prospects, acquisition
  loop B "Churn": Customers, churn`,
  },
  parse: parseWithLoops,
  render: renderSystems,
}
