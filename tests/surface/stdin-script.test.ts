// Card T0-SMALL-ISSUES-463-428-ZOD, issue 463: no interpreter reads its program from standard input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runHook, type HookEvent, type HookName } from '../../src/hooks/index.ts';
import { dispatchHook, hookNamesFor } from '../../src/hooks/entry.ts';
import { tmpDir } from '../infra/helpers.ts';

const RULE = 'Never feed a script to an interpreter on standard input (`python -`, a heredoc into `node`): write it to a file outside the worktree and run the file.';
const GUARD = 'stdin-script' as HookName;
const REFUSED = { exitCode: 2, stderr: RULE };
const PASSED = { exitCode: 0 };
const shell = (tool_name: string, command: unknown): HookEvent => ({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command } });
const body = (head: string, text = 'x', tail = ''): string => `${head}\n${text}\nEOF${tail}`;

const BASH_REFUSED = [
  // the program operand `-`
  'python -', 'python3 -', 'python3.12 -', 'py -', 'py -3 -', 'node -', 'PYTHON -', 'python.exe -', '/usr/bin/python3 -', '"C:/py/python.exe" -', "python '-'", 'python -u - a b',
  'python -X utf8 -', 'python -W ignore -', ...['-r', '--require', '--import', '--loader', '-C', '--conditions', '--input-type', '--env-file'].map((o) => `node ${o} x -`), 'node -i -', 'python - -c x', 'python -Xfoom -', 'python -Wc -', 'python --xc -',
  // a pipe, a redirection, a heredoc or a here-string with no program operand
  'echo x | node', 'echo x |node', 'echo x| node', 'cat s | python3', 'cat s |& python', 'cat s |\n node', 'cat s | (python)', 'cat s | { python; }', 'cat s | python -u', 'cat s | node --no-warnings', 'cat s | node 2>&1 | head', 'cat s | python > out.txt', 'cat s | python >> out.txt', 'cat s | python >| out.txt', 'cat s | python &> out.txt', 'cat s | node --evaluate', 'cat s | node --x-e', 'cat x > >(python -)', 'diff <(python -) b',
  'python < s.py', 'python <s.py', 'python < <(gen)', 'python <<< "print(1)"', body('python3 <<EOF'), body('node <<"EOF"'), body("node <<'EOF'"), body('node <<\\EOF'), body('node <<-EOF', '\tx'), body('node<<EOF'), body('python3.12<<EOF'), body('python 2>/dev/null <<EOF'), body('cat <<EOF | node'),
  body("python - <<'EOF'"), body('python -<<EOF'), body('X=$(python3 - <<EOF', 'x', '\n)'), 'cat <<<EOF\npython -\nEOF', 'cat <<EOF\nEOF\npython -\nEOF', 'cat <<EOF\nx\nEOF\npython -\ncat <<EOF\ny\nEOF',
  // where a command may stand
  'cd a && python -', 'cd a || python -', 'cd a; node -', 'cd a\nnode -', 'cd a\r\nnode -', 'cd a\rnode -', 'sleep 1 & python -', '(python -)', '{ python -; }', 'echo `python -`', 'echo $(python -)', 'echo "$(cat x | python3)"', `echo "$(echo 'a b' | python3)"`, 'node \\\n -', 'node \\\r\n -',
  'X=1 python -', 'A=1 B=2 python -', 'timeout 30 python -', 'timeout 1.5m python -', ...['sudo', 'time', 'env', 'exec', 'command', 'nohup', 'if', 'then', 'do', 'else', 'elif', 'while', 'until', '!'].map((w) => `${w} python -`), 'cat s | sudo python', 'sudo env X=1 python -',
  body("cat > a.sh <<'EOF'", 'x', '\npython -'), body('cat <<EOF', 'x', '\r\npython -'), "echo it\\'s | python; echo 'x'", 'echo \\\\ | python', "# it's\npython -; echo 'x'", 'echo a#b | python', 'cat s | node # x', "echo a # it's\npython - # it's", `echo "a \\" b" | python; echo "c"`,
  // quotes, comments, heredocs, redirections and compound commands where they stand
  'echo "<<EOF"\npython -\nEOF', '# <<EOF\npython -\nEOF', "echo '<<EOF'\npython -\nEOF", 'echo \\<<EOF\npython -\nEOF', 'cat <<A <<B\nx\nA\ny\nB\npython -', 'cat <<-EOF\n\tx\n\tEOF\npython -', 'cat <<EOF; python -\nx\nEOF', 'echo ok;# comment\npython -', '<s.py X=1 python', '<s.py env python', '>out.txt python -', '0< s.py python', 'python 0<s.py', 'echo "$([[ a < b ]])"; python -', 'echo "$(((1)); python -)"', 'echo $(((1)); python -)', '((true); python -)', 'echo $(( (1 + 2) | 3 )); python -', 'tee >(python -)', 'f() { python -; }', 'f () { python -; }', 'cat s | if python; then x; fi', 'case $x in a) python -;; esac', 'case $x in (a|b) python - ;; c) x;; esac', 'case $x in a|b) cat s | python;; esac; ls', 'case $x in a) x;; esac; cat s | python', '[[ -f x ]] && python -', '[[ a =~ ^(a|b)$ ]]; cat s | python', '((x = 1)); python -', 'echo $((1 + 2)) | python', 'echo \${x:-$(python -)}', 'echo \${x:-"}"}; python -', "echo $'it\\'s'; python -; echo 'x'", 'a=(x y); python -', 'ls !(a|b) | python', '! (python -)', 'time (cat s | python)', '(cat s) | python', '{ cat s; } | python', 'echo \`cat s | python\`', 'echo "a" | python "-"', "'python' -", 'cat s | # x\n python', 'A+=1; python -', 'cat <<EOF | python\n"\nEOF', body('echo "$(cat <<EOF', 'say "x"', '\n)"; python -'), 'python\\\n3 -',
  'AB=1 python -', '(true; (python -))', 'echo "$(echo "a")"; python -', 'for x in a; do cat s | python; done', 'case x in esac; python -', 'python\t-', 'echo \\x\npython -', 'python - $(x)', 'echo `echo \\`python -\\``', '[[ (a)]] && python -', 'cat x | python - >(cat)', 'cat s|& python', 'case $x in a) true; python -;; esac', 'a+b() { python -; }',
  // pwsh
  'pwsh -Command -', 'pwsh -command -', 'pwsh -NoProfile -c -', 'pwsh -File -', 'pwsh -f -', 'pwsh --command -', 'powershell.exe -Command -', 'cat x | pwsh -Command -',
];
const BASH_PASSED = [
  'python s.py', 'python s.py -', 'node s.js -', 'node s.js < in.txt', body('node s.js <<EOF'), 'cat x | node s.js', 'python -W ignore s.py', 'cat x | python "my script.py"', "cat x | python ''", 'python <(gen)', 'cat x | python <(gen)', 'python ${S}', 'python $(which s)',
  'python', 'node', 'node --version', 'cat a || python', 'cat a | tee b && node', 'cat a | tee b; node', 'cat a | tee b\nnode', 'python 2>&1', 'python > out.txt',
  'python3 -c "print(1)"', 'cat x | python -c "import sys"', 'cat x | python -uc "x"', 'cat x | python -m json.tool', 'cat x | python -mjson.tool', ...['-e', '--eval', '-p', '--print', '-pe'].map((o) => `cat x | node ${o} "x"`), 'cat x | node --eval="x y"', 'cat x | node --test', ...['-e', '--eval', '-p', '--print', '-pe'].map((o) => `cat x | node ${o} -1`), ...['-c', '-uc', '-m', '-um'].map((o) => `cat x | python ${o} -1`), 'node --test < /dev/null', 'node -e "x" -',
  'grep -E "npm|node|tsx" f', "rg 'a | node | b' f", `echo "$(rg 'a | node | b' f)"`, 'grep "python -" f', 'git commit -m "never python - again; python -"', 'echo \'python -\npython -\'', body('git commit -m "$(cat <<\'EOF\'', 'python -\nnode -', '\n)"'), body("cat > s.py <<'EOF'", 'python -', '\npython s.py'), body("cat > s.py <<'END'", 'python -').replace(/EOF$/, 'END'), body('cat <<-EOF', '\tpython -').replace(/EOF$/, '\tEOF'), body('cat <<EOF', 'python -\nEOFX\npython -'), 'cat <<EOF\nEOF\nls', body('cat << EOF', 'python -'), body('cat <<\\EOF', 'python -'), "cat <<'END X'\npython -\nEND X", 'cat <<END-1\npython -\nEND-1', 'cat <<EOF\r\npython -\r\nEOF\r\nls', "echo '$(x) ; python -'",
  'cat x | python 2>&1 s.py', 'cat x | python <&3 s.py', 'cat x | python &> out.txt s.py', 'cat x | python >| out.txt s.py',
  'cat <<A <<B\nx\nA\npython -\nB', 'cat <<EOF\n\tEOF\npython -\nEOF', 'cat <<E"OF"\npython -\nEOF', "cat <<E'OF'\npython -\nEOF", 'cat <<EOF\npython -', 'cat <<-EOF\n\tpython -\n\tEOF', 'echo ok;# comment; python -', '(# python -\nls)', 'cat x | python >(cat)', 'cat x | node >(cat)', 'cat x | node <(cat)', 'python <&3', 'python 3< f', 'python {fd}< f', 'python <> f', '< f\npython', 'cat s | (cat); python', 'cat s | { cat; }; python', 'case x in a | node) ls;; b | python) ls;; esac', 'case x in (a | node) ls;; (b | python) ls;; esac', '[[ a = b || x < node ]]', 'if [[ $x =~ ^(a | node)$ ]]; then ls; fi', '(( a | node ))', 'echo $((a | node))', 'echo "$((a | node))"', 'a=(x | node)', 'echo $(( (1) | node ))', 'a=(python -)', 'ls @(a | node)', 'for x in python -; do ls; done', "echo $'it\\'s | node; python -'", 'echo \${x/ | node }', '"/c/my py/python" -', 'echo "x; python -"', body('git commit -m "$(cat <<\'EOF\'', 'say "x"\npython -', '\n)"'), 'echo "$(echo "a b" | python3)"', 'echo "a $(ls) ; python - b"', 'f() { ls; }; python', 'echo "\\"; python - "', "echo 'a' # it's; python -",
  'foo 3 python -', 'timeout -k python -', 'timeout 5x python -', '"python$(x)" -', 'echo ${x:-$(a); python - }', 'echo ${x:-${y} ; python - }', 'echo ${x:-\\} ; python - }', 'echo ${x/ | node -u}', 'cat <<-EOF\nE\tOF\npython -\nEOF', 'cat s | python $((1))', 'echo $(x) python -', 'echo <(x) python -', 'cat x | python $(which s)', 'cat x | python ${S}', 'echo "$(echo "a" `python -`)"', 'cat x | python `ls`', 'cat s | python 2x>o', 'case x in a) x ;& b | node) y;; esac', 'case x in b | c) python;; esac', 'echo $(case x in a) y;; esac) python -', 'pwsh -c=1 -',
  'echo python -', '# python -', 'ls # x; python -', 'echo a \\| node', 'case $x in a|node) ls;; esac', '[[ $x =~ ^(a|node)$ ]]', 'echo x|node', 'which python | head', 'cat x | jq .', 'cat x | nodemon', 'cat x | python.exe3', 'cat x | pythonw', 'cat x | mypy', 'docker exec -i c python -', 'diff <(node a.js) b', 'cat x | bash',
  'pwsh -File s.ps1', 'pwsh -Command "x"', 'pwsh -File s.ps1 -Command -', 'cat f | pwsh -File s.ps1', 'pwsh - ', 'pwsh - -', 'pwsh f -', 'cat x | pwsh',
];
const PS_REFUSED = ["@'\nprint(1)\n'@ | python -", "@'\nprint(1)\n'@ | python", '@"\nx\n"@ | node', '@" \r\nx\r\n"@ | node', 'Get-Content s | python', '& python -', '& "C:\\py\\python.exe" -', '1..3 | % { node - }', '1..3 | % {node -}', "@'\na\n'@ | x\npython -\n@'\nb\n'@", 'cat x | & node', '$((cat s | python))', '((cat s | python))', 'python`\n-', '.venv\\Scripts\\python.exe -', '& "C:\\py\\python.exe" -u -', "'it''s' | python", '"a "" b" | python', "echo 'a '' b' | python; echo 'c'", 'cat s |\npython', 'cat s\n| python', 'if ($x) { python - }', '<# x #> python -', '"$(Get-Content s | python)"', 'cat s | & { python }', '$x = python -', 'python - 2>&1', 'cat s | python *> out.txt', '${a b}; python -', 'cat s | python # x', 'pwsh -Command -', 'node `\n -', 'node `\r\n -', 'python -; ls', 'echo a#b | python', 'echo "a `" b" | python; echo "c"'];
const PS_PASSED = ["@'\npython -\n'@ | Set-Content s.py", '@"\npython -\n"@ | Set-Content s.py', "@'\nit's\npython -\n'@ | Set-Content s.py", "@' \nit's\npython -\n'@ | Set-Content s.py", "@'\r\nit's\r\npython -\r\n'@ | Set-Content s.py", '@"\na " b\npython -\n"@ | Set-Content s.py', "Select-String 'a; python - x' f", "Select-String 'it''s; python - x' f", '"a "" ; python - x"', '<# python - #> ls', '"a `" ; python - x"', 'cat s | % { python }', 'if ($x) { ls }; python', '$x = "python -"', 'cat x | python (Get-Item s)', 'cat x | python { a }', 'python <s.py', 'foo = python -', "cat x | python @'\ns\n'@", 'cat x | % { $_ } ; python', '"$(echo "a b" | python)"', 'ls @{ a = 1 }; python', 'ls # x; python -', 'python s.py', 'cat x | python -m json.tool', 'Select-String "a|node|b" f', '"a" | Out-File x; node s.js', 'node -e "x`"| node"'];

