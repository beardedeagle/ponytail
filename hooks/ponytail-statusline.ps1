param([string]$StateDir)
# Where the flag lives: an explicit argument (ponytail-activate.js embeds it for
# hosts that keep state outside ~/.claude, e.g. Qwen's ~/.qwen), then
# CLAUDE_CONFIG_DIR, then ~/.claude — matching where the hooks write it (#34).
if ([string]::IsNullOrEmpty($StateDir)) {
    $StateDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
}
$Flag = Join-Path $StateDir ".ponytail-active"
if (-not (Test-Path $Flag)) {
    exit 0
}

$Mode = ""
try {
    $Mode = (Get-Content $Flag -ErrorAction Stop | Select-Object -First 1).Trim()
} catch {
    exit 0
}

$Esc = [char]27
# ultra is the high-intensity mode; flag it amber so it stands out from the
# default green. The level is still in the text, so color is a redundant cue.
$Color = if ($Mode -eq "ultra") { "173" } else { "108" }
if ([string]::IsNullOrEmpty($Mode) -or $Mode -eq "full") {
    [Console]::Write("${Esc}[38;5;${Color}m[PONYTAIL]${Esc}[0m")
} else {
    $Suffix = $Mode.ToUpperInvariant()
    [Console]::Write("${Esc}[38;5;${Color}m[PONYTAIL:$Suffix]${Esc}[0m")
}
