import { clickSyntax } from '../../core/hooks.ts'
import type { DiagramType } from '../../core/types.ts'
import type { FlowModel } from './model.ts'
import { renderGraph } from './render.ts'
import { parseState } from './state-parse.ts'

/**
 * Mermaid's state diagram, in Mermaid's own syntax:
 *
 *   stateDiagram-v2
 *     [*] --> Idle
 *     Idle --> Running : start
 *     state Running {
 *       [*] --> Working
 *     }
 *     Running --> [*]
 */
export const stateDiagram: DiagramType<FlowModel> = {
  id: 'state',
  keywords: ['stateDiagram', 'stateDiagram-v2'],
  title: 'State diagram',
  summary: 'Mermaid stateDiagram-v2 syntax: states, transitions, composites, forks, notes.',
  guide: {
    useWhen: 'something moves between a fixed set of states and the transitions are the point.',
    syntax: `
Write Mermaid \`stateDiagram-v2\` syntax. What is supported, and where it differs:

\`\`\`
stateDiagram-v2                       %% or stateDiagram; nothing else on this line
  direction LR                        %% TB (default), TD, BT, LR, RL
  [*] --> Idle                        %% [*] is the start, or the end when it's the target
  Idle --> Running : start            %% transition with a label
  Running --> Idle                    %% labels are optional
  state "Waiting for payment" as Wait %% a display name for an id
  Wait : Holds stock 30 min           %% a description; repeat for more lines
  state check <<choice>>              %% also <<fork>> and <<join>>
  state Running {                     %% composite state
    [*] --> Working
    Working --> [*]
  }
  note right of Idle : Polls every 5s %% or a block ending with \`end note\`
  classDef bad fill:#fecaca
  class Wait bad                      %% or inline: Running --> Failed:::bad
\`\`\`

- **One transition per line.** \`A --> B --> C\` is not read and warns. \`B <-- A\` also works.
- **State ids** are single words (no spaces, no quotes), and case matters. A state needs no
  declaration: a transition or a bare id on its own line creates it. Use
  \`state "Long name" as Id\` for a name with spaces.
- **Descriptions replace the name.** \`Id : text\` lines become the box's whole label, one line each,
  and the name from \`state "…" as Id\` is no longer shown. \`state Id : text\` sets it in one line.
- **\`[*]\`** is per composite: inside \`state X { }\` it is X's own start and end. Link to a
  composite by its id. Composites nest.
- **Choice, fork and join** draw as a small diamond and a bar, without a label. Put the conditions on
  the outgoing transitions.
- **Notes:** \`note left of X\` and \`note right of X\` both draw a note tied to X by a dotted line;
  the layout picks its side. \`note over\` is not supported and warns. A block note runs until
  \`end note\`: leave that out and every line after it becomes note text, with a warning at the
  note.
- **Concurrent regions:** a \`--\` line inside \`state Name { … }\` starts a new region. Regions sit
  side by side (stacked in \`LR\`), with a dashed line between them, and each has its own \`[*]\`.
  A state belongs to the region where it first appears. \`--\` outside a composite warns. An
  unclosed \`{\` is closed for you and warns; an extra \`}\` warns too.
- **Ignored silently:** \`hide empty description\`, \`scale\`, \`skinparam\`, \`title\`, \`accTitle\`,
  \`accDescr\`. Set a title in frontmatter with \`title: Order lifecycle\`.
${clickSyntax('States and composites go by their id, transitions as `A->B`.')}
- **Styling:** \`classDef\`, \`class A,B name\`, \`:::name\` and \`style Id fill:…,stroke:…\`. Only
  \`fill\`, \`stroke\`, \`stroke-width\` and \`stroke-dasharray\` are used, re-toned to the theme.
  \`classDef default\` styles every state.
- States are drawn as rounded boxes in the accent color; each composite gets its own tint.`,
    example: `
---
title: Order lifecycle
---
stateDiagram-v2
  [*] --> Pending
  Pending --> Paid : payment captured
  Pending --> Cancelled : timeout (30 min)
  Paid --> Fulfilment
  state Fulfilment {
    [*] --> Picking
    Picking --> Packing
    Packing --> Shipped : label printed
    Shipped --> [*]
  }
  Fulfilment --> Delivered
  Delivered --> Returned : customer return
  Returned --> Refunded
  Delivered --> [*]
  Refunded --> [*]
  Cancelled --> [*]
  note right of Pending
    Holds stock for 30 minutes
    before releasing it.
  end note`,
  },
  parse: parseState,
  render: renderGraph,
}
