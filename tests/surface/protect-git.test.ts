// Card T0-PROTECT-GIT, issue 498: the git commands that cannot be taken back are refused in every spelling the rows list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runHook, type HookEvent, type HookName } from '../../src/hooks/index.ts';
import { dispatchHook, hookNamesFor } from '../../src/hooks/entry.ts';
import { tmpDir } from '../infra/helpers.ts';

const GUARD = 'protect-git' as HookName;
const PASSED = { exitCode: 0 };
const shell = (tool_name: string, command: unknown): HookEvent => ({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command } });
const refused = (git: string) => ({
  exitCode: 2,
  stderr: `Blocked: the git command ${JSON.stringify(git)} discards work or history that cannot be taken back (CLAUDE.md, Hard limits). The owner runs it by hand if it is needed.`,
});

/** [command, the git command the refusal names]. */
const BASH_REFUSED: Array<[string, string]> = [
  ['git -C ../other push --force', 'git -C ../other push --force'],
  ['git -c user.name=x push origin main --force', 'git -c user.name=x push origin main --force'],
  ['git --git-dir .git --work-tree . reset --hard HEAD~1', 'git --git-dir .git --work-tree . reset --hard HEAD~1'],
  ['git push origin main -f', 'git push origin main -f'],
  ['git push -uf origin main', 'git push -uf origin main'],
  ['git push origin +main', 'git push origin +main'],
  ['git push --force-with-lease', 'git push --force-with-lease'],
  ['git reset HEAD~1 --hard', 'git reset HEAD~1 --hard'],
  ['git clean -xdf', 'git clean -xdf'],
  ['git clean --force', 'git clean --force'],
  ['git checkout -- src/a.ts', 'git checkout -- src/a.ts'],
  ['git checkout .', 'git checkout .'],
  ['git commit -nm wip', 'git commit -nm wip'],
  ['git commit -m wip -n', 'git commit -m wip -n'],
  ['git merge --no-verify topic', 'git merge --no-verify topic'],
  ['/usr/bin/git push --force', '/usr/bin/git push --force'],
  ['sudo env GIT_DIR=.git git push --force', 'git push --force'],
  ['npm test && git push --force', 'git push --force'],
  ['echo ok; git reset --hard', 'git reset --hard'],
  ["bash -c 'git push --force'", 'git push --force'],
  ['sh -lc "git -C x reset --hard"', 'git -C x reset --hard'],
  ['echo $(git reset --hard)', 'git reset --hard'],
  ['git push "--force"', 'git push --force'],
  // R3 decision 1: an attached commit message, a parenthesis in a comment or heredoc, an ANSI-C escape, five nested shells.
  ['git commit -mteam -n', 'git commit -mteam -n'],
  ['git commit -nmfix-123', 'git commit -nmfix-123'],
  ['echo $(echo x # (\n); git push --force', 'git push --force'],
  ["cat <<'EOF'\n)\nEOF\ngit push --force", 'git push --force'],
  ["echo $(cat <<'EOF'\n(\nEOF\n); git reset --hard", 'git reset --hard'],
  ["git push $'--for\\x63e'", 'git push --force'],
  ['cmd /c cmd /c cmd /c cmd /c cmd /c git push --force', 'git push --force'],
  // R3 decision 2: a NUL in an ANSI-C quote, an ANSI-C heredoc delimiter, a heredoc inside a substitution, `bash -O <value>`.
  ["git push $'--force\\0ignored'", 'git push --force'],
  ["cat <<$'EOF'\ntext\nEOF\ngit push --force", 'git push --force'],
  ['cat <<OUT $(cat <<IN\n\nIN\n)\ny\nOUT\ngit push --force', 'git push --force'],
  ["bash -O extglob -c 'git push --force'", 'git push --force'],
];

const PS_REFUSED: Array<[string, string]> = [
  ['git.exe -C ..\\other push --force', 'git.exe -C ..\\other push --force'],
  ['& git push --force', 'git push --force'],
  ['if ($true) { git reset --hard }', 'git reset --hard'],
  ['pwsh -Command "git push --force"', 'git push --force'],
  ['cmd /c git push --force', 'git push --force'],
  ['GIT push --force', 'GIT push --force'],
  ["Write-Output @'\n'@\ngit reset --hard", 'git reset --hard'],
  ['Write-Output @"\n"@\ngit reset --hard', 'git reset --hard'],
];

