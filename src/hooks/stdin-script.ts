/**
 * Whether a shell command starts python, node or pwsh on a program read from standard input (card
 * T0-SMALL-ISSUES-463-428-ZOD, issue 463). The forms read are the closed list of `docs/OPERATIONS.md`, Hooks; any other
 * spelling passes. The guard is a reminder of a written rule, not a security boundary, so an unread form is let through.
 * One scan from left to right finds the commands, so a quote, a comment and a heredoc are each read where they stand.
 */
import type { HookEvent, HookResult } from './index.ts';

const RULE = 'Never feed a script to an interpreter on standard input (`python -`, a heredoc into `node`): write it to a file outside the worktree and run the file.';

const KEYWORDS = new Set(['if', 'then', 'do', 'else', 'elif', 'while', 'until', '!', '{', 'time']);
/** Wrapper words that may stand before the interpreter; no option of a wrapper is read. */
const WRAPPERS = new Set(['sudo', 'env', 'exec', 'command', 'nohup']);

/** The options that take the next word as their value, and the options after which the program is not standard input. */
const PYTHON = { values: new Set(['-X', '-W']), program: /^-(?![XW])[A-Za-z]*[cm]/ };
const NODE = {
  values: new Set(['-r', '--require', '--import', '--loader', '-C', '--conditions', '--input-type', '--env-file']),
  program: /^(?:-e|-p|-pe|--eval|--print|--test)(?:=|$)/,
};

function interpreterReadsStdin(words: string[], fed: boolean): boolean {
  let at = 0;
  for (; at < words.length; at += 1) {
    const word = words[at]!;
    if (word === 'timeout' && /^[\d.]+[smhd]?$/.test(words[at + 1] ?? '')) at += 1;
    else if (!KEYWORDS.has(word) && !WRAPPERS.has(word) && !/^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/.test(word)) break;
  }
  const [first = '', ...args] = words.slice(at);
  const name = first.toLowerCase().replace(/.*[\\/]/, '').replace(/\.exe$/, '');
  if (name === 'pwsh' || name === 'powershell') {
    const option = args.findIndex((a) => {
      const key = /^--?([a-z]+)$/i.exec(a)?.[1]?.toLowerCase();
      return key !== undefined && ('command'.startsWith(key) || 'file'.startsWith(key));
    });
    return option >= 0 && args[option + 1] === '-';
  }
  const options = name === 'node' ? NODE : /^(?:python[\d.]*|py)$/.test(name) ? PYTHON : undefined;
  if (!options) return false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '-') return true;
    if (!arg.startsWith('-') || options.program.test(arg)) return false;
    if (options.values.has(arg)) i += 1;
  }
  return fed;
}

/** A quoted text as a word: itself when it is one plain word, else `Q`, which names no interpreter and no option. */
function plain(text: string): string {
  return /^[\w.:\\/-]+$/.test(text) ? text : 'Q';
}

/** A heredoc whose body follows the next line break; a `quoted` delimiter keeps each backslash of the body. */
interface Heredoc {
  delimiter: string;
  tabs: boolean;
  quoted: boolean;
}

