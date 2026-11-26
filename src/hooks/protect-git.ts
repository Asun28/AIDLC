/**
 * Whether a shell command runs a git command that cannot be taken back (card T0-PROTECT-GIT, issue 498): the operations the
 * git deny rules of `.claude/settings.json` name (card T0-DENY-IRREVERSIBLE-GIT), read where a deny rule, which matches the
 * command text, cannot: after `git -C <dir>` or `git -c <key>=<value>`, with options in another order, after a path or a
 * wrapper word, inside `bash -c '...'`, `pwsh -Command "..."` or `cmd /c ...`, and as a `+<ref>` push. The forms read are the
 * closed list of `docs/OPERATIONS.md`, Hooks. The guard is a reminder of a written rule, not a security boundary, so a form it
 * does not read is let through. Quotes are read, so a commit message or a heredoc body that mentions a refused command is data.
 */
import type { HookEvent, HookResult } from './index.ts';

/** Words that may stand before the command name; no option of a wrapper is read. */
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time', '!', '{', 'if', 'then', 'do', 'else', 'elif', 'while', 'until']);
/** The git options before the subcommand that take the next word as their value when written without `=`. */
const GIT_VALUES = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path', '--attr-source']);
/** The `git commit` options that take the next word as their value when written without `=`, and the short ones. */
const COMMIT_VALUES = new Set(['--message', '--file', '--author', '--date', '--reuse-message', '--reedit-message', '--template', '--fixup', '--squash', '--trailer', '--cleanup']);
const COMMIT_SHORT_VALUES = 'mFCct';
const BASH_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
/** How deep `bash -c`, `pwsh -Command`, `cmd /c` and a Bash substitution are read again. */
const MAX_DEPTH = 4;

/** The words of each command of `text`, in order, with the commands of every Bash substitution after the command holding it. */
function scan(text: string, powershell: boolean): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word: string | undefined;
  const heredocs: Array<{ delimiter: string; tabs: boolean }> = [];
  let i = 0;
  const add = (s: string): void => {
    word = (word ?? '') + s;
  };
  const endWord = (): void => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  /** The index after the `)` that closes a `$(` whose text starts at `from`; quotes and escapes inside are skipped. */
  const closing = (from: number): number => {
    let depth = 1;
    let j = from;
    while (j < text.length) {
      const c = text[j]!;
      if (c === '\\') j += 2;
      else if (c === "'") j = skipPast(j + 1, "'");
      else if (c === '"') j = doubleEnd(j + 1);
      else {
        if (c === '(') depth += 1;
        else if (c === ')' && --depth === 0) return j + 1;
        j += 1;
      }
    }
    return text.length;
  };
  const skipPast = (from: number, end: string): number => {
    const at = text.indexOf(end, from);
    return at < 0 ? text.length : at + end.length;
  };
  /** The index after the closing double quote of a quote whose text starts at `from`. */
  const doubleEnd = (from: number): number => {
    const escape = powershell ? '`' : '\\';
    let j = from;
    while (j < text.length && text[j] !== '"') j += text[j] === escape ? 2 : 1;
    return j + 1;
  };
  const readHeredocs = (): void => {
    for (const { delimiter, tabs } of heredocs.splice(0)) {
      while (i < text.length) {
        const end = text.indexOf('\n', i);
        const stop = end < 0 ? text.length : end;
        let line = text.slice(i, stop).replace(/\r$/, '');
        if (tabs) line = line.replace(/^\t+/, '');
        i = end < 0 ? text.length : end + 1;
        if (line === delimiter) break;
      }
    }
  };

  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n' || c === '\r') {
      endCommand();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      if (!powershell) readHeredocs();
    } else if (c === ' ' || c === '\t') {
      endWord();
      i += 1;
    } else if (c === (powershell ? '`' : '\\')) {
      const next = text[i + 1];
      if (next === '\n' || next === '\r') i += text.startsWith('\r\n', i + 1) ? 3 : 2;
      else {
        add(next ?? '');
        i += 2;
      }
    } else if (powershell && word === undefined && text.startsWith('<#', i)) {
      i = skipPast(i + 2, '#>');
    } else if (c === '#' && word === undefined) {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
    } else if (powershell && word === undefined && /^@(['"])[ \t]*\r?\n/.test(text.slice(i, i + 64))) {
      const quote = text[i + 1]!;
      const start = text.indexOf('\n', i) + 1;
      const end = text.indexOf(`\n${quote}@`, start);
      add(text.slice(start, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end + 3;
    } else if (c === "'" && powershell) {
      let j = i + 1;
      let raw = '';
      for (; j < text.length; j += 1) {
        if (text[j] === "'" && text[j + 1] === "'") {
          raw += "'";
          j += 1;
        } else if (text[j] === "'") break;
        else raw += text[j];
      }
      add(raw);
      i = j + 1;
    } else if (c === "'") {
      const end = skipPast(i + 1, "'");
      add(text.slice(i + 1, end - 1));
      i = end;
    } else if (!powershell && text.startsWith("$'", i)) {
      let j = i + 2;
      let raw = '';
      while (j < text.length && text[j] !== "'") {
        raw += text[j] === '\\' ? (text[j + 1] ?? '') : text[j];
        j += text[j] === '\\' ? 2 : 1;
      }
      add(raw);
      i = j + 1;
    } else if (c === '"') {
      const end = doubleEnd(i + 1);
      const inner = text.slice(i + 1, end - 1);
      add(powershell ? inner.replace(/`(.)/gs, '$1').replace(/""/g, '"') : inner.replace(/\\([$`"\\\n])/g, '$1'));
      i = end;
    } else if (!powershell && text.startsWith('$(', i)) {
      const end = closing(i + 2);
      commands.push(...scan(text.slice(i + 2, end - 1), false));
      add('$()');
      i = end;
    } else if (!powershell && c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
      commands.push(...scan(text.slice(i + 1, j), false));
      add('``');
      i = j + 1;
    } else if (!powershell && (text.startsWith('<<-', i) || (text.startsWith('<<', i) && text[i + 2] !== '<'))) {
      endWord();
      const tabs = text[i + 2] === '-';
      i += tabs ? 3 : 2;
      while (text[i] === ' ' || text[i] === '\t') i += 1;
      let delimiter = '';
      while (i < text.length && !/[\s;&|<>()]/.test(text[i]!)) {
        if (text[i] === "'" || text[i] === '"') {
          const end = text.indexOf(text[i]!, i + 1);
          const stop = end < 0 ? text.length : end;
          delimiter += text.slice(i + 1, stop);
          i = stop + 1;
        } else if (text[i] === '\\') {
          delimiter += text[i + 1] ?? '';
          i += 2;
        } else delimiter += text[i++];
      }
      heredocs.push({ delimiter, tabs });
    } else if (c === '>' || c === '<' || (c === '&' && text[i + 1] === '>')) {
      endWord();
      i += 1;
      while (i < text.length && /[<>&|]/.test(text[i]!)) i += 1;
    } else if (c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || (powershell && (c === '{' || c === '}'))) {
      endCommand();
      i += 1;
    } else {
      add(c);
      i += 1;
    }
  }
  endCommand();
  return commands;
}

/** Whether a single-dash option cluster such as `-xdf` holds `letter`. */
function cluster(arg: string, letter: string): boolean {
  return /^-[A-Za-z]+$/.test(arg) && arg.includes(letter);
}

/** Whether the `git commit` arguments hold `-n` (`--no-verify`) in a cluster, before an option whose value follows it. */
function commitSkipsHooks(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (COMMIT_VALUES.has(arg)) i += 1;
    else if (/^-[A-Za-z]+$/.test(arg)) {
      for (const letter of arg.slice(1)) {
        if (letter === 'n') return true;
        if (COMMIT_SHORT_VALUES.includes(letter)) {
          if (arg.endsWith(letter)) i += 1;
          break;
        }
      }
    }
  }
  return false;
}

/** Whether the words of a git command (`words[0]` is its name) run an operation that cannot be taken back. */
function irreversible(words: string[]): boolean {
  let at = 1;
  while (at < words.length && words[at]!.startsWith('-')) at += GIT_VALUES.has(words[at]!) ? 2 : 1;
  const sub = words[at];
  const args = words.slice(at + 1);
  if (sub === undefined) return false;
  if (args.includes('--no-verify')) return true;
  switch (sub) {
    case 'reset':
      return args.includes('--hard');
    case 'push':
      return args.some((a) => a === '--force' || a.startsWith('--force-with-lease') || cluster(a, 'f') || /^\+./.test(a));
    case 'clean':
      return args.some((a) => a === '--force' || cluster(a, 'f'));
    case 'checkout':
      return (args[0] === '--' && args.length > 1) || (args.length === 1 && args[0] === '.');
    case 'commit':
      return commitSkipsHooks(args);
    default:
      return false;
  }
}

/** The first git command of `text` that cannot be taken back, as its words, read again inside a shell's own command. */
function refusedGit(text: string, powershell: boolean, depth = 0): string[] | undefined {
  for (const all of scan(text, powershell)) {
    let at = 0;
    while (at < all.length && (WRAPPERS.has(all[at]!) || /^[A-Za-z_]\w*=/.test(all[at]!))) at += 1;
    const words = all.slice(at);
    const name = (words[0] ?? '').toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
    if (name === 'git' && irreversible(words)) return words;
    if (depth >= MAX_DEPTH) continue;
    let inner: { text: string; powershell: boolean } | undefined;
    if (BASH_SHELLS.has(name)) {
      const option = words.findIndex((w, k) => k > 0 && /^-[A-Za-z]*c$/.test(w));
      if (option > 0 && words[option + 1] !== undefined) inner = { text: words[option + 1]!, powershell: false };
    } else if (name === 'pwsh' || name === 'powershell') {
      const option = words.findIndex((w, k) => k > 0 && /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(w));
      if (option > 0) inner = { text: words.slice(option + 1).join(' '), powershell: true };
    } else if (name === 'cmd') {
      const option = words.findIndex((w, k) => k > 0 && /^\/[ck]$/i.test(w));
      if (option > 0) inner = { text: words.slice(option + 1).join(' '), powershell: false };
    }
    const found = inner && refusedGit(inner.text, inner.powershell, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Decides on the `command` of a Bash or PowerShell event, from the dispatcher and from `aidlc hook protect-git`; reads no config. */
export function protectGit(event: HookEvent): HookResult {
  const command = event.tool_input?.['command'];
  if ((event.tool_name !== 'Bash' && event.tool_name !== 'PowerShell') || typeof command !== 'string') return { exitCode: 0 };
  const git = refusedGit(command, event.tool_name === 'PowerShell');
  if (!git) return { exitCode: 0 };
  return {
    exitCode: 2,
    stderr: `Blocked: the git command ${JSON.stringify(git.join(' '))} discards work or history that cannot be taken back (CLAUDE.md, Hard limits). The owner runs it by hand if it is needed.`,
  };
}
