#!/bin/sh
# Usage: show.sh FILE.mmd [render flags, e.g. --dark --theme meadow]
# Renders a Mermaid or mutant-mermaid file to PNG beside it, prints the PNG's path and shows it: in a
# "Diagram" pane in Rex, in a pane to the right in tmux (with timg), else in the system image viewer.
set -e
here=$(cd "$(dirname "$0")" && pwd)
src=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
shift
png="${src%.*}.png"
"$here/mm.sh" render "$src" -o "$png" --scale 3 "$@"
echo "$png"
if [ -n "$REX_SESSION" ]; then
  old=$(rex block ls -s "$REX_SESSION" --json | jq -r '.blocks[] | select(.label=="Diagram") | .block_id')
  [ -n "$old" ] && rex block close -s "$REX_SESSION" $old
  rex split -s "$REX_SESSION" -b "$REX_BLOCK" --label Diagram --focus=false -- "$here/fit.sh" "$png" 3 >/dev/null
elif [ -n "$TMUX" ] && command -v timg >/dev/null; then
  old=$(tmux list-panes -F '#{pane_id} #{pane_title}' | awk '$2=="mm-diagram" {print $1}')
  [ -n "$old" ] && tmux kill-pane -t "$old"
  pane=$(tmux split-window -h -d -P -F '#{pane_id}' "timg -U '$png'; read _")
  tmux select-pane -t "$pane" -T mm-diagram
elif command -v open >/dev/null && [ "$(uname)" = Darwin ]; then
  open "$png"
elif command -v xdg-open >/dev/null; then
  xdg-open "$png" >/dev/null 2>&1 &
fi
