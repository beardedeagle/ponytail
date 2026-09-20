#!/usr/bin/env node
// Smoke test for the Qwen Code adapter: the settings.json hook template, the
// ~/.qwen state dir, and the Qwen-shaped statusline nudge.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');

// This suite is normally launched from inside a Qwen session, and Qwen exports
// QWEN_CODE process-wide rather than only to hook processes. Clear it so the
// negative case below is real and the positive cases prove the marker instead
// of inheriting it.
delete process.env.QWEN_CODE;

function readJSON(relPath) {
  return JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf8'));
}

function run(script, env, input = '') {
  return spawnSync(process.execPath, [path.join(root, 'hooks', script)], {
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
  });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-qwen-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

const home = path.join(temp, 'home');
fs.mkdirSync(home, { recursive: true });
// USERPROFILE alongside HOME: os.homedir() reads USERPROFILE on Windows.
const qwenEnv = {
  HOME: home,
  USERPROFILE: home,
  QWEN_CODE: '1',
  PONYTAIL_DEFAULT_MODE: 'full',
};
const qwenState = path.join(home, '.qwen', '.ponytail-active');

test('qwen hook template registers the three lifecycle events', () => {
  const cfg = readJSON('hooks/qwen-hooks.json');
  assert.ok(cfg.hooks, 'template must have a hooks key');

  const expected = {
    SessionStart: 'ponytail-activate.js',
    UserPromptSubmit: 'ponytail-mode-tracker.js',
    SubagentStart: 'ponytail-subagent.js',
  };
  for (const [event, script] of Object.entries(expected)) {
    const groups = cfg.hooks[event];
    assert.ok(Array.isArray(groups) && groups.length === 1, `${event} must be a one-group array`);
    const hook = groups[0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.ok(hook.command.includes(script), `${event} must run ${script}`);
    // Qwen expands neither variable, so a Claude-style path would run nothing
    // and fail silently at every session start.
    assert.ok(
      !hook.command.includes('CLAUDE_PLUGIN_ROOT'),
      `${event} must not rely on CLAUDE_PLUGIN_ROOT`,
    );
    assert.ok(!hook.command.includes('PLUGIN_DATA'), `${event} must not rely on PLUGIN_DATA`);
    // Qwen reads timeout in seconds; 1000 or more is legacy milliseconds.
    assert.ok(hook.timeout > 0 && hook.timeout < 1000, `${event} timeout must be in seconds`);
  }
  assert.equal(cfg.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
});

test('qwen runtime does not claim Qwen without QWEN_CODE', () => {
  const { isQwen } = require('../hooks/ponytail-runtime');
  assert.equal(isQwen, false, 'isQwen must be false without QWEN_CODE');
});

test('qwen activation flags ~/.qwen and emits raw SessionStart context', () => {
  const result = run(
    'ponytail-activate.js',
    qwenEnv,
    JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(qwenState, 'utf8'), 'full');
  // The flag must not leak into the Claude dir, which is the whole point of a
  // per-host state dir.
  assert.equal(
    fs.existsSync(path.join(home, '.claude', '.ponytail-active')),
    false,
    'qwen must not write the flag to ~/.claude',
  );
  // Qwen adds a command hook's raw stdout to the model context on SessionStart,
  // so this must stay plain text rather than the JSON form.
  assert.ok(
    !result.stdout.trimStart().startsWith('{'),
    'SessionStart output must be raw text, not JSON',
  );
  assert.match(result.stdout, /PONYTAIL/);
});

test('qwen statusline nudge targets ui.statusLine in ~/.qwen/settings.json', () => {
  // The nudge is once-only, and the activation test above already spent it.
  fs.rmSync(path.join(home, '.qwen', '.ponytail-statusline-nudged'), { force: true });
  const result = run(
    'ponytail-activate.js',
    qwenEnv,
    JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
  );
  const settingsPath = path.join(home, '.qwen', 'settings.json');
  assert.ok(
    result.stdout.includes(settingsPath),
    'nudge must name the Qwen settings file, got: ' + result.stdout.slice(-400),
  );
  assert.match(result.stdout, /"ui": \{ "statusLine": \{ "type": "command"/);
  // The badge only works if the generated command tells the script where the
  // flag lives — the script cannot infer the host on its own.
  assert.ok(
    result.stdout.includes('ponytail-statusline'),
    'nudge must name the statusline script',
  );
  assert.ok(
    result.stdout.includes('\\"' + path.join(home, '.qwen') + '\\"'),
    'nudge must pass the Qwen state dir to the statusline script, got: ' + result.stdout.slice(-500),
  );
  assert.ok(
    !result.stdout.includes(path.join(home, '.claude')),
    'nudge must not point at ~/.claude',
  );

  // A configured ui.statusLine must silence the nudge, and the once-only flag
  // must live beside the Qwen settings rather than in ~/.claude.
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    ui: { statusLine: { type: 'command', command: 'echo hi' } },
  }));
  fs.rmSync(path.join(home, '.qwen', '.ponytail-statusline-nudged'), { force: true });
  const configured = run(
    'ponytail-activate.js',
    qwenEnv,
    JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
  );
  assert.ok(
    !configured.stdout.includes('STATUSLINE SETUP NEEDED'),
    'an existing ui.statusLine must suppress the nudge',
  );
});

test('qwen mode tracker switches level and stays silent on ordinary prompts', () => {
  const switched = run(
    'ponytail-mode-tracker.js',
    qwenEnv,
    JSON.stringify({ prompt: '/ponytail ultra' }),
  );
  assert.equal(switched.status, 0, switched.stderr);
  assert.equal(fs.readFileSync(qwenState, 'utf8'), 'ultra');
  assert.match(switched.stdout, /PONYTAIL MODE CHANGED/);
  assert.match(switched.stdout, /level: ultra/);

  // Qwen has a real SessionStart, so it follows the Claude/Codex path: no
  // Qoder-style per-turn ruleset re-injection on ordinary prompts.
  const ordinary = run(
    'ponytail-mode-tracker.js',
    qwenEnv,
    JSON.stringify({ prompt: 'write a function' }),
  );
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.equal(ordinary.stdout, '', 'ordinary prompts must stay silent outside Qoder');
  assert.equal(fs.readFileSync(qwenState, 'utf8'), 'ultra');
});

test('qwen subagent hook emits hookSpecificOutput JSON', () => {
  const result = run(
    'ponytail-subagent.js',
    qwenEnv,
    JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'general-purpose' }),
  );
  assert.equal(result.status, 0, result.stderr);
  // SubagentStart is the one Qwen event that drops raw stdout, so this must be
  // the JSON form carrying hookEventName.
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'SubagentStart');
  assert.match(output.hookSpecificOutput.additionalContext, /PONYTAIL/);
});

