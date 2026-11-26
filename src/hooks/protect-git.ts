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
/** The PowerShell host parameters (and their aliases) that take the next word as their value. */
const PWSH_VALUES = new Set(['-executionpolicy', '-ep', '-ex', '-workingdirectory', '-wd', '-windowstyle', '-w', '-configurationname', '-config', '-outputformat', '-o', '-of', '-inputformat', '-in', '-if', '-encodedcommand', '-e', '-ec', '-encodedarguments', '-encodeda', '-ea', '-version', '-v', '-custompipename', '-settingsfile', '-settings']);

interface Heredoc {
  delimiter: string;
  tabs: boolean;
}

const ANSI_C: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

/** PowerShell's backtick escapes; any other backtick keeps the character after it. */
const PS_ESCAPES: Record<string, string> = { '0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

/** The text of a Bash `$'...'` quote with its escapes decoded, cut at a decoded NUL as Bash cuts it; an incomplete escape stays. */
function ansiC(raw: string): string {
  const decoded = raw.replace(/\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|[0-7]{1,3}|c.|.)/gs, (_, e: string) => {
    if (/^[xuU]./.test(e)) {
      const code = parseInt(e.slice(1), 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : `\\${e}`;
    }
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8) & 0xff);
    if (/^c./s.test(e)) return String.fromCharCode(e.charCodeAt(1) & 0x1f);
    return ANSI_C[e] ?? `\\${e}`;
  });
  const nul = decoded.indexOf('\0');
  return nul < 0 ? decoded : decoded.slice(0, nul);
}

/**
 * The words of each command of `text`, in order: one reader from left to right that keeps quotes, comments, heredocs and
 * brackets in step, so a substitution ends at its own closing parenthesis. The commands of an unquoted Bash substitution or
 * backtick span, and of a bracketed group, are listed as commands of their own; a substitution inside double quotes is data.
 */
