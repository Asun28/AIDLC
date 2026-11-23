import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worktreeStartCommands } from '../../src/delivery/worktree.ts';

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
