#!/usr/bin/env node
// ponytail — removes state ponytail wrote outside the plugin's own files:
// the mode flag, the config file, the statusLine entry it added to
// settings.json, and its entries in ~/.cursor/hooks.json. Qwen keeps its flag
// and its nested ui.statusLine in ~/.qwen, so those are cleaned too. Plugin
// files themselves are removed by each host's own uninstall command (see
// README); this only cleans up what those commands can't see.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getConfigPath, getClaudeDir } = require('../hooks/ponytail-config');
const cursorHooks = require('./cursor-hooks');

const STATUSLINE_SCRIPT = 'ponytail-statusline';

function removeIfExists(filePath, label) {
  try {
    fs.unlinkSync(filePath);
    console.log(`Removed ${label}: ${filePath}`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

removeIfExists(path.join(getClaudeDir(), '.ponytail-active'), 'mode flag');
removeIfExists(path.join(os.homedir(), '.cursor', '.ponytail-active'), 'Cursor mode flag');
removeIfExists(path.join(os.homedir(), '.qwen', '.ponytail-active'), 'Qwen mode flag');
removeIfExists(getConfigPath(), 'config file');

// Cursor hooks (#817): drop only ponytail's entries from ~/.cursor/hooks.json,
// keep every other hook the user configured there.
try {
  const hooksFile = cursorHooks.uninstall('user');
  if (hooksFile) console.log(`Removed ponytail hooks from ${hooksFile}`);
} catch (e) {
  if (e instanceof SyntaxError) {
    // ponytail: malformed hooks.json — can't safely edit it; leave intact, warn
    console.warn(`~/.cursor/hooks.json is malformed — could not remove the ponytail hook entries. Remove them manually from: ${cursorHooks.hooksPath('user')} (${e.message})`);
  } else {
    throw e;
  }
}

// Remove the statusLine entry the setup nudge told the user to add. Claude keeps
// it at the top level of its settings.json; Qwen nests it under "ui" in
// ~/.qwen/settings.json, so the container is addressed by a key path.
function removeStatuslineEntry(settingsPath, containerKeys) {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    const settings = JSON.parse(raw);
    const container = containerKeys.reduce((o, k) => (o == null ? o : o[k]), settings);
    if (container == null) return;
    const cmd = container.statusLine && container.statusLine.command;
    // Only remove the parts ponytail owns. If the user combined statuslines
    // (e.g. caveman && ponytail), keep the other plugin's command intact.
    // ponytail: splits on && / ; to detect other segments — good enough; a user
    // piping statuslines together is on their own.
    if (typeof cmd !== 'string' || !cmd.includes(STATUSLINE_SCRIPT)) return;
    const parts = cmd
      .split(/&&|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const others = parts.filter((s) => !s.includes(STATUSLINE_SCRIPT));
    if (others.length === 0) {
      delete container.statusLine;
    } else {
      container.statusLine.command = others.join(' && ');
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log(
      `Removed ponytail statusLine ${others.length === 0 ? 'entry' : 'segment'} from ${settingsPath}`,
    );
  } catch (e) {
    if (e.code === 'ENOENT') {
      // no settings.json — nothing to clean
    } else if (e instanceof SyntaxError) {
      // ponytail: malformed settings.json — can't safely edit it; leave intact, warn
      console.warn(`${path.basename(settingsPath)} is malformed — could not remove the ponytail statusLine entry. Remove it manually from: ${settingsPath} (${e.message})`);
    } else {
      throw e;
    }
  }
}

removeStatuslineEntry(path.join(getClaudeDir(), 'settings.json'), []);
removeStatuslineEntry(path.join(os.homedir(), '.qwen', 'settings.json'), ['ui']);
