import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { codeSpan, shellArg, worktreeStartCommands } from '../../src/delivery/worktree.ts';

const WIN = { cardId: 'T1-HELLO', path: 'D:\\wt\\repo\\T1-HELLO', mainRoot: 'D:\\Projects\\repo', ref: 'origin/main' };
const LINUX = { cardId: 'T1-HELLO', path: '/home/u/wt/repo/T1-HELLO', mainRoot: '/home/u/repo', ref: 'main' };

test('T0-PREPARE-START-CMD acceptance 1: on win32 the text names git worktree add -b, the form for an existing branch and a PowerShell junction for node_modules [R1]', () => {
  const text = worktreeStartCommands({ ...WIN, linkModules: true, platform: 'win32' });
  assert.ok(text.startsWith('From the main checkout'), text);
  assert.ok(text.includes('`git worktree add -b T1-HELLO "D:\\wt\\repo\\T1-HELLO" origin/main`'), text);
  assert.ok(text.includes('`git worktree add "D:\\wt\\repo\\T1-HELLO" T1-HELLO`'), text);
  assert.ok(text.includes('`New-Item -ItemType Junction -Path "D:\\wt\\repo\\T1-HELLO\\node_modules" -Target "D:\\Projects\\repo\\node_modules"`'), text);
  assert.ok(!text.includes('ln -s'), text);
  assert.ok(text.indexOf('git worktree add -b') < text.indexOf('New-Item'), `the link comes after the worktree: ${text}`);
});

test('T0-PREPARE-START-CMD acceptance 1: on linux the text names git worktree add -b, the form for an existing branch and ln -s for node_modules [R1]', () => {
  const text = worktreeStartCommands({ ...LINUX, linkModules: true, platform: 'linux' });
  assert.ok(text.startsWith('From the main checkout'), text);
  assert.ok(text.includes('`git worktree add -b T1-HELLO "/home/u/wt/repo/T1-HELLO" main`'), text);
  assert.ok(text.includes('`git worktree add "/home/u/wt/repo/T1-HELLO" T1-HELLO`'), text);
  assert.ok(text.includes('`ln -s "/home/u/repo/node_modules" "/home/u/wt/repo/T1-HELLO/node_modules"`'), text);
  assert.ok(!text.includes('New-Item'), text);
});

test('T0-PREPARE-START-CMD acceptance 1: without the link the text names the two worktree commands and no link, on either platform [R1]', () => {
  for (const [input, platform] of [[WIN, 'win32'], [LINUX, 'linux']] as const) {
    const text = worktreeStartCommands({ ...input, linkModules: false, platform });
    assert.ok(text.startsWith('From the main checkout'), text);
    assert.ok(text.includes(`\`git worktree add -b T1-HELLO "${input.path}" ${input.ref}\``), text);
    assert.ok(text.includes(`\`git worktree add "${input.path}" T1-HELLO\``), text);
    assert.ok(!text.includes('node_modules'), `${platform}: ${text}`);
    assert.ok(!text.includes('New-Item') && !text.includes('ln -s'), `${platform}: ${text}`);
  }
});

test('T0-PREPARE-START-CMD acceptance 1: a path with a space stays inside the double quotes of every command [R1]', () => {
  const win = worktreeStartCommands({ cardId: 'T1-HELLO', path: 'D:\\my wt\\T1-HELLO', mainRoot: 'D:\\my repo', ref: 'origin/main', linkModules: true, platform: 'win32' });
  assert.ok(win.includes('`git worktree add -b T1-HELLO "D:\\my wt\\T1-HELLO" origin/main`'), win);
  assert.ok(win.includes('`git worktree add "D:\\my wt\\T1-HELLO" T1-HELLO`'), win);
  assert.ok(win.includes('-Path "D:\\my wt\\T1-HELLO\\node_modules" -Target "D:\\my repo\\node_modules"`'), win);
  const linux = worktreeStartCommands({ cardId: 'T1-HELLO', path: '/my wt/T1-HELLO', mainRoot: '/my repo', ref: 'main', linkModules: true, platform: 'linux' });
  assert.ok(linux.includes('`ln -s "/my repo/node_modules" "/my wt/T1-HELLO/node_modules"`'), linux);
});

