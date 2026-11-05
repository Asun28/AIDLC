/**
 * `aidlc init`: lay the AI-native SDLC over a repository (playbook file layout + scaffold-
 * compatible card registry). Existing files are never overwritten unless `--force`; the
 * CLAUDE.md section, .gitignore entries and .claude/settings.json hooks are merged.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface InitOptions {
  target: string;
  force?: boolean;
  cardsDir?: string;
  shipPath?: 'scaffold' | 'github' | 'dry-run';
  dryRun?: boolean;
  /** Absolute path of the running CLI's `bin/aidlc-hook.js`; a target with no Node package gets a hook command that names it. */
  hookEntry?: string;
}

export interface InitReport {
  created: string[];
  skipped: string[];
  merged: string[];
  templatesDir: string;
}

export function templatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, '..', '..', 'templates'), path.join(here, '..', 'templates'), path.join(process.cwd(), 'templates')];
  const hit = candidates.find((c) => existsSync(path.join(c, 'claude', 'settings.json')));
  if (!hit) throw new Error(`templates directory not found (looked in ${candidates.join(', ')})`);
  return hit;
}

const MARKER = '## AI-native SDLC (aidlc)';
/** Workflows that run `npm ci`, so they fail on every push of a repository with no `package.json`. */
const NODE_WORKFLOWS = new Set(['.github/workflows/aidlc-ci.yml', '.github/workflows/agent-evals.yml']);