test('acceptance 1: each listed Bash and PowerShell form is refused with exit 2 and the text of the rule [R1]', () => {
  for (const c of BASH_REFUSED) assert.deepEqual(runHook(GUARD, shell('Bash', c), { cwd: '.', env: {} }), REFUSED, c);
  for (const c of PS_REFUSED) assert.deepEqual(runHook(GUARD, shell('PowerShell', c), { cwd: '.', env: {} }), REFUSED, c);
});

test('acceptance 2: a script file, an inline program, a module, quoted text and a heredoc body pass [R2]', () => {
  for (const c of BASH_PASSED) assert.deepEqual(runHook(GUARD, shell('Bash', c), { cwd: '.', env: {} }), PASSED, c);
  for (const c of PS_PASSED) assert.deepEqual(runHook(GUARD, shell('PowerShell', c), { cwd: '.', env: {} }), PASSED, c);
  for (const c of [undefined, 7, ['python', '-']]) assert.deepEqual(runHook(GUARD, shell('Bash', c), { cwd: '.', env: {} }), PASSED);
  assert.deepEqual(runHook(GUARD, {}, { cwd: '.', env: {} }), PASSED);
  assert.deepEqual(runHook(GUARD, shell('Edit', 'python -'), { cwd: '.', env: {} }), PASSED);
});