function readsScriptFromStdin(text: string, powershell: boolean): boolean {
  const escape = powershell ? '`' : '\\';
  let i = 0;
  let found = false;
  /** Inside a double-quoted `$(`: after its next double quote nothing is read. */
  let quotes = 0;
  let muted = false;
  const at = (s: string): boolean => text.startsWith(s, i);
  const skipTo = (end: string): void => {
    const start = text.indexOf(end, i);
    i = start < 0 ? text.length : start + end.length;
  };

  /** A backtick span, whose command is read when `read` is true. */
  const backticks = (read: boolean): void => {
    const span = /`((?:\\[\s\S]|[^`\\])*)`?/.exec(text.slice(i))!;
    if (read && readsScriptFromStdin(span[1]!.replace(/\\([`\\$])/g, '$1'), false)) found = true;
    i += span[0].length;
  };

  /** Moves past a substitution, whose heredocs are its own. */
  const substitution = (): void => {
    i += 2;
    list(')');
  };

  /**
   * Moves past Bash arithmetic that opens with `open` (`((` or `$((`) and reads the substitutions in it; a text that does
   * not close with `))` is a subshell or a substitution.
   */
  const arithmetic = (open: string): boolean => {
    if (powershell || !at(open)) return false;
    let depth = 0;
    for (let j = i + open.length; j < text.length; j += 1) {
      if (text[j] === '(') depth += 1;
      else if (text[j] === ')' && depth) depth -= 1;
      else if (text[j] === ')') {
        if (text[j + 1] !== ')') return false;
        for (i += open.length; i < j; ) {
          if (arithmetic('$((')) continue;
          if (at('$(')) substitution();
          else if (text[i] === '`') backticks(!quotes);
          else i += 1;
        }
        i = j + 2;
        return true;
      }
    }
    return false;
  };

  const doubleQuoted = (): string => {
    if (quotes) muted = true;
    quotes += 1;
    let raw = '';
    for (i += 1; i < text.length && text[i] !== '"'; ) {
      const size = text[i] === escape ? 2 : 1;
      if (arithmetic('$((')) {
        // skipped
      } else if (at('$(')) substitution();
      else if (!powershell && at('${')) braces();
      else if (!powershell && text[i] === '`') backticks(false);
      else {
        raw += text.slice(i, i + size);
        i += size;
        continue;
      }
      raw += ' ';
    }
    i += 1;
    quotes -= 1;
    if (!quotes) muted = false;
    return raw;
  };

  const singleQuoted = (escapes: boolean): string => {
    const start = i;
    while (i < text.length && text[i] !== "'") i += escapes && text[i] === '\\' ? 2 : 1;
    const raw = text.slice(start, i);
    i += 1;
    return raw;
  };

  /** `${...}`: one word. In Bash a substitution in it is a command of its own; in PowerShell the text is a name. */
  const braces = (): void => {
    if (powershell) return skipTo('}');
    for (i += 2; i < text.length && text[i] !== '}'; ) {
      if (arithmetic('$((')) continue;
      if (at('$(')) substitution();
      else if (at('${')) braces();
      else if (text[i] === '`') backticks(!quotes);
      else if (text[i] === '"') doubleQuoted();
      else if (text[i] === "'" && !quotes) {
        i += 1;
        singleQuoted(false);
      } else i += text[i] === escape ? 2 : 1;
    }
    i += 1;
  };

  /** The delimiter word of a heredoc: quotes are removed and nothing in it is expanded. */
  const heredoc = (tabs: boolean): Heredoc => {
    while (text[i] === ' ' || text[i] === '\t') i += 1;
    let delimiter = '';
    let quoted = false;
    let depth = 0;
    while (i < text.length && (depth ? text[i] !== '\n' : !/[\s;&|<>()]/.test(text[i]!))) {
      const span = /'([^']*)'|"((?:\\[\s\S]|[^"\\])*)"|\\([\s\S])/y;
      span.lastIndex = i;
      const part = span.exec(text);
      if (part) {
        quoted = true;
        delimiter += part[1] ?? part[2]?.replace(/\\([$`"\\])/g, '$1') ?? part[3];
        i += part[0].length;
      } else {
        const size = at('$(') ? 2 : 1;
        if (size === 2 || text[i] === '(') depth += 1;
        else if (text[i] === ')') depth -= 1;
        delimiter += text.slice(i, i + size);
        i += size;
      }
    }
    return { delimiter, tabs, quoted };
  };

  const readHeredocs = (heredocs: Heredoc[]): void => {
    for (const { delimiter, tabs, quoted } of heredocs.splice(0)) {
      for (let line: string | undefined; line !== delimiter && i < text.length; ) {
        const start = i;
        // Without a quoted delimiter Bash joins a line that ends in an unescaped backslash to the next one first.
        do skipTo('\n');
        while (!quoted && i < text.length && /(?<!\\)(?:\\\\)*\\\n$/.test(text.slice(start, i)));
        line = text.slice(start, i).replace(/\r?\n$/, '');
        if (!quoted) line = line.replace(/\\\n/g, '');
        if (tabs) line = line.replace(/^\t+/, '');
      }
    }
  };

  /** Reads commands up to `close` or the end of the text; with `commands` false the words are data (an array, a glob). */
  const list = (close: string, piped = false, commands = true, shared: Heredoc[] = []): void => {
    let words: string[] = [];
    const heredocs = shared;
    let word: { text: string; raw: string } | undefined;
    let input = false;
    let redirect = '';
    let cases = false;
    let pattern = false;
    const add = (part: string, raw = part): void => {
      word = { text: (word?.text ?? '') + part, raw: (word?.raw ?? '') + raw };
    };
    const endWord = (): void => {
      if (!word) return;
      const ended = word;
      word = undefined;
      if (redirect) {
        redirect = '';
        return;
      }
      words.push(ended.text);
      if (ended.text === '{' && words.length === 3 && words[0] === 'function') words = [];
      if (ended.text === 'in' && words.at(-3) === 'case' && words.slice(0, -3).every((w) => KEYWORDS.has(w))) {
        cases = true;
        pattern = true;
        words = [];
      } else if (ended.text === 'esac' && words.length === 1) pattern = false;
    };
    const endCommand = (pipe = false): void => {
      endWord();
      if (!words.length && !input) {
        piped ||= pipe;
        return;
      }
      if (commands && !pattern && !muted && interpreterReadsStdin(words, piped || input)) found = true;
      words = [];
      input = false;
      piped = pipe;
    };
    /** A bracketed list of the same command text: its heredocs are read with those of this one. */
    const group = (end: string, inherit = false, asCommands = true): void => {
      i += 1;
      list(end, inherit && piped, asCommands, heredocs);
    };
    const test = (): boolean => !powershell && words.includes('[[') && !words.includes(']]') && word?.raw !== ']]' && words.slice(0, words.indexOf('[[')).every((w) => KEYWORDS.has(w));

    while (i < text.length) {
      const c = text[i]!;
      const start = !word && words.every((w) => KEYWORDS.has(w));
      if (c === '\n' || (c === '\r' && powershell)) {
        endCommand();
        i += 1;
        if (c === '\n') readHeredocs(heredocs);
      } else if (c === ' ' || c === '\t' || at('\r\n')) {
        endWord();
        i += 1;
      } else if (powershell && at('<#')) skipTo('#>');
      else if (c === '#' && !word) while (i < text.length && text[i] !== '\n') i += 1;
      else if (c === escape) {
        const line = /^.(\r?\n)/s.exec(text.slice(i, i + 3));
        if (!line) add(plain(text.slice(i + 1, i + 2)), text.slice(i + 1, i + 2));
        else if (powershell) endWord();
        i += line ? line[0].length : 2;
      } else if (powershell && !word && /^@['"][ \t]*\r?\n/.test(text.slice(i))) {
        skipTo(`\n${text[i + 1]}@`);
        add('Q');
      } else if (c === "'" || (!powershell && at("$'"))) {
        const escapes = c === '$';
        i += escapes ? 2 : 1;
        const raw = singleQuoted(escapes);
        add(plain(raw), raw);
      } else if (c === '"') {
        const raw = doubleQuoted();
        add(plain(raw), raw);
      } else if (arithmetic('$((') || (!word && arithmetic('(('))) {
        add('Q');
      } else if (at('$(')) {
        substitution();
        add('Q');
      } else if (at('${')) {
        braces();
        add('$Q');
      } else if (!powershell && c === '`') {
        backticks(!muted);
        add('Q');
      } else if (/[|&<>()]/.test(c) && test()) {
        endWord();
        i += 1;
      } else if (!powershell && (at('<(') || at('>('))) {
        substitution();
        add('Q');
      } else if (c === '>' || at('&>') || (c === '<' && !powershell)) {
        const op = /<<<|<<-?|<&|<>|<|&>>?|>>|>\||>&|>/.exec(text.slice(i, i + 3))![0];
        const fd = word && /^(?:\d+|\*|\{\w+\})$/.test(word.raw) ? word.raw : undefined;
        if (fd !== undefined) word = undefined;
        endWord();
        if (!/[&>]/.test(op) && (fd === undefined || fd === '0')) input = true;
        i += op.length;
        if (op === '<<' || op === '<<-') heredocs.push(heredoc(op === '<<-'));
        else redirect = op;
      } else if (c === '|') {
        const size = at('||') || at('|&') ? 2 : 1;
        // A pipe with no white space on either side is as often an alternation, so it feeds nothing.
        endCommand(!at('||') && (/\s/.test(text[i - 1] ?? '') || /\s/.test(text[i + size] ?? '')));
        i += size;
      } else if (c === '&') {
        endCommand();
        i += 1;
      } else if (c === ';') {
        endCommand();
        const size = /;;?&?/.exec(text.slice(i, i + 3))![0].length;
        if (cases && size > 1) pattern = true;
        i += size;
      } else if (powershell && c === '=' && /^(?:\[[^\]]*\] ?)*\$\S*(?: [-+*/%?]+)?$/.test([...words, ...(word ? [word.raw] : [])].join(' '))) {
        // An assignment, with or without spaces: the command on its right side follows.
        word = undefined;
        words = [];
        i += 1;
      } else if (powershell && (c === '(' || c === '{')) {
        group(c === '(' ? ')' : '}', start);
        add('Q');
      } else if (c === '(' && pattern) i += 1;
      else if (c === '(' && word && /[=@!?*+]$/.test(word.raw)) {
        group(')', false, false);
        add('Q');
      } else if (c === '(') {
        group(')', start);
        // A subshell is a command; `name()` starts a function body, whose first command follows.
        word = undefined;
        words = start ? ['()'] : [];
      } else if (c === ')' && pattern && (words.length || word?.raw !== 'esac')) {
        endWord();
        words = [];
        pattern = false;
        piped = false;
        i += 1;
      } else if (c === close || c === ')') {
        endCommand();
        i += 1;
        if (c === close) return;
      } else {
        add(c);
        i += 1;
      }
    }
    endCommand();
  };

  list('');
  return found;
}

/** Decides on the `command` of a Bash or PowerShell event, from the dispatcher and from `aidlc hook stdin-script`; reads no config. */
export function stdinScript(event: HookEvent): HookResult {
  const command = event.tool_input?.['command'];
  const shell = event.tool_name === 'Bash' || event.tool_name === 'PowerShell';
  return shell && typeof command === 'string' && readsScriptFromStdin(command, event.tool_name === 'PowerShell') ? { exitCode: 2, stderr: RULE } : { exitCode: 0 };
}
