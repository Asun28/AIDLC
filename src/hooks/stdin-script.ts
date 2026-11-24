/**
 * Whether a shell command starts python, node or pwsh on a program read from standard input (card
 * T0-SMALL-ISSUES-463-428-ZOD, issue 463). The forms read are the closed list of `docs/OPERATIONS.md`, Hooks; any other
 * spelling passes. The guard is a reminder of a written rule, not a security boundary, so an unread form is let through.
 */
import type { HookEvent, HookResult } from './index.ts';

const RULE = 'Never feed a script to an interpreter on standard input (`python -`, a heredoc into `node`): write it to a file outside the worktree and run the file.';

/** Wrapper words, shell keywords and assignments that may stand before the interpreter; no option of a wrapper is read. */
const PREFIX = /^(?:(?:sudo|time|env|exec|command|nohup|if|then|do|else|elif|while|until|!)\s+|timeout\s+[\d.]+[smhd]?\s+|[A-Za-z_]\w*=\S*\s+)+/;
/** One redirection with its target. */
const REDIRECT = /(?:\d+|&)?[<>]+[ \t]*\S*/g;

/** The options that take the next word as their value, and the options after which the program is not standard input. */
const PYTHON = { values: new Set(['-X', '-W']), program: /^-(?![XW])[A-Za-z]*[cm]/ };
const NODE = {
  values: new Set(['-r', '--require', '--import', '--loader', '-C', '--conditions', '--input-type', '--env-file']),
  program: /^(?:-e|-p|-pe|--eval|--print|--test)(?:=|$)/,
};

/** Drops the body of each heredoc (Bash) or here-string (PowerShell): it is data or a program, never a command of this shell. */
function dropBodies(text: string, powershell: boolean): string {
  return powershell
    ? text.replace(/@(['"])[ \t]*\r?\n[\s\S]*?\n\1@/g, 'Q')
    : text.replace(/(?<!<)<<-?[ \t]*(?:(["'])([^\n]+?)\1|\\?(\w[\w.-]*))([^\n]*)\n(?:[\s\S]*?\n)??\t*\2\3\r?(?=\n|$)/g, '<<H$4');
}

/** Drops comments, and gives a quoted span or an escaped character as one word: its own text when that is one plain word, else `Q`; a double-quoted `$(` keeps its text. */
function dropQuotes(text: string, powershell: boolean): string {
  const spans = powershell ? /(?<!\S)#[^\n]*|'[^']*'|"(?:`[\s\S]|[^"`])*"/g : /(?<!\S)#[^\n]*|\\[^\w\r\n]|'[^']*'|"(?:\\[\s\S]|[^"\\])*"/g;
  return text.replace(spans, (span) => {
    if (span.startsWith('#')) return '';
    const inner = span.slice(1, -1);
    if (span.startsWith('"') && inner.includes('$(')) return dropQuotes(inner, powershell);
    return /^[\w.:\\/-]+$/.test(inner) ? inner : 'Q';
  });
}

function interpreterReadsStdin(segment: string, piped: boolean): boolean {
  const fed = piped || segment.includes('<');
  const [first = '', ...args] = segment.replace(PREFIX, '').replace(REDIRECT, ' ').trim().split(/\s+/);
  const name = first.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
  if (name === 'pwsh' || name === 'powershell') {
    const at = args.findIndex((a) => /^--?[a-z]+$/i.test(a) && ['command', 'file'].some((o) => o.startsWith(a.replace(/^--?/, '').toLowerCase())));
    return at >= 0 && args[at + 1] === '-';
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

function readsScriptFromStdin(command: string, powershell: boolean): boolean {
  const joined = dropQuotes(dropBodies(command, powershell), powershell).replace(powershell ? /`\r?\n/g : /\\\r?\n/g, ' ');
  // An input process substitution is one word of its command, and a command of its own; `>|` holds no pipe.
  const text = joined.replace(/<\(/g, ' Q (').replace(/>\|/g, '>');
  let piped = false;
  const parts = text.split(/(\|\||(?<![<>])&(?!>)|[;|{}()`\r\n])/);
  for (const [i, part] of parts.entries()) {
    if (i % 2) {
      // A pipe with no white space on either side is as often an alternation (`case x in a|node)`), so it feeds nothing.
      if (part === '|' && (/\s$/.test(parts[i - 1]!) || /^\s/.test(parts[i + 1]!))) piped = true;
      continue;
    }
    const segment = part.trim();
    if (!segment) continue;
    if (interpreterReadsStdin(segment, piped)) return true;
    piped = false;
  }
  return false;
}

/** Decides on the `command` of a Bash or PowerShell event, from the dispatcher and from `aidlc hook stdin-script`; reads no config. */
export function stdinScript(event: HookEvent): HookResult {
  const command = event.tool_input?.['command'];
  const shell = event.tool_name === 'Bash' || event.tool_name === 'PowerShell';
  return shell && typeof command === 'string' && readsScriptFromStdin(command, event.tool_name === 'PowerShell') ? { exitCode: 2, stderr: RULE } : { exitCode: 0 };
}
