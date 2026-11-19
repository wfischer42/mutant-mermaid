import { clickSyntax } from '../../core/hooks.ts'
import type { DiagramType } from '../../core/types.ts'
import { parseFlowchart } from './flowchart-parse.ts'
import type { FlowModel } from './model.ts'
import { renderGraph } from './render.ts'

/**
 * Mermaid's flowchart, in Mermaid's own syntax:
 *
 *   flowchart LR
 *     A[Push] --> B{Tests pass?}
 *     B -->|yes| C([Deploy])
 *     B -.->|no| D[Fix]
 *
 * Laid out with ELK's layered algorithm; subgraphs become tinted panels.
 */
export const flowchart: DiagramType<FlowModel> = {
  id: 'flowchart',
  keywords: ['flowchart', 'graph', 'flowchart-elk'],
  title: 'Flowchart',
  summary:
    'Mermaid flowchart syntax (nodes, shapes, links, subgraphs, classDef) on a cleaner layout.',
  guide: {
    useWhen: 'steps, decisions and handoffs run in an order, or boxes connect in a system.',
    syntax: `
Write Mermaid flowchart syntax. What is supported, and where it differs:

\`\`\`
flowchart LR                          %% direction: TB (default), TD, BT, LR, RL
  A[Push] --> B{Tests pass?}          %% a node is an id plus an optional shape
  B -->|yes| C([Deploy])              %% label in pipes…
  B -- no --> D[Fix]                  %% …or inside the link
  D -.-> A                            %% dotted
  C & D --> E & F                     %% & links every node on each side
  subgraph ci [CI pipeline]           %% id plus title; \`subgraph Title\` also works
    direction TB
    A
    B
  end
  classDef warn fill:#fde68a,stroke:#b45309
  class D warn                        %% or inline: D:::warn
  style E stroke:#2563eb
  linkStyle 0 stroke:#16a34a          %% by link index, from 0
\`\`\`

- **Header:** \`flowchart\` or \`graph\` (\`flowchart-elk\` is the same), then an optional direction.
  \`v ^ > <\` also work. Nothing else goes on this line: a title there is read as a node and
  warns. **Set a title in frontmatter** with \`title: Release flow\`.
- **Shapes:** \`[rect]\` \`(rounded)\` \`([stadium])\` \`[[subroutine]]\` \`[(cylinder)]\` \`((circle))\`
  \`(((double circle)))\` \`{diamond}\` \`{{hexagon}}\` \`[/lean right/]\` \`[\\lean left\\]\`
  \`[/trapezoid\\]\` \`[\\inverted trapezoid/]\` \`>flag]\`.
- **\`A@{ shape: name, label: "Text" }\`** takes these names: rect, proc, process, rectangle,
  rounded, event, stadium, pill, terminal, subroutine, subproc, fr-rect, cyl, cylinder, database,
  db, circle, circ, dbl-circ, double-circle, diamond, diam, decision, question, hex, hexagon,
  prepare, lean-r, in-out, lean-l, out-in, trap-b, trapezoid, priority, trap-t, inv-trapezoid,
  manual, flag, odd, sm-circ, start, f-circ, junction (small filled dot), fr-circ, stop (ring),
  fork, join (bar), note. Any other name (cloud, doc, bolt, queue…) warns and draws a rect.
  There's no queue shape; \`[(Name)]\` (cylinder) is the usual stand-in. \`manual\` is a
  trapezoid, for a manual step.
- **Links:** \`-->\` arrow, \`---\` plain line, \`-.->\` dotted, \`==>\` thick, \`~~~\` invisible (affects
  layout only). Ends: \`<-->\` both ways, \`--o\` circle, \`--x\` cross. Extra length (\`--->\`) is
  accepted but does not stretch the link. Labels: \`-->|text|\`, \`-- text -->\`, \`== text ==>\`,
  \`-. text .->\`. Chains work: \`A --> B --> C\`.
- **Link ids** (\`A e1@--> B\`) are accepted. A \`e1@{ animate: true }\` line for that id is ignored,
  since the drawing is still. Text the parser can't read warns. **Ignored silently:**
  \`callback\`, \`link\`, \`title\`, \`accTitle\`, \`accDescr\`.
${clickSyntax('Nodes and subgraphs go by their id, links by their link id (`e1`) or as `A->B`.')}
- **Ids:** letters, digits, \`_\`, and \`.\` or \`-\` between them. Case matters. \`end\` alone on a line
  closes a subgraph. A node keeps the last shape and label it was given, so declare it once and
  then link by id.
- **Labels** are plain text. Quote them to use brackets or parens: \`A["Load (cached)"]\`. \`<br>\` or
  \`\\n\` breaks a line. Markdown, HTML tags and \`fa:fa-…\` icons are stripped, not drawn.
  Long labels wrap on their own.
- **Subgraphs** nest. A node belongs to the first subgraph that mentions it, so mention it inside
  first; links between subgraphs can go anywhere. Link to a subgraph by its id. A subgraph's
  \`direction\` is ignored when a link crosses its border. Missing or extra \`end\` warns.
- **Colors:** only \`fill\`, \`stroke\`, \`stroke-width\` and \`stroke-dasharray\` are used, and colors
  are re-toned to fit the theme, so pick a hue rather than an exact shade. \`classDef default\`
  styles every node. \`linkStyle\` takes \`default\` or indexes like \`0,2\` and uses only \`stroke\`;
  an index past the last link is ignored.
- **Defaults:** decisions are amber, stadiums and circles accent, nodes in a subgraph take its
  color. Leave styling out unless a color means something.
- \`;\` separates statements on one line.`,
    example: `
---
title: Release process
---
flowchart LR
  pr([Pull request]) --> ci[[Run CI]]
  ci --> ok{Checks pass?}
  ok -- no --> fix[Fix and push]
  fix -.-> ci
  ok -- yes --> review{Approved?}
  review -->|changes| fix
  review -->|yes| merge[Merge to main]
  subgraph deploy [Deploy]
    stage[Deploy to staging] --> smoke{Smoke tests}
    smoke -->|pass| prod([Release to production])
  end
  merge --> stage
  smoke -->|fail| rollback[Roll back]
  rollback --> fix
  classDef danger fill:#fecaca,stroke:#dc2626
  class rollback danger`,
  },
  parse: parseFlowchart,
  render: renderGraph,
}