// Repair after R3 decision 1 (F1, F2, class shell-interpolation): every value in the printed commands is literal for the shell.
const HOSTILE = [
  '/tmp/a $(echo injected) b',
  'D:\\wt\\$(Write-Output injected)',
  'x`whoami`y',
  'a"b',
  "it's",
  'p!q',
  'back\\slash $HOME',
  '$env:PATH',
  '\u201csmart\u201d \u201eopen',
  '\u2018s\u2019 \u201alow\u201b',
  'a;b && c|d > e',
];

test('T0-PREPARE-START-CMD R3 decision 1: shellArg keeps an ordinary path in double quotes and writes a value with a shell metacharacter in single quotes [R1]', () => {
  assert.equal(shellArg('D:\\wt\\repo\\T1-HELLO', 'win32'), '"D:\\wt\\repo\\T1-HELLO"');
  assert.equal(shellArg('/home/u/my wt/T1-HELLO', 'linux'), '"/home/u/my wt/T1-HELLO"');
  assert.equal(shellArg('D:\\wt\\$(Write-Output injected)', 'win32'), "'D:\\wt\\$(Write-Output injected)'");
  assert.equal(shellArg("it's $x", 'win32'), "'it''s $x'");
  assert.equal(shellArg('\u2018s\u2019 $x', 'win32'), "'\u2018\u2018s\u2019\u2019 $x'");
  assert.equal(shellArg('\u201cq\u201d', 'win32'), "'\u201cq\u201d'");
  assert.equal(shellArg('/tmp/$(echo injected)', 'linux'), "'/tmp/$(echo injected)'");
  assert.equal(shellArg("it's $x", 'linux'), "'it'\\''s $x'");
  assert.equal(shellArg('a\\b', 'linux'), "'a\\b'");
  assert.equal(shellArg('a\\b', 'win32'), '"a\\b"', 'a backslash is literal in a PowerShell double-quoted string');
  assert.equal(shellArg('p!q', 'linux'), "'p!q'");
  for (const value of HOSTILE) {
    for (const platform of ['win32', 'linux'] as const) {
      const q = shellArg(value, platform);
      const unsafe = platform === 'win32' ? /[$`"\u201c\u201d\u201e]/ : /[$`"\\!]/;
      if (q.startsWith('"')) assert.ok(!unsafe.test(q.slice(1, -1)), `${platform} ${value}: ${q}`);
      else assert.ok(q.startsWith("'") && q.endsWith("'"), `${platform} ${value}: ${q}`);
    }
  }
});

/** The text the shell prints for `quoted`, or undefined when that shell is not installed. */
function echoed(shell: 'pwsh' | 'sh', quoted: string): string | undefined {
  const r = shell === 'pwsh'
    ? spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Console]::Out.Write(${quoted})`], { encoding: 'utf8', windowsHide: true })
    : spawnSync('sh', ['-c', `printf '%s' ${quoted}`], { encoding: 'utf8', windowsHide: true });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
  assert.equal(r.status, 0, `${shell} ${quoted}: ${r.stderr}`);
  return r.stdout;
}

test('T0-PREPARE-START-CMD R3 decision 1: PowerShell and sh read each quoted value back unchanged, with nothing expanded or run [R1]', (t) => {
  for (const [shell, platform] of [['pwsh', 'win32'], ['sh', 'linux']] as const) {
    if (echoed(shell, "'probe'") === undefined) {
      t.diagnostic(`${shell} not installed: skipped`);
      continue;
    }
    for (const value of [...HOSTILE, 'D:\\wt\\repo\\T1-HELLO', '/home/u/my wt/T1-HELLO']) {
      assert.equal(echoed(shell, shellArg(value, platform)), value, `${shell}: ${shellArg(value, platform)}`);
    }
  }
});

test('T0-PREPARE-START-CMD R3 decision 1: a worktree path, main checkout or ref with metacharacters is quoted literally in every command [R1]', () => {
  const win = worktreeStartCommands({ cardId: 'T1-HELLO', path: 'D:\\$(Write-Output a)\\T1-HELLO', mainRoot: 'D:\\`b`', ref: 'origin/main;calc', linkModules: true, platform: 'win32' });
  assert.ok(win.includes("`git worktree add -b T1-HELLO 'D:\\$(Write-Output a)\\T1-HELLO' \"origin/main;calc\"`"), win);
  assert.ok(win.includes("`git worktree add 'D:\\$(Write-Output a)\\T1-HELLO' T1-HELLO`"), win);
  assert.ok(win.includes("-Path 'D:\\$(Write-Output a)\\T1-HELLO\\node_modules' -Target 'D:\\`b`\\node_modules'`"), win);
  const linux = worktreeStartCommands({ cardId: 'T1-HELLO', path: '/w/$(id)/T1-HELLO', mainRoot: "/it's $HOME", ref: 'main && id', linkModules: true, platform: 'linux' });
  assert.ok(linux.includes("`git worktree add -b T1-HELLO '/w/$(id)/T1-HELLO' \"main && id\"`"), linux);
  assert.ok(linux.includes("`ln -s '/it'\\''s $HOME/node_modules' '/w/$(id)/T1-HELLO/node_modules'`"), linux);
  const dollarRef = worktreeStartCommands({ cardId: 'T1-HELLO', path: '/w/T1-HELLO', mainRoot: '/m', ref: 'origin/$(id)', linkModules: false, platform: 'linux' });
  assert.ok(dollarRef.includes(`"/w/T1-HELLO" 'origin/$(id)'\``), dollarRef);
});

