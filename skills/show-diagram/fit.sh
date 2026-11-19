#!/bin/sh
# Usage: fit.sh PNG SCALE  Shows a diagram PNG (rendered at SCALE px per SVG unit) so its 14-unit body text
# appears at 14pt. Redraws on resize; Ctrl-C closes.
png=$1 scale=$2
[ -f "$png" ] || { echo "Diagram image is gone: $png"; echo "Render it again to show it."; read _; exit 1; }
w=$(sips -g pixelWidth "$png" | awk '/pixelWidth/{print $2}')
h=$(sips -g pixelHeight "$png" | awk '/pixelHeight/{print $2}')
wipe() { printf '\033_Ga=d\033\\'; clear; }
trap 'wipe; exit 0' INT TERM HUP
while [ "$(stty size)" = "24 80" ]; do sleep 0.2; done
while :; do
  size=$(stty size)
  wipe
  # shortcut: calibrated on the Mac, where a 28px cell is 14pt (12pt font); 14pt text = cell_h/14 px per unit.
  # Other devices scale with their terminal font, not true points.
  geo=$(rex block call -b "$REX_BLOCK" size | jq -r --argjson w "$w" --argjson h "$h" --argjson s "$scale" '
    (.cell_height_px / 14 / $s) as $k
    | [([.columns, ($w * $k / .cell_width_px | ceil)] | min), ($h * $k / .cell_height_px | ceil)]
    | "\(.[0])x\(.[1])"')
  timg -pk -U -g "$geo" "$png"
  while [ "$(stty size)" = "$size" ]; do sleep 0.3; done
done
