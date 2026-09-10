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

export function initProject(options: InitOptions): InitReport {
  const tpl = templatesDir();
  const report: InitReport = { created: [], skipped: [], merged: [], templatesDir: tpl };
  const target = path.resolve(options.target);
  const cardsDir = options.cardsDir ?? 'specs/tasks';
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
  const need = ['.aidlc/', '_local/'];
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

/**
 * Fastest hook command available in the target: a direct `node` start of the hook entry (no npx
 * resolution, no CLI module graph) when the package is installed locally or the target is aidlc itself;
 * otherwise the portable `npx --no-install` form.
 */
export function resolveHookCommand(target: string): string {
  if (existsSync(path.join(target, 'node_modules', 'aidlc', 'bin', 'aidlc-hook.js'))) return 'node node_modules/aidlc/bin/aidlc-hook.js';
  if (existsSync(path.join(target, 'bin', 'aidlc-hook.js'))) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === 'aidlc') return 'node bin/aidlc-hook.js';
    } catch {
      /* not the aidlc package */
    }
  }
  return TEMPLATE_HOOK_COMMAND;
}

/** Drop 0.1.0 per-guard hooks (superseded by the dispatcher) and any entry left empty by that. */
export function stripLegacyHooks(hooks: Record<string, HookEntry[]>): void {
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) entry.hooks = entry.hooks.filter((h) => !LEGACY_HOOK_COMMAND.test(h.command));
    hooks[event] = entries.filter((e) => e.hooks.length > 0);
  }
}

function mergeSettings(target: string, src: string, report: InitReport, options: InitOptions): void {
  const dest = path.join(target, '.claude', 'settings.json');
  const incoming = JSON.parse(readFileSync(src, 'utf8')) as Settings;
  const hookCommand = resolveHookCommand(target);
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
  for (const [event, entries] of Object.entries(incoming.hooks ?? {})) {
    const list = existing.hooks[event] ?? [];
    for (const entry of entries) {
      const same = list.find((e) => (e.matcher ?? '') === (entry.matcher ?? ''));
      if (same) {
        for (const h of entry.hooks) if (!same.hooks.some((x) => x.command === h.command)) same.hooks.push(h);
      } else list.push(entry);
    }
    existing.hooks[event] = list;
  }
  if (!options.dryRun) writeFileSync(dest, JSON.stringify(existing, null, 2) + '\n');
  report.merged.push('.claude/settings.json');
}