test('qwen deactivation clears the flag', () => {
  const result = run(
    'ponytail-mode-tracker.js',
    qwenEnv,
    JSON.stringify({ prompt: '/ponytail off' }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(qwenState), false, 'off must remove the flag');
  assert.match(result.stdout, /PONYTAIL MODE OFF/);
});

test('qwen statusline script renders the badge from the state dir it is passed', {
  skip: process.platform === 'win32' ? 'bash is not the Windows statusline path' : false,
}, () => {
  const script = path.join(root, 'hooks', 'ponytail-statusline.sh');
  fs.mkdirSync(path.dirname(qwenState), { recursive: true });
  fs.writeFileSync(qwenState, 'ultra');

  const withArg = spawnSync('bash', [script, path.dirname(qwenState)], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(withArg.status, 0, withArg.stderr);
  assert.match(withArg.stdout, /\[PONYTAIL:ULTRA\]/);

  // No argument keeps the pre-existing CLAUDE_CONFIG_DIR behaviour, so
  // already-configured Claude installs are unaffected by the change.
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.ponytail-active'), 'lite');
  const withConfigDir = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claudeDir },
  });
  assert.match(withConfigDir.stdout, /\[PONYTAIL:LITE\]/);

  // Without the argument the Qwen flag must not be found: the argument is what
  // makes the badge work under Qwen, not host sniffing inside the script.
  const emptyHome = path.join(temp, 'empty-home');
  fs.mkdirSync(emptyHome, { recursive: true });
  const noFlag = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { HOME: emptyHome, USERPROFILE: emptyHome, PATH: process.env.PATH },
  });
  assert.equal(noFlag.status, 0, noFlag.stderr);
  assert.equal(noFlag.stdout, '', 'no flag in the default dir means no badge');
});

// The .ps1 mirrors the .sh, and nothing else in the suite executes PowerShell,
// so a syntax error there would otherwise ship silently. Probe once and skip
// where no PowerShell exists.
const pwshShell = process.platform === 'win32' ? 'powershell' : 'pwsh';
const hasPwsh = spawnSync(pwshShell, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' }).status === 0;

test('qwen statusline ps1 renders the badge from the state dir it is passed', {
  skip: hasPwsh ? false : `${pwshShell} not available`,
}, () => {
  const script = path.join(root, 'hooks', 'ponytail-statusline.ps1');
  fs.mkdirSync(path.dirname(qwenState), { recursive: true });
  fs.writeFileSync(qwenState, 'ultra');

  const withArg = spawnSync(pwshShell, ['-NoProfile', '-File', script, path.dirname(qwenState)], {
    encoding: 'utf8',
  });
  assert.equal(withArg.status, 0, withArg.stderr);
  assert.match(withArg.stdout, /\[PONYTAIL:ULTRA\]/);

  // No argument keeps the pre-existing CLAUDE_CONFIG_DIR behaviour.
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.ponytail-active'), 'lite');
  const withConfigDir = spawnSync(pwshShell, ['-NoProfile', '-File', script], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
  });
  assert.equal(withConfigDir.status, 0, withConfigDir.stderr);
  assert.match(withConfigDir.stdout, /\[PONYTAIL:LITE\]/);
});