test('acceptance 3: both shells run the guard after every other guard, an edit does not, and each entry answers the same [R3]', () => {
  const cwd = tmpDir('aidlc-stdin-script-');
  const env = { AIDLC_STATE_DIR: path.join(cwd, 'state') };
  const dispatch = (event: HookEvent) => dispatchHook(event, { cwd, env });
  for (const tool of ['Bash', 'PowerShell']) {
    assert.deepEqual(hookNamesFor(shell(tool, '')), ['production-gate', 'protect-paths', 'secrets-guard', 'stdin-script']);
    assert.deepEqual(dispatch(shell(tool, 'python -')), REFUSED);
    assert.deepEqual(dispatch(shell(tool, 'python s.py')), PASSED);
  }
  assert.deepEqual(dispatch(shell('Edit', 'python -')), PASSED);
  // A block of another guard keeps its own result, in the first pass and in the second (a line break starts the second).
  writeFileSync(path.join(cwd, 'aidlc.config.json'), JSON.stringify({ hooks: { frozenPaths: ['contracts/'] } }));
  const blocks: Array<[HookName, string]> = [
    ['production-gate', 'python - deploy production'],
    ['production-gate', 'cat x\n/bin/cat deploy production | python -'],
    ['protect-paths', 'python - > contracts/a'],
    ['protect-paths', 'python - ; git worktree add contracts/a'],
    ['secrets-guard', `python - AKIA${'A'.repeat(16)}`],
  ];
  for (const [name, command] of blocks) {
    const alone = runHook(name, shell('Bash', command), { cwd, env });
    assert.notDeepEqual(alone, PASSED, command);
    assert.deepEqual(dispatch(shell('Bash', command)), alone, command);
  }
  // The frozen-path note is advisory, so the refusal replaces it.
  assert.deepEqual(dispatch(shell('Bash', 'python - contracts/a')), REFUSED);
  // A config that cannot be used: the guard itself reads none and answers the same.
  writeFileSync(path.join(cwd, 'aidlc.config.json'), '{ not json');
  assert.deepEqual(runHook(GUARD, shell('Bash', 'python -'), { cwd, env }), REFUSED);
  const bin = path.join(import.meta.dirname, '..', '..', 'bin', 'aidlc.js');
  for (const name of ['stdin-script', 'auto']) {
    const r = spawnSync(process.execPath, [bin, 'hook', name], { cwd: tmpDir('aidlc-stdin-script-'), input: JSON.stringify(shell('Bash', 'node -')), encoding: 'utf8', env: { ...process.env, ...env } });
    assert.equal(r.status, 2, name);
    assert.equal(r.stderr.trim(), RULE);
  }
});
