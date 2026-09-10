/**
 * Stage 3 artifact: plan.md — produced in plan mode before implementation.
 *
 * Playbook shape: Files that change / Order of work / Risks / Proof. Scaffold shape adds the
 * ten PLAN-TEMPLATE sections for T1/T2 goals (goal & boundaries, minimal loop, stack,
 * structure, module design, data model & state machine, contracts, task split with
 * dependencies and parallel windows, acceptance, risks, after-merge). Definition-of-Ready
 * gates (borrowed from ai-sdlc DoR) decide `admit` vs `needs-clarification`.
 */
import { renderFrontMatter, splitFrontMatter } from './frontmatter.ts';
import { sectionMap } from './intent.ts';

export interface PlanCardRow {
  id: string;
  priority: 'MUST' | 'SHOULD' | 'COULD';
  output: string;
  dependsOn: string[];
  parallelWindow?: string;
  freezePoint?: boolean;
}

export interface Plan {
  slug: string;
  title: string;
  specRef: string;
  size: 'T0-bugfix' | 'T0' | 'T1' | 'T2';
  status: 'draft' | 'approved';
  createdAt: string;
  approvedBy?: string;
  filesThatChange: string[];
  orderOfWork: string[];
  risks: string[];
  proof: string[];
  /** T1/T2 extended sections. */
  goalAndBoundaries?: string;
  minimalLoop?: string;
  stack?: string;
  structure?: string;
  moduleDesign?: string;
  dataModel?: string;
  contracts?: string;
  cards?: PlanCardRow[];
  afterMerge?: string;
}

export function renderPlan(plan: Plan): string {
  const fm: Record<string, unknown> = { slug: plan.slug, title: plan.title, spec: plan.specRef, size: plan.size, status: plan.status, created: plan.createdAt };
  if (plan.approvedBy) fm['approved_by'] = plan.approvedBy;
  const light = plan.size === 'T0' || plan.size === 'T0-bugfix';
  const lines: string[] = [`# Plan: ${plan.title} (from ${plan.specRef})`, ''];
  if (!light) {
    lines.push('## 1. Goal and boundaries', plan.goalAndBoundaries?.trim() || 'none this version', '');
    lines.push('## 2. Minimal acceptable loop', plan.minimalLoop?.trim() || 'none this version', '');
    lines.push('## 3. Tech stack', plan.stack?.trim() || 'none this version', '');
    lines.push('## 4. Directory structure', plan.structure?.trim() || 'none this version', '');
    lines.push('## 4.5 Module design', plan.moduleDesign?.trim() || 'none this version', '');
    lines.push('## 5. Data model and state machine', plan.dataModel?.trim() || 'none this version', '');
    lines.push('## 6. Contracts and core interfaces', plan.contracts?.trim() || 'none this version', '');
  }
  lines.push('## Files that change', ...(plan.filesThatChange.length ? plan.filesThatChange.map((f) => `- ${f}`) : ['- (list the files; new files marked (new))']), '');
  lines.push('## Order of work', ...(plan.orderOfWork.length ? plan.orderOfWork.map((s, i) => `${i + 1}. ${s}`) : ['1. (first bounded step)']), '');
  if (!light) {
    lines.push('## 7. Task split (dependencies and parallel windows)', '', '| Card | Priority | Output | depends_on | Parallel window | Freeze point |', '|---|---|---|---|---|---|');
    for (const c of plan.cards ?? []) lines.push(`| ${c.id} | ${c.priority} | ${c.output} | ${c.dependsOn.join(', ') || '-'} | ${c.parallelWindow ?? '-'} | ${c.freezePoint ? 'yes' : '-'} |`);
    if (!plan.cards?.length) lines.push('| (none yet) | | | | | |');
    lines.push('');
  }
  lines.push('## Risks', ...(plan.risks.length ? plan.risks.map((r) => `- ${r}`) : ['- (what could break; rate limits, shared resources, data)']), '');
  lines.push('## Proof', ...(plan.proof.length ? plan.proof.map((p) => `- ${p}`) : ['- (tests / screenshots / measurements that prove it)']), '');
  if (!light) lines.push('## 10. After merge', plan.afterMerge?.trim() || 'none this version (development-only target)', '');
  return renderFrontMatter(fm, lines.join('\n'));
}

export interface DorGate {
  gateId: number;
  name: string;
  verdict: 'pass' | 'fail' | 'skip';
  severity: 'block' | 'warn';
  finding?: string;
  clarificationQuestion?: string;
}

export interface PlanReadiness {
  overall: 'admit' | 'needs-clarification';
  gates: DorGate[];
  questions: string[];
}

const MARKERS = /\b(TBD|TODO|XXX|FIXME|\?\?\?|not sure|decide later|to be determined|placeholder)\b/i;