const BASH_PASSED = [
  'git status',
  'git push origin main',
  'git push origin feature-f',
  'git push --follow-tags origin main',
  'git reset --soft HEAD~1',
  'git reset HEAD file',
  'git clean -n',
  'git checkout main',
  'git checkout --conflict=diff3 -- CHANGELOG.md',
  'git checkout -b topic',
  'git commit -m "say -n and --no-verify and git push --force"',
  'git commit -am wip',
  'git commit -mn',
  'git log --grep=--force',
  'grep -rn "git push --force" docs',
  "echo 'git reset --hard'",
  "cat > notes.md <<'EOF'\ngit push --force\nEOF",
  "git commit -m \"$(cat <<'EOF'\nfix: git reset --hard and --no-verify\nEOF\n)\"",
  'git PUSH --force',
  'gitk --all',
  '# git push --force',
  // R3 decision 1: a quote inside a quoted substitution's heredoc, a parenthesis in a heredoc body, a script's own arguments.
  "git commit -m \"$(cat <<'EOF'\n\"\ngit push --force\n\"\nEOF\n)\"",
  "echo $(cat <<'EOF'\n)\ngit push --force\nEOF\n)",
  "bash script.sh -c 'git push --force'",
  'git commit -m "fix" -m "-n is a flag"',
  // R3 decision 2: an incomplete ANSI-C escape stays literal.
  "echo $'\\x'",
];

const PS_PASSED = ["Write-Output @'\ngit push --force\n'@", 'git status', "git commit -m 'say git push --force'", "pwsh -File script.ps1 -Command 'git push --force'", "pwsh script.ps1 -Command 'git push --force'", 'git commit -m "--no-""verify"', 'git commit -m "--no-ve`rify"', 'git commit -m --no-ve`rify'];

test('T0-PROTECT-GIT acceptance 1: each listed spelling of an irreversible git command is refused and named [R1] [R2] [R3]', () => {
  for (const [c, git] of BASH_REFUSED) assert.deepEqual(runHook(GUARD, shell('Bash', c), { cwd: '.', env: {} }), refused(git), c);
  for (const [c, git] of PS_REFUSED) assert.deepEqual(runHook(GUARD, shell('PowerShell', c), { cwd: '.', env: {} }), refused(git), c);
});

test('T0-PROTECT-GIT acceptance 2: the listed safe commands, quoted text, heredoc bodies and other events pass [R1] [R2] [R3]', () => {
  for (const c of BASH_PASSED) assert.deepEqual(runHook(GUARD, shell('Bash', c), { cwd: '.', env: {} }), PASSED, c);
  for (const c of PS_PASSED) assert.deepEqual(runHook(GUARD, shell('PowerShell', c), { cwd: '.', env: {} }), PASSED, c);
  assert.deepEqual(runHook(GUARD, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.ts', new_string: 'git push --force' } }, { cwd: '.', env: {} }), PASSED);
  assert.deepEqual(runHook(GUARD, { hook_event_name: 'Stop' }, { cwd: '.', env: {} }), PASSED);
});

test('T0-PROTECT-GIT acceptance 3: the dispatcher runs protect-git last, in the second pass, and keeps another guard\'s block [R4]', () => {
  const cwd = tmpDir('aidlc-protect-git-');
  const env = { AIDLC_STATE_DIR: path.join(cwd, 'state') };
  for (const tool of ['Bash', 'PowerShell']) assert.deepEqual(hookNamesFor(shell(tool, '')), ['production-gate', 'protect-paths', 'secrets-guard', 'stdin-script', 'protect-git']);
  assert.deepEqual(dispatchHook(shell('Bash', 'git -C x push --force'), { cwd, env }), refused('git -C x push --force'));
  const both = 'npm run deploy production && git push --force';
  const gate = runHook('production-gate', shell('Bash', both), { cwd, env });
  assert.equal(gate.exitCode, 2);
  assert.deepEqual(dispatchHook(shell('Bash', both), { cwd, env }), gate);
});
