# Using Mutant Mermaid as an agent

How to turn a concept, or a person's notes, into a diagram.

## 1. Pick the type from the shape of the idea

| The idea is… | Use |
|---|---|
| A hierarchy with a base (needs, priorities, a value chain) | `pyramid` (`funnel` if it narrows as it goes down) |
| Stages that repeat | `cycle`; `flywheel` if each turn feeds the next |
| A stack of layers that build on each other | `layers`, or `layers style=onion` for nested scopes |
| Items rated on two axes | `matrix` |
| A fixed set of named boxes (SWOT, lean canvas, retro) | `canvas` / `swot` |
| Options or states side by side | `compare` / `before-after` |
| Positions between two extremes | `spectrum` |
| Free-form notes branching from one topic | `mindmap` |
| A decision with pros and cons | `argue` |
| A question broken into parts | `tree` |
| Things that influence each other, with feedback | `cld` |
| Quantities that accumulate and drain | `stockflow` |
| Things over time, at any scale | `timeline` (add `length=wide` for many events, `TD` for vertical) |
| A process with decisions | `flowchart` |
| A lifecycle | `stateDiagram-v2` |
| A screen, page or dialog to sketch | `wireframe` (`device=phone`, `tablet` or `browser`) |
| Messages between parties | `sequenceDiagram` (rendered by Mermaid) |
| Data model, classes, a schedule, proportions, flows of quantity | Mermaid `erDiagram`, `classDiagram`, `gantt`, `pie`, `sankey-beta` |

If you're not sure of a type's syntax, copy the closest file in `examples/<family>/` and edit it.

## 2. Plan for a reader who glances

A diagram earns its place when the reader gets its point in a few seconds. Before writing one:

- **One point per diagram.** Say the point in a sentence first; it becomes the title. If you
  need "and" to say it, that's two diagrams.
- **Budget it before you draw.** Past these, readers stop following, however good the layout:

  | Type | Aim for | Hard limit |
  |---|---|---|
  | `cld` | 2–4 loops, 6–10 variables | 6 loops, 12 variables, 15 links |
  | `flowchart`, `stateDiagram-v2` | 5–10 steps | 15 steps |
  | `mindmap`, `tree` | 3–5 branches, 15–20 leaves | 30 leaves |
  | `timeline` | 6–12 events | 20 events, or `length=wide` |
  | `pyramid`, `cycle`, `layers`, `spectrum` | 3–6 items | 7 items |
  | `matrix`, `canvas`, `compare` | 2–4 items per cell or box | 6 per cell |

- **Fewer diagrams, used well.** In a reply, show a diagram where the shape is the point (a loop,
  a hierarchy, a sequence), not for every paragraph. Two or three in one answer at most; a series
  only when you split one big picture into its stories (see 5).
- **Let the text carry the detail.** The diagram shows structure; numbers, caveats and examples
  go in the prose around it or in ` : notes`.
- **Start small and add.** Draw the core first, look at it, then add what's missing. It's easier
  to see what a diagram needs than what it can lose.

## 3. Write a short source

- Put a header line first: `keyword "Title" key=value`. Then indent the content under it.
- Use real names from the notes. Keep each label under about 40 characters, and put detail in
  ` : notes`.
- An icon can lead a label where it helps the reader find a thing at a glance: `:user: Customer`,
  `:database: Orders`. Names come from lucide.dev/icons. Use them for a few kinds of thing, not on
  every label.
- Don't set colors unless they carry meaning. The palette already gives each group its own color.
  Use `#red`/`#green` only when meaning calls for it, for example for risks and wins.

## 4. Render and look at it

```sh
pnpm exec tsx src/cli.ts render diagram.mmd -o diagram.png
```

- If the source is wrong, the command exits with code 1 and prints the line number and the fix.
  Fix the source and run it again.
- Open the PNG and look at it before showing it; don't assume it came out right. Look for:
  - text cut off, or labels overlapping each other or running into lines;
  - crowded areas that would read better split into two diagrams;
  - on a timeline, labels stacked in tall towers or squeezed to one end: most often recent
    events crowding a linear axis. Switch to `scale=log now=<today>`, or `length=wide`; if it's
    still crowded, split off the busy period as its own timeline;
  - wrong emphasis.
- If anything is crowded, change the source and render again, and look again. Show the reader
  only a version you've checked.
- `--theme ink` suits technical material. `--theme paper` suits essays. Add `--dark` for dark pages,
  or use `midnight`/`carbon` for very dark ones. `stark` is for projectors, print and readers who
  need high contrast. `--look boxy` gives square corners.
- For a page that only needs SVG, leave out `-o`: the SVG goes to stdout. It follows the reader's
  light or dark setting unless `--dark` fixes it.
- Read the warnings. A warning that a diagram is too big to read means: split it (see 5). A
  causal loop diagram also checks its own drawing and warns when it came out tangled, naming any
  link that runs through a variable it doesn't touch: a reader takes that as a connection. Fix
  it by cutting that link or a variable near it, then render again.

## 5. When a diagram turns to spaghetti

A diagram stops working long before the layout fails: past about 6 loops, 12 variables or 15
links in a causal loop diagram (12 boxes or 20 links elsewhere), the reader can't follow it,
however it's drawn. Up to 4 loops draws cleanly almost every time; from 7, almost never. Long links across the page, lines
through labels, and markers far from their loops are the signs. Don't fight the layout; give the
reader less to hold at once.

**Simplify first.** Each of these keeps one diagram but cuts what's on it:

- Drop what the point doesn't need: a variable that only relays (A → B → C, nothing else touching
  B) can become A → C. Drop side branches that close no loop.
- Merge near-duplicates: "Policy capture" and "Regulatory capture" are one variable.
- Name fewer loops. Name the ones the text talks about; leave the rest unnamed.
- Cut the labels down: 2–3 words per variable.

**Then split.** When it still holds several stories, draw one diagram per story:

1. Pick the stories from the reader's point of view: what are the 2–4 things they should take
   away? In systems terms, usually one engine (the reinforcing loops that drive it), each brake or
   limit (the balancing loops), and the counter-move.
2. Give each diagram the loops of its story only: 3–5 of them, 6–12 variables. Don't split
   further than that. A diagram with 1–2 loops and 3–4 variables says too little alone; merge it
   with its neighbour, especially when they share a hub (two 2-loop diagrams round the same
   variable make one 4-loop diagram).
3. Repeat a shared variable in every diagram it belongs to, spelled the same. That's how the
   reader joins them up; a shared hub like "Concentrated power" can sit in all of them.
4. Order them so each builds on the last, and title each with its story ("The engine: enclosure
   feeds itself"), not a part number.
5. If the whole still matters, end with an overview: the stories as boxes in a `flowchart`, or one
   small `cld` with each story collapsed to a single variable.

The same goes for the other types: a flowchart with more than about 15 steps splits into an
overview and one chart per phase; a mind map with more than about 30 leaves splits by branch.
