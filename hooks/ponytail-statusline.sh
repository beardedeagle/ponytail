#!/usr/bin/env bash
# Where the flag lives: an explicit first argument (ponytail-activate.js embeds
# it for hosts that keep state outside ~/.claude, e.g. Qwen's ~/.qwen), then
# CLAUDE_CONFIG_DIR, then ~/.claude — matching where the hooks write it (#34).
state_dir="${1:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}}"
flag="$state_dir/.ponytail-active"
[ -f "$flag" ] || exit 0

mode=$(head -n1 "$flag" | tr -d '[:space:]')

# ultra is the high-intensity mode; flag it amber so it stands out from the
# default green at a glance. The level is still in the text, so color is a
# redundant cue, not the only one.
color=108
[ "$mode" = "ultra" ] && color=173

if [ -z "$mode" ] || [ "$mode" = "full" ]; then
    printf '\033[38;5;%sm[PONYTAIL]\033[0m' "$color"
else
    printf '\033[38;5;%sm[PONYTAIL:%s]\033[0m' "$color" "$(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')"
fi