/** Definition-of-Ready for a plan: pure gates, block on fail. */
export function evaluatePlanReadiness(text: string, options: { fileExists?: (p: string) => boolean; light?: boolean } = {}): PlanReadiness {
  const doc = splitFrontMatter(text);
  const body = doc?.body ?? text;
  const sections = sectionMap(body);
  const gates: DorGate[] = [];
  const stripped = body.replace(/```[\s\S]*?```/g, '');

  const files = (sections.get('files that change') ?? '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l && !l.startsWith('('));
  gates.push({ gateId: 1, name: 'files named', verdict: files.length ? 'pass' : 'fail', severity: 'block', finding: files.length ? undefined : 'no files listed under "Files that change"', clarificationQuestion: files.length ? undefined : 'Which files change?' });

  const order = (sections.get('order of work') ?? '').split('\n').filter((l) => /^\s*\d+\./.test(l) && !/\(first bounded step\)/.test(l));
  gates.push({ gateId: 2, name: 'order of work', verdict: order.length >= 1 && order.length <= 20 ? 'pass' : 'fail', severity: 'block', finding: order.length ? (order.length > 20 ? 'more than 20 steps; split the plan' : undefined) : 'no ordered steps', clarificationQuestion: order.length ? undefined : 'What is the order of work?' });

  const marker = stripped.match(MARKERS);
  const tbdClosed = /\[TBD:[^\]]+\]/.test(stripped);
  gates.push({ gateId: 3, name: 'no open markers', verdict: marker && !tbdClosed ? 'fail' : 'pass', severity: 'block', finding: marker && !tbdClosed ? `open marker "${marker[0]}"` : undefined, clarificationQuestion: marker && !tbdClosed ? `Resolve "${marker[0]}" or convert it to a closed [TBD: question]` : undefined });

  const proof = (sections.get('proof') ?? '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l && !l.startsWith('('));
  gates.push({ gateId: 4, name: 'proof stated', verdict: proof.length ? 'pass' : 'fail', severity: 'block', finding: proof.length ? undefined : 'no proof (tests/screenshots/measurements) declared', clarificationQuestion: proof.length ? undefined : 'What proves the change works?' });

  const risks = (sections.get('risks') ?? '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l && !l.startsWith('('));
  gates.push({ gateId: 5, name: 'risks considered', verdict: risks.length ? 'pass' : 'skip', severity: 'warn', finding: risks.length ? undefined : 'no risks listed (soft)' });

  if (options.fileExists) {
    const missing = files.filter((f) => !/\(new\)/i.test(f)).map((f) => f.replace(/\s+\(.*\)$/, '')).filter((f) => !options.fileExists!(f));
    gates.push({ gateId: 6, name: 'existing files resolve', verdict: missing.length ? 'fail' : 'pass', severity: 'block', finding: missing.length ? `files not found: ${missing.slice(0, 5).join(', ')}` : undefined, clarificationQuestion: missing.length ? 'Are these files new? Mark them (new) or fix the paths.' : undefined });
  } else {
    gates.push({ gateId: 6, name: 'existing files resolve', verdict: 'skip', severity: 'warn', finding: 'no file resolver supplied' });
  }

  if (!options.light) {
    const table = sections.get('7. task split (dependencies and parallel windows)') ?? '';
    const rows = table.split('\n').filter((l) => /^\|\s*T\d+-/.test(l));
    gates.push({ gateId: 7, name: 'task split present', verdict: rows.length ? 'pass' : 'fail', severity: 'block', finding: rows.length ? undefined : 'T1/T2 plan has no card rows in the task split table', clarificationQuestion: rows.length ? undefined : 'How is the work split into cards?' });
  }

  const overall = gates.some((g) => g.verdict === 'fail' && g.severity === 'block') ? 'needs-clarification' : 'admit';
  return { overall, gates, questions: gates.map((g) => g.clarificationQuestion).filter((q): q is string => Boolean(q)) };
}

/** Parse the task-split table rows into card rows (for projection). */
export function parsePlanCards(text: string): PlanCardRow[] {
  const doc = splitFrontMatter(text);
  const sections = sectionMap(doc?.body ?? text);
  const table = sections.get('7. task split (dependencies and parallel windows)') ?? '';
  const rows: PlanCardRow[] = [];
  for (const line of table.split('\n')) {
    if (!/^\|\s*T\d+-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const [id, priority, output, deps, window, freeze] = cells;
    if (!id) continue;
    rows.push({
      id,
      priority: (['MUST', 'SHOULD', 'COULD'].includes(priority ?? '') ? priority : 'MUST') as PlanCardRow['priority'],
      output: output ?? '',
      dependsOn: (deps ?? '').split(',').map((d) => d.trim()).filter((d) => d && d !== '-'),
      parallelWindow: window && window !== '-' ? window : undefined,
      freezePoint: /yes|true|freeze/i.test(freeze ?? ''),
    });
  }
  return rows;
}