/** Whether the target holds an entry other than `.git`. A target that does not exist yet holds none; any other listing failure stops init. */
function holdsContent(target: string): boolean {
  try {
    return readdirSync(target).some((name) => name !== '.git');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** A file of the target with one terminal line ending removed, so a second one stays and fails the checks; nothing when it cannot be read. */
function readOneLine(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  } catch {
    return undefined;
  }
}

/**
 * A directory named by a `.git` or `commondir` file, resolved against `base`; empty for no value, for a second line, or
 * for a value starting with two separators, which on Windows can name a file on another host.
 */
function namedDir(base: string, value: string): string {
  return !value || /[\r\n]/.test(value) || /^[\\/]{2}/.test(value) ? '' : path.resolve(base, value);
}

/** The git directory of the target: `.git`, or the directory a `.git` file names on its `gitdir:` line. Empty when that line is unusable. */
function gitDirOf(target: string): string {
  const dotGit = path.join(target, '.git');
  const pointer = readOneLine(dotGit);
  if (pointer === undefined) return dotGit;
  return pointer.startsWith('gitdir: ') ? namedDir(target, pointer.slice('gitdir: '.length)) : '';
}

/** The common directory: `gitDir` itself, or the directory its `commondir` file names. Empty when that file is unusable. */
function commonDirOf(gitDir: string): string {
  const pointer = readOneLine(path.join(gitDir, 'commondir'));
  return pointer === undefined ? gitDir : namedDir(gitDir, pointer);
}

/** Whether a name read from a ref file can go into the config: `base` later reaches git arguments, so it cannot read as an option, and every part is one git accepts. */
function isBranchName(name: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('-') && !name.includes('..') && name.split('/').every((part) => part !== '' && !part.startsWith('.'));
}

/** The branch on the one line `ref: <prefix><name>` of a ref file; empty for any other content, or when it cannot be read. */
function branchIn(file: string, prefix: string): string {
  const line = readOneLine(file);
  if (!line?.startsWith(`ref: ${prefix}`)) return '';
  const name = line.slice('ref: '.length + prefix.length);
  return isBranchName(name) ? name : '';
}

/**
 * The remote default branch, else the current branch; empty when neither file gives a name. Reads ref files and starts no
 * process, since a `git` start can resolve to a program in the target and obeys `GIT_DIR` over its `-C` argument.
 */
function defaultBranch(target: string): string {
  const gitDir = gitDirOf(target);
  if (!gitDir) return '';
  const commonDir = commonDirOf(gitDir);
  const remote = commonDir ? branchIn(path.join(commonDir, 'refs', 'remotes', 'origin', 'HEAD'), 'refs/remotes/origin/') : '';
  return remote || branchIn(path.join(gitDir, 'HEAD'), 'refs/heads/');
}

export function initProject(options: InitOptions): InitReport {
  const tpl = templatesDir();
  const report: InitReport = { created: [], skipped: [], merged: [], templatesDir: tpl };
  const target = path.resolve(options.target);
  const cardsDir = options.cardsDir ?? 'specs/tasks';
  // Read before the first write, since init itself creates entries.
  const noPackage = holdsContent(target) && !existsSync(path.join(target, 'package.json'));
  const write = (rel: string, content: string | Buffer, mode: 'create' | 'force' = 'create') => {
    const dest = path.join(target, rel);
    if (existsSync(dest) && !(options.force || mode === 'force')) {
      report.skipped.push(rel);
      return;
    }
    if (!options.dryRun) {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, content);
    }
    report.created.push(rel);
  };
  const copyTree = (fromRel: string, toRel: string) => {
    const from = path.join(tpl, fromRel);
    if (!existsSync(from)) return;
    for (const name of readdirSync(from)) {
      const src = path.join(from, name);
      const rel = path.join(toRel, name).replace(/\\/g, '/');
      if (statSync(src).isDirectory()) copyTree(path.join(fromRel, name), path.join(toRel, name));
      else if (noPackage && NODE_WORKFLOWS.has(rel)) report.skipped.push(`${rel} (no package.json)`);
      else if (rel !== '.claude/settings.json') write(rel, readFileSync(src));
    }
  };

  copyTree('claude/skills', '.claude/skills');
  copyTree('claude/agents', '.claude/agents');
  mergeSettings(target, path.join(tpl, 'claude', 'settings.json'), report, options);
  write('REVIEW.md', readFileSync(path.join(tpl, 'REVIEW.md')));
  write('bands.yaml', readFileSync(path.join(tpl, 'bands.yaml')));
  copyTree('intent', 'intent');
  for (const name of ['README.md', '_TEMPLATE.md']) {
    const src = path.join(tpl, 'specs', name);
    if (existsSync(src)) write(name === 'README.md' ? 'specs/README.md' : 'specs/_SPEC-TEMPLATE.md', readFileSync(src));
  }
  copyTree('plans', 'plans');
  write(`${cardsDir}/_TEMPLATE.md`, readFileSync(path.join(tpl, 'cards', '_TEMPLATE.md')));
  copyTree('evals', 'evals');
  copyTree('github/workflows', '.github/workflows');
  copyTree('docs', 'docs');
  // config
  const cfgSrc = path.join(tpl, 'aidlc.config.json');
  if (existsSync(cfgSrc)) {
    const cfg = JSON.parse(readFileSync(cfgSrc, 'utf8')) as Record<string, unknown>;
    cfg['cardsDir'] = cardsDir;
    const base = defaultBranch(target);
    if (base) cfg['base'] = base;
    if (options.shipPath) cfg['shipPath'] = options.shipPath;
    write('aidlc.config.json', JSON.stringify(cfg, null, 2) + '\n');
  }
  write('aidlc.ops.example.json', readFileSync(path.join(tpl, 'aidlc.ops.example.json')));
  // CLAUDE.md section
  const section = readFileSync(path.join(tpl, 'CLAUDE.aidlc.md'), 'utf8');
  const claudeMd = path.join(target, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    const current = readFileSync(claudeMd, 'utf8');
    if (current.includes(MARKER)) report.skipped.push('CLAUDE.md (section present)');
    else {
      if (!options.dryRun) writeFileSync(claudeMd, current.trimEnd() + '\n\n' + section.trim() + '\n');
      report.merged.push('CLAUDE.md');
    }
  } else {
    write('CLAUDE.md', `# ${path.basename(target)}\n\n${section.trim()}\n`);
  }
  // .gitignore
  const gi = path.join(target, '.gitignore');
  // Paths the loop writes into a checkout: state, the board mirror, and the R2/R3 verdicts and logs under the review checkout.
  const need = ['.aidlc/', '_local/', '.review/'];
  const current = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const missing = need.filter((n) => !current.split(/\r?\n/).some((l) => l.trim() === n || l.trim() === n.replace(/\/$/, '')));
  if (missing.length) {
    if (!options.dryRun) writeFileSync(gi, (current ? current.trimEnd() + '\n' : '') + '# aidlc runtime state (never committed)\n' + missing.join('\n') + '\n');
    report.merged.push('.gitignore');
  }
  return report;
}

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string }> };
type Settings = { permissions?: { deny?: string[]; allow?: string[] }; hooks?: Record<string, HookEntry[]> };

