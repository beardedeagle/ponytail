#!/usr/bin/env node
// ponytail — Claude Code SessionStart activation hook (also Codex, Copilot,
// Grok, Cursor and Qwen Code sessionStart)
//
// Runs on every session start:
//   1. Writes flag file at $CLAUDE_CONFIG_DIR/.ponytail-active (defaults to
//      ~/.claude, or ~/.qwen under Qwen Code; statusline reads this)
//   2. Emits ponytail ruleset as hidden SessionStart context
//   3. Detects missing statusline config and emits setup nudge

const fs = require('fs');
const path = require('path');
const { getDefaultMode, getClaudeDir, isShellSafe } = require('./ponytail-config');
const { getPonytailInstructions } = require('./ponytail-instructions');
const {
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodex,
  isCopilot,
  isCursor,
  isQwen,
  setMode,
  stateDir,
  writeHookOutput,
} = require('./ponytail-runtime');

const claudeDir = getClaudeDir();
// Qwen reads its settings — and its statusLine, nested under "ui" — from
// ~/.qwen/settings.json, which is also where its hooks keep the mode flag.
// Qoder stays on the Claude path: it has no verified settings-file contract,
// and guessing one would be worse than the status quo.
const settingsDir = isQwen ? stateDir : claudeDir;
const settingsPath = path.join(settingsDir, 'settings.json');

const mode = getDefaultMode();

// "off" mode — skip activation entirely, don't write flag or emit rules
if (mode === 'off') {
  clearMode();
  // Qwen adds a command hook's raw stdout to the model context, so a bare "OK"
  // would land as context noise rather than reading as an acknowledgement.
  const hookOutput = (isCodex || isCopilot || isCursor || isQwen) ? '' : 'OK';
  writeHookOutput('SessionStart', 'off', hookOutput);
  process.exit(0);
}

// Cursor with the always-on rule in the workspace: the rule already carries the
// ruleset and would contradict any other level, so leave the flag alone and
// hand the model a one-line notice instead of a second copy (#817).
if (isCursor) {
  const rule = cursorRulePath();
  if (rule) {
    try {
      writeHookOutput('SessionStart', mode, cursorRuleNotice(rule));
    } catch (e) {
      // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
    }
    process.exit(0);
  }
}

// 1. Write flag file
try {
  setMode(mode);
} catch (e) {
  // Silent fail -- flag is best-effort, don't block the hook
}

// 2. Emit the ponytail ruleset, filtered to the active intensity level.
let output = getPonytailInstructions(mode);

// 3. Detect missing statusline config — nudge Claude to help set it up
if (!isCodex && !isCopilot && !isCursor) try {
  let hasStatusline = false;
  if (fs.existsSync(settingsPath)) {
    // Strip UTF-8 BOM some editors prepend on Windows (breaks JSON.parse)
    const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    const settings = JSON.parse(raw);
    // Qwen nests it: { "ui": { "statusLine": { ... } } }
    if (isQwen ? settings.ui && settings.ui.statusLine : settings.statusLine) {
      hasStatusline = true;
    }
  }

  // Nudge at most once — the flag file marks that the user has already seen
  // (and implicitly declined) the statusline setup offer. Repeating it every
  // session start turns a helpful hint into a nag.
  const nudgeFlagPath = path.join(settingsDir, '.ponytail-statusline-nudged');
  if (!hasStatusline && !fs.existsSync(nudgeFlagPath)) {
    try { fs.writeFileSync(nudgeFlagPath, ''); } catch (e) { /* best-effort */ }
    const isWindows = process.platform === 'win32';
    const scriptName = isWindows ? 'ponytail-statusline.ps1' : 'ponytail-statusline.sh';
    const scriptPath = path.join(__dirname, scriptName);
    // Hosts that keep the flag outside ~/.claude (Qwen) get their state dir
    // passed explicitly, so the badge reads what the hooks wrote. An argument
    // behaves the same on both platforms and does not depend on the statusline
    // child inheriting host env vars. No argument means the old default, so
    // already-configured installs keep working.
    const stateArg = stateDir === claudeDir ? '' : ` "${stateDir}"`;
    if (isShellSafe(scriptPath) && (!stateArg || isShellSafe(stateDir))) {
      const command = (isWindows
        ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
        : `bash "${scriptPath}"`) + stateArg;
      // Qwen's statusLine lives under "ui", not at the top level.
      const statusLineSnippet = isQwen
        ? '"ui": { "statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' } }'
        : '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode " +
        "(e.g. [PONYTAIL], [PONYTAIL:ULTRA]). It is not configured yet. " +
        "To enable, add this to " + settingsPath + ": " +
        statusLineSnippet + " " +
        "Proactively offer to set this up for the user on first interaction.";
    } else {
      // ponytail: install path or state dir has shell metacharacters — don't
      // embed it in a command snippet; have the agent wire it up by hand instead.
      output += "\n\n" +
        "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode. " +
        "Its install path or state directory contains characters unsafe to embed in a shell command, so configure it manually: " +
        "add a statusLine command of type \"command\" that runs " + scriptName +
        (stateArg ? " with " + stateDir + " as its first argument" : "") +
        " from the plugin's hooks directory to " + settingsPath + ", quoting/escaping the path for your shell. " +
        "Proactively offer to set this up for the user on first interaction.";
    }
  }
} catch (e) {
  // Silent fail — don't block session start over statusline detection
}

try {
  writeHookOutput('SessionStart', mode, output);
} catch (e) {
  // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
}
