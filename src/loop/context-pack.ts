import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Card } from '../core/types.ts';

export interface ContextSources { planSection: string; lessons: string; modules?: string[]; missingSources?: string[] }

/** Repository text stays JSON data; a byte is a conservative upper bound on a tokenizer token. */
export function contextPack(card: Card, sources: ContextSources, tokenBudget = 8192): string {
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) throw new Error('Context token budget must be a positive safe integer');
  const modules = [...card.allow_paths.flatMap((p) => p.match(/^src\/([^/]+)\//)?.[1] ?? []), ...(sources.modules ?? [])];
  const names = [...card.allow_paths, ...modules.flatMap((m) => m.startsWith('src/') ? [m, m.slice(4)] : [m, `src/${m}`])].filter(Boolean);
  const relevant = (line: string) => names.some((name) => {
    const descendants = card.allow_paths.includes(name) && name.endsWith('/') ? '|/' : '';
    return new RegExp(`(^|[^\\w/.-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/$/, '')}(?=$|[^\\w/.-]|\\.(?=$|\\s)${descendants})`).test(line);
  });
  const pack = { tokenBudget, planRef: card.plan_ref ?? null, planSection: sources.planSection, acceptance: card.acceptance, allow_paths: card.allow_paths, non_goals: card.non_goals ?? [], lessons: sources.lessons.split(/\r?\n/).filter((l) => l.startsWith('- ') && relevant(l)), missingSources: sources.missingSources ?? [], truncated: { lessons: 0, plan: false } };
  const fits = () => Buffer.byteLength(JSON.stringify(pack), 'utf8') <= tokenBudget;
  while (!fits() && pack.lessons.length) { pack.lessons.pop(); pack.truncated.lessons++; }
  if (!fits()) {
    const points = Array.from(pack.planSection);
    pack.planSection = '';
    pack.truncated.plan = true;
    if (!fits()) throw new Error('Context mandatory fields exceed token budget; acceptance was not truncated');
    let low = 0, high = points.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      pack.planSection = points.slice(0, mid).join('');
      if (fits()) low = mid; else high = mid - 1;
    }
    pack.planSection = points.slice(0, low).join('');
  }
  return JSON.stringify(pack);
}

/** Read only local repository sources; missing files/anchors are explicit in the projection. */
export function loadContextPack(card: Card, root: string, modules: string[], plansDir = 'plans'): string {
  root = realpathSync(root);
  const missingSources: string[] = [];
  const within = (file: string, dir: string) => { const rel = path.relative(dir, file); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
  const isPlan = (file: string) => path.extname(file).toLowerCase() === '.md' && [plansDir, 'docs/plans'].some((dir) => within(file, path.resolve(root, dir)));
  const read = (ref: string, plan = false): string => {
    const target = path.resolve(root, ref);
    if (!within(target, root)) throw new Error('Context source outside repository');
    if (plan && !isPlan(target)) throw new Error('Context plan source must be Markdown in plansDir or docs/plans');
    try {
      const resolved = realpathSync(target);
      if (!within(resolved, root)) throw new Error('Context source outside repository');
      if (plan ? !isPlan(resolved) : path.relative(resolved, path.join(root, 'docs', 'LESSONS.md')) !== '') throw new Error(`Context ${plan ? 'plan' : 'lesson'} source resolves outside its allowed location`);
      return readFileSync(resolved, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missingSources.push(ref);
      return '';
    }
  };
  const [file, anchor] = (card.plan_ref ?? '').split('#');
  let planSection = file ? read(file, true) : '';
  if (!file) missingSources.push('plan_ref');
  if (file && anchor && !missingSources.includes(file)) {
    const lines = planSection.split(/\r?\n/);
    let fence = '';
    const headings = lines.map((line) => {
      const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (delimiter) {
        if (!fence) fence = delimiter[1]!;
        else if (delimiter[1]![0] === fence[0] && delimiter[1]!.length >= fence.length && !delimiter[2]!.trim()) fence = '';
        return null;
      }
      return fence ? null : line.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    });
    const slug = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
    const start = headings.findIndex((h) => h && slug(h[2]!) === anchor);
    const level = headings[start]?.[1]?.length ?? 0;
    const end = headings.findIndex((h, i) => i > start && h && h[1]!.length <= level);
    planSection = start < 0 ? '' : lines.slice(start, end < 0 ? undefined : end).join('\n').trim();
    if (start < 0) missingSources.push(card.plan_ref!);
  }
  const lessons = read('docs/LESSONS.md');
  return contextPack(card, { planSection, lessons, modules, missingSources });
}