/** The template's portable dispatcher command; `init` swaps in a direct `node` entry when it can see one. */
const TEMPLATE_HOOK_COMMAND = 'npx --no-install aidlc hook auto';
/** Per-guard wiring from 0.1.0: three `npx` starts per tool call. Replaced by the one-process dispatcher. */
const LEGACY_HOOK_COMMAND = /\baidlc hook (production-gate|protect-paths|protect-tests|secrets-guard|verify-before-done|route-new-work)$/;
/** The `PreToolUse` matcher before PowerShell joined it. */
const OLD_PRE_TOOL_MATCHER = 'Bash|Edit|Write|MultiEdit';
/** Every spelling of the dispatcher `resolveHookCommand` can write. */
const DISPATCHER_COMMANDS = new Set([TEMPLATE_HOOK_COMMAND, 'node node_modules/aidlc/bin/aidlc-hook.js', 'node bin/aidlc-hook.js']);
/**
 * The absolute spelling. An absolute path cannot be read as a Node option. The path holds no shell expansion or separator
 * character and no NUL, which no process argument can carry; `(` and `)` stay, for `C:/Program Files (x86)`. It does not
 * start `//` and holds no backslash, because on Windows either can name a file on another host, which even the file check of doctor would reach.
 */
const ABSOLUTE_DISPATCHER = /^node "(?=\/(?!\/)|[A-Za-z]:\/)[^"$`%&|<>^\\\0\r\n]*\/bin\/aidlc-hook\.js"$/;

/** Whether a settings value is the aidlc dispatcher in any spelling; only such a command is replaced, or read by doctor. The value comes from a parsed file, so it may not be a string. */
export function isDispatcherCommand(command: unknown): command is string {
  return typeof command === 'string' && (DISPATCHER_COMMANDS.has(command) || ABSOLUTE_DISPATCHER.test(command));
}

/**
 * Fastest hook command available in the target: a direct `node` start of the hook entry (no npx
 * resolution, no CLI module graph) when the package is installed locally or the target is aidlc itself;
 * a direct start of `hookEntry` when the target has no aidlc package at all, because the `npx` form exits 1 there
 * and a hook that exits 1 stops nothing; otherwise the portable `npx --no-install` form.
 */
export function resolveHookCommand(target: string, hookEntry?: string): string {
  if (existsSync(path.join(target, 'node_modules', 'aidlc', 'bin', 'aidlc-hook.js'))) return 'node node_modules/aidlc/bin/aidlc-hook.js';
  const pkg = readPackage(target);
  if (pkg.name === 'aidlc') return existsSync(path.join(target, 'bin', 'aidlc-hook.js')) ? 'node bin/aidlc-hook.js' : TEMPLATE_HOOK_COMMAND;
  if (hookEntry && !holdsAidlc(pkg.dependencies) && !holdsAidlc(pkg.devDependencies)) {
    const direct = `node "${hookEntry.replace(/\\/g, '/')}"`;
    if (isDispatcherCommand(direct)) return direct;
  }
  return TEMPLATE_HOOK_COMMAND;
}

/** The target's `package.json`; a file that is absent or does not parse lists nothing. */
function readPackage(target: string): { name?: string; dependencies?: unknown; devDependencies?: unknown } {
  try {
    return JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')) ?? {};
  } catch {
    return {};
  }
}

/** Whether a dependency map holds the key `aidlc`, whatever its version; a value that is not an object lists nothing. */
function holdsAidlc(map: unknown): boolean {
  return typeof map === 'object' && map !== null && Object.hasOwn(map, 'aidlc');
}

/** Drop 0.1.0 per-guard hooks (superseded by the dispatcher) and any entry left empty by that. */
export function stripLegacyHooks(hooks: Record<string, HookEntry[]>): void {
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) entry.hooks = entry.hooks.filter((h) => !LEGACY_HOOK_COMMAND.test(h.command));
    hooks[event] = entries.filter((e) => e.hooks.length > 0);
  }
}

/** Take the dispatcher off an old-matcher entry, where it would run beside the new entry, and drop an entry left empty; a foreign hook stays. */
function moveOffOldMatcher(hooks: Record<string, HookEntry[]>): void {
  const entries = hooks['PreToolUse'];
  if (!entries) return;
  for (const entry of entries) if (entry.matcher === OLD_PRE_TOOL_MATCHER) entry.hooks = entry.hooks.filter((h) => !isDispatcherCommand(h.command));
  hooks['PreToolUse'] = entries.filter((e) => e.matcher !== OLD_PRE_TOOL_MATCHER || e.hooks.length > 0);
}

/**
 * The hooks of one event with `entry`'s dispatcher exactly once, in an entry of its matcher, where it already stands if it
 * does. Every other spelling and repeat comes off every entry of the event, and an entry left empty is dropped. The new
 * matcher covers every tool a guard reads, so no guard is lost. A foreign hook stays in its place.
 */
function settleDispatcher(list: HookEntry[], entry: HookEntry): HookEntry[] {
  const isHome = (e: HookEntry) => (e.matcher ?? '') === (entry.matcher ?? '');
  for (const h of entry.hooks) {
    let held = false;
    for (const e of list) {
      e.hooks = e.hooks.filter((x) => {
        if (!isDispatcherCommand(x.command)) return true;
        const keep = !held && isHome(e) && x.command === h.command;
        held ||= keep;
        return keep;
      });
    }
    if (held) continue;
    const home = list.find(isHome);
    if (home) home.hooks.push(h);
    else list.push({ ...entry, hooks: [h] });
  }
  return list.filter((e) => e.hooks.length > 0);
}

function mergeSettings(target: string, src: string, report: InitReport, options: InitOptions): void {
  const dest = path.join(target, '.claude', 'settings.json');
  const incoming = JSON.parse(readFileSync(src, 'utf8')) as Settings;
  const hookCommand = resolveHookCommand(target, options.hookEntry);
  for (const entries of Object.values(incoming.hooks ?? {})) for (const entry of entries) for (const h of entry.hooks) if (h.command === TEMPLATE_HOOK_COMMAND) h.command = hookCommand;
  if (!existsSync(dest)) {
    if (!options.dryRun) {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, JSON.stringify(incoming, null, 2) + '\n');
    }
    report.created.push('.claude/settings.json');
    return;
  }
  const existing = JSON.parse(readFileSync(dest, 'utf8')) as Settings & Record<string, unknown>;
  const deny = new Set([...(existing.permissions?.deny ?? []), ...(incoming.permissions?.deny ?? [])]);
  existing.permissions = { ...(existing.permissions ?? {}), deny: [...deny] };
  existing.hooks = existing.hooks ?? {};
  stripLegacyHooks(existing.hooks);
  moveOffOldMatcher(existing.hooks);
  for (const [event, entries] of Object.entries(incoming.hooks ?? {})) {
    let list = existing.hooks[event] ?? [];
    for (const entry of entries) list = settleDispatcher(list, entry);
    existing.hooks[event] = list;
  }
  if (!options.dryRun) writeFileSync(dest, JSON.stringify(existing, null, 2) + '\n');
  report.merged.push('.claude/settings.json');
}
