---
name: show-diagram
description: Render a Mermaid or mutant-mermaid diagram to PNG and show it beside the session (a Rex or tmux pane, else the system image viewer). Use whenever you would print a mermaid code block for the user, or they ask to see, draw or render a diagram, flowchart, sequence, state, mindmap, timeline, pyramid, matrix or causal-loop diagram.
---

# Show a diagram

Claude Code can't draw images in its own output, so the diagram goes to a PNG and is shown beside the session:

- **In Rex** (`$REX_SESSION` set): a `Diagram` pane to the right, which redraws on resize and keeps text at about 14pt. Ctrl-C in it closes it.
- **In tmux** with `timg` installed: a pane to the right. Press Enter in it to close it.
- **Anywhere else:** the system image viewer (Preview on macOS, `xdg-open` on Linux).
- **In a chat with an inline visual tool** (such as `show_widget` on claude.ai): skip `show.sh` and run `${CLAUDE_SKILL_DIR}/mm.sh render /abs/path/diagram.mmd --inline`. It prints one `<img>` tag; pass it as the widget's HTML, unchanged. Don't pass raw SVG (the chat's final redraw drops parts of it) and don't print file:// links. Offer the PNG only if the user asks for a file.
- **In Claude Desktop's Cowork** none of these exist, so the PNG file is the result: write the source to a `diagrams/` folder inside the folder the user shared, so the PNG lands where they can open it. Name it with the date, time and a short slug (`diagrams/2026-11-17-1430-whole-story.mmd`), and save each revision under a new name (`…-whole-story-2.mmd`) rather than overwriting, so every version stays for review.

1. Write the source to a `.mmd` file in your scratchpad (or the project, if it belongs there). Standard Mermaid and mutant-mermaid syntax both work.
   - `${CLAUDE_SKILL_DIR}/mm.sh guide` lists the mutant types; `${CLAUDE_SKILL_DIR}/mm.sh guide pyramid` prints one type's syntax and example.
   - `${CLAUDE_SKILL_DIR}/../../docs/AGENTS.md` says which type fits which kind of idea, and (section 2) how much each type holds before readers stop following. Give each diagram one point and stay within that budget; show two or three diagrams in a reply at most, where the shape is the point.
2. Run `${CLAUDE_SKILL_DIR}/show.sh /abs/path/diagram.mmd`. Extra flags pass to the renderer: `--dark`, `--theme NAME`, `--look NAME`. It replaces the previous diagram pane. The first run installs the renderer's packages, which takes a few seconds.
3. If it fails, the error has line numbers: fix the source and run it again. Then open the PNG and look at it yourself before you show or describe it. If it warns that the diagram is too big to read, or the picture looks like spaghetti (long links across it, lines through labels), don't show it: simplify or split it as `docs/AGENTS.md` section 5 says, and show the diagrams in order. If labels overlap or bunch up, fix the source and render again: on a timeline whose recent events crowd one end, add `scale=log now=<today>` to the header, and split the busy period into its own timeline if it's still crowded.
4. In a local terminal or desktop session, print the PNG path it printed as a markdown link in your reply: `[diagram](file:///abs/path/diagram.png)`.

No browser is needed: stock Mermaid types (sequence, class, ER, gantt…) render in Node too.

## Change the Rex pane when asked

`b=$(rex block ls -s "$REX_SESSION" --json | jq -r '.blocks[] | select(.label=="Diagram") | .block_id')`, then:

- Width: `rex api call session.resize_pane '{"session_id":"'$REX_SESSION'","direction":"horizontal","before_block_id":"'$REX_BLOCK'","after_block_id":"'$b'","ratio":0.3}'` (ratio is this pane's share, so 0.3 gives the diagram 70%).
- Full window and back: `rex zoom -s "$REX_SESSION" $b` (run again to undo).
- Floating window: `rex api call session.float_block` with `block_id` and `bounds` `[x, y, w, h]` as window fractions.
