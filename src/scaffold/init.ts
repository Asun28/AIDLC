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

function mergeSettings(target: string, src: string, report: InitReport, options: InitOptions): void {
  const dest = path.join(target, '.claude', 'settings.json');
  const incoming = JSON.parse(readFileSync(src, 'utf8')) as { permissions?: { deny?: string[]; allow?: string[] }; hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>> };
  if (!existsSync(dest)) {
    if (!options.dryRun) {
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, JSON.stringify(incoming, null, 2) + '\n');
    }
    report.created.push('.claude/settings.json');
    return;
  }
  const existing = JSON.parse(readFileSync(dest, 'utf8')) as typeof incoming & Record<string, unknown>;
  const deny = new Set([...(existing.permissions?.deny ?? []), ...(incoming.permissions?.deny ?? [])]);
  existing.permissions = { ...(existing.permissions ?? {}), deny: [...deny] };
  existing.hooks = existing.hooks ?? {};
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