function scan(text: string, powershell: boolean): string[][] {
  const commands: string[][] = [];
  const escape = powershell ? '`' : '\\';
  let i = 0;
  /** Above zero inside double quotes: the commands read there are dropped. */
  let muted = 0;
  const at = (s: string): boolean => text.startsWith(s, i);

  /** Moves past the bodies of the heredocs a command list opened on the line that just ended. */
  const readHeredocs = (heredocs: Heredoc[]): void => {
    for (const { delimiter, tabs } of heredocs.splice(0)) {
      while (i < text.length) {
        const end = text.indexOf('\n', i);
        let line = text.slice(i, end < 0 ? text.length : end).replace(/\r$/, '');
        if (tabs) line = line.replace(/^\t+/, '');
        i = end < 0 ? text.length : end + 1;
        if (line === delimiter) break;
      }
    }
  };

  /** A double-quoted text from after its opening quote; its substitutions are passed over as data. */
  const doubleQuoted = (): string => {
    let raw = '';
    muted += 1;
    while (i < text.length) {
      if (powershell && at('""')) {
        raw += '"';
        i += 2;
      } else if (text[i] === '"') break;
      else if (text[i] === escape) {
        const next = text[i + 1] ?? '';
        raw += powershell ? (PS_ESCAPES[next] ?? next) : /[$`"\\\n]/.test(next) ? (next === '\n' ? '' : next) : `\\${next}`;
        i += 2;
      } else if (at('$(')) {
        i += 2;
        list(')');
        raw += '$()';
      } else if (!powershell && text[i] === '`') {
        i += 1;
        while (i < text.length && text[i] !== '`') i += text[i] === '\\' ? 2 : 1;
        i += 1;
        raw += '``';
      } else raw += text[i++];
    }
    i += 1;
    muted -= 1;
    return raw;
  };

  /** Reads commands up to an unquoted `close` (the end of the text when it is empty) and moves past it. */
  const list = (close: string): void => {
    // The heredocs of this list: a substitution reads its own at its own line ends, and the outer list reads its own after.
    const heredocs: Heredoc[] = [];
    let words: string[] = [];
    let word: string | undefined;
    const add = (s: string): void => {
      word = (word ?? '') + s;
    };
    const endWord = (): void => {
      if (word !== undefined) words.push(word);
      word = undefined;
    };
    const endCommand = (): void => {
      endWord();
      if (words.length && !muted) commands.push(words);
      words = [];
    };
    while (i < text.length) {
      const c = text[i]!;
      if (close && c === close) {
        i += 1;
        break;
      }
      if (c === '\n' || c === '\r') {
        endCommand();
        i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
        if (!powershell) readHeredocs(heredocs);
      } else if (c === ' ' || c === '\t') {
        endWord();
        i += 1;
      } else if (c === escape) {
        const next = text[i + 1];
        if (next === '\n' || next === '\r') i += text.startsWith('\r\n', i + 1) ? 3 : 2;
        else {
          add(powershell ? (PS_ESCAPES[next ?? ''] ?? next ?? '') : (next ?? ''));
          i += 2;
        }
      } else if (powershell && word === undefined && at('<#')) {
        const end = text.indexOf('#>', i + 2);
        i = end < 0 ? text.length : end + 2;
      } else if (c === '#' && word === undefined) {
        while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i += 1;
      } else if (powershell && word === undefined && /^@(['"])[ \t]*\r?\n/.test(text.slice(i, i + 64))) {
        // A here-string: its body runs from after the opening line to a line that starts with its quote and `@`.
        const quote = text[i + 1]!;
        const open = text.indexOf('\n', i);
        const end = text.indexOf(`\n${quote}@`, open);
        add(end > open ? text.slice(open + 1, end).replace(/\r$/, '') : text.slice(open + 1));
        i = end < 0 ? text.length : end + 3;
      } else if (c === "'" && powershell) {
        let raw = '';
        for (i += 1; i < text.length && !(text[i] === "'" && text[i + 1] !== "'"); i += 1) {
          raw += text[i];
          if (text[i] === "'") i += 1;
        }
        add(raw);
        i += 1;
      } else if (c === "'") {
        const end = text.indexOf("'", i + 1);
        add(text.slice(i + 1, end < 0 ? text.length : end));
        i = end < 0 ? text.length : end + 1;
      } else if (!powershell && at("$'")) {
        let j = i + 2;
        while (j < text.length && text[j] !== "'") j += text[j] === '\\' ? 2 : 1;
        add(ansiC(text.slice(i + 2, j)));
        i = j + 1;
      } else if (c === '"') {
        i += 1;
        add(doubleQuoted());
      } else if (!powershell && at('$(')) {
        i += 2;
        list(')');
        add('$()');
      } else if (!powershell && c === '`') {
        let j = i + 1;
        while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
        if (!muted) commands.push(...scan(text.slice(i + 1, j).replace(/\\([`\\$])/g, '$1'), false));
        add('``');
        i = j + 1;
      } else if (!powershell && (at('<<-') || (at('<<') && !at('<<<')))) {
        endWord();
        const tabs = at('<<-');
        i += tabs ? 3 : 2;
        while (text[i] === ' ' || text[i] === '\t') i += 1;
        let delimiter = '';
        while (i < text.length && !/[\s;&|<>()]/.test(text[i]!)) {
          if (at("$'")) {
            let j = i + 2;
            while (j < text.length && text[j] !== "'") j += text[j] === '\\' ? 2 : 1;
            delimiter += ansiC(text.slice(i + 2, j));
            i = j + 1;
          } else if (at('$"')) i += 1;
          else if (text[i] === "'" || text[i] === '"') {
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
      } else if (c === '(' || (powershell && c === '{')) {
        // A bracketed group: its commands are listed on their own, and the command around it goes on after it.
        const outer = words;
        const pending = word;
        words = [];
        word = undefined;
        i += 1;
        list(c === '(' ? ')' : '}');
        words = outer;
        word = pending === undefined ? undefined : `${pending}()`;
      } else if (c === ';' || c === '&' || c === '|' || c === ')' || (powershell && c === '}')) {
        endCommand();
        i += 1;
      } else {
        add(c);
        i += 1;
      }
    }
    endCommand();
  };

  while (i < text.length) list('');
  return commands;
}

/** Whether the `git commit` arguments hold `-n` (`--no-verify`) in a short option cluster, before an option whose value follows. */
function commitSkipsHooks(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (COMMIT_VALUES.has(arg)) i += 1;
    else if (/^-[^-]/.test(arg)) {
      for (let k = 1; k < arg.length; k += 1) {
        if (arg[k] === 'n') return true;
        if (COMMIT_SHORT_VALUES.includes(arg[k]!)) {
          // The value is the rest of the cluster, or the next word when the cluster ends here.
          if (k === arg.length - 1) i += 1;
          break;
        }
      }
    }
  }
  return false;
}

/** Whether a single-dash option cluster such as `-xdf` holds `letter`. */
function cluster(arg: string, letter: string): boolean {
  return /^-[A-Za-z]+$/.test(arg) && arg.includes(letter);
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

/** The command text a shell runs from its arguments (`bash -c`, `pwsh -Command`, `cmd /c`), or undefined when it runs a script. */
function innerCommand(name: string, words: string[]): { text: string; powershell: boolean } | undefined {
  if (BASH_SHELLS.has(name)) {
    // The command string is the first operand when an option cluster before it holds `c`; a script operand ends the options.
    let command = false;
    for (let k = 1; k < words.length; k += 1) {
      const w = words[k]!;
      if (w === '--' || w === '-') return command ? (words[k + 1] === undefined ? undefined : { text: words[k + 1]!, powershell: false }) : undefined;
      if (/^[-+][oO]$/.test(w) || w === '--rcfile' || w === '--init-file') k += 1;
      else if (/^-[A-Za-z]+$/.test(w)) command ||= w.includes('c');
      else if (!/^(?:--|\+)/.test(w)) return command ? { text: w, powershell: false } : undefined;
    }
    return undefined;
  }
  if (name === 'pwsh' || name === 'powershell') {
    for (let k = 1; k < words.length; k += 1) {
      const w = words[k]!.toLowerCase();
      if (!w.startsWith('-')) return undefined; // a positional word is the script file
      const key = w.replace(/^--?/, '').replace(/:.*$/, '');
      if (key && 'command'.startsWith(key)) return { text: words.slice(k + 1).join(' '), powershell: true };
      if (key && 'file'.startsWith(key)) return undefined;
      if (PWSH_VALUES.has(`-${key}`)) k += 1;
    }
    return undefined;
  }
  if (name === 'cmd') {
    for (let k = 1; k < words.length; k += 1) {
      const w = words[k]!;
      if (/^\/[ck]$/i.test(w)) return { text: words.slice(k + 1).join(' '), powershell: false };
      if (!w.startsWith('/')) return undefined;
    }
  }
  return undefined;
}

/** The first git command of `text` that cannot be taken back, as its words; a shell's own command is read again, at any depth. */
function refusedGit(text: string, powershell: boolean): string[] | undefined {
  const work = [{ text, powershell }];
  for (let item = work.shift(); item; item = work.shift()) {
    for (const all of scan(item.text, item.powershell)) {
      let at = 0;
      while (at < all.length && (WRAPPERS.has(all[at]!) || /^[A-Za-z_]\w*=/.test(all[at]!))) at += 1;
      const words = all.slice(at);
      const name = (words[0] ?? '').toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
      if (name === 'git' && irreversible(words)) return words;
      const inner = innerCommand(name, words);
      // Each inner text is shorter than the text it came from, so the work list ends.
      if (inner && inner.text.length < item.text.length) work.push(inner);
    }
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