// Repair after R3 decision 2 (F3, class markdown-code-delimiter): a backtick in a quoted value does not end the code span.

/**
 * The contents of the code spans of `text`, read as CommonMark reads them: a backtick run opens a span that the next run
 * of the same length closes (a run with no closing match is literal text); the content loses one leading and one trailing
 * space when it has both and is not all spaces.
 */
function spans(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === '`') n++;
    const open = i + n;
    let j = open;
    let close = -1;
    while (j < text.length) {
      if (text[j] !== '`') {
        j++;
        continue;
      }
      let m = 0;
      while (text[j + m] === '`') m++;
      if (m === n) {
        close = j;
        break;
      }
      j += m;
    }
    if (close < 0) {
      i = open;
      continue;
    }
    let content = text.slice(open, close);
    if (content.length >= 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim() !== '') content = content.slice(1, -1);
    out.push(content);
    i = close + n;
  }
  return out;
}

test('T0-PREPARE-START-CMD R3 decision 2: codeSpan uses a delimiter longer than any backtick run inside and pads a text that begins or ends with a backtick [R1]', () => {
  assert.equal(codeSpan('git status'), '`git status`');
  assert.equal(codeSpan("ln -s 'a`b' c"), "``ln -s 'a`b' c``");
  assert.equal(codeSpan('x ``y`` z'), '```x ``y`` z```');
  assert.equal(codeSpan('`a'), '`` `a ``');
  assert.equal(codeSpan('a`'), '`` a` ``');
  for (const text of ['git status', "ln -s 'a`b' c", 'x ``y`` z', '`a', 'a`', '```', "'/tmp/a`b`'", ' padded ']) {
    assert.deepEqual(spans(`before ${codeSpan(text)} after`), [text], `one span that reads back ${JSON.stringify(text)}`);
  }
});

test('T0-PREPARE-START-CMD R3 decision 2: with backticks in the worktree path, main checkout and ref, every command reads back as one whole code span [R1]', () => {
  for (const platform of ['win32', 'linux'] as const) {
    const input = platform === 'win32'
      ? { cardId: 'T1-HELLO', path: 'D:\\a`b``\\T1-HELLO', mainRoot: 'D:\\m```', ref: 'origin/`x`', linkModules: true, platform }
      : { cardId: 'T1-HELLO', path: '/tmp/a`b`/T1-HELLO', mainRoot: '/m``', ref: '`x', linkModules: true, platform };
    const text = worktreeStartCommands(input);
    const dir = shellArg(input.path, platform);
    const ref = shellArg(input.ref, platform);
    const link = shellArg(`${input.path}${platform === 'win32' ? '\\' : '/'}node_modules`, platform);
    const target = shellArg(`${input.mainRoot}${platform === 'win32' ? '\\' : '/'}node_modules`, platform);
    const linkCommand = platform === 'win32' ? `New-Item -ItemType Junction -Path ${link} -Target ${target}` : `ln -s ${target} ${link}`;
    assert.deepEqual(spans(text), [`git worktree add -b T1-HELLO ${dir} ${ref}`, `git worktree add ${dir} T1-HELLO`, linkCommand], `${platform}: ${text}`);
  }
  const plain = worktreeStartCommands({ cardId: 'T1-HELLO', path: '/w/T1-HELLO', mainRoot: '/m', ref: 'main', linkModules: false, platform: 'linux' });
  assert.deepEqual(spans(plain), ['git worktree add -b T1-HELLO "/w/T1-HELLO" main', 'git worktree add "/w/T1-HELLO" T1-HELLO']);
});
