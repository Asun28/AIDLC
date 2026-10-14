/**
 * Test fixtures that render a spec and a plan artifact from their fields for the parser and readiness tests. Moved
 * from src/artifacts with the same names and bodies (card T1-SWEEP2-TEST-ONLY): only tests called them.
 */
import { renderFrontMatter } from '../../src/artifacts/frontmatter.ts';
import type { Plan } from '../../src/artifacts/plan.ts';
import type { Spec } from '../../src/artifacts/spec.ts';

export function renderSpec(spec: Spec): string {
  const fm: Record<string, unknown> = {
    slug: spec.slug,
    title: spec.title,
    intent: spec.intentRef,
    status: spec.status,
    created: spec.createdAt,
    skills_applied: spec.skillsApplied,
  };
  const body = [
    `# Spec: ${spec.title}`,
    `From intent: ${spec.intentRef}. Status: ${spec.status}. Skills applied: ${spec.skillsApplied.join(', ') || '(none)'}.`,
    '',
    '## Requirements (EARS)',
    ...(spec.requirements.length ? spec.requirements.map((r) => `- ${r}`) : ['- R1. The <system> shall <observable response>.']),
    '',
    '## Design',
    spec.design.trim() || '(architecture, module boundaries, sequence of the main flow)',
    '',
    '## Interfaces and contracts',
    spec.interfaces.trim() || '(APIs, events, schemas; mark frozen contracts)',
    '',
    '## Data model and migration impact',
    spec.dataModel.trim() || '(entities, storage contracts, expand/contract needs; "none" if no data impact)',
    '',
    '## Flagged concerns (route to policy owners)',
    ...(spec.flaggedConcerns.length ? spec.flaggedConcerns.map((c) => `- **${c.policy}**: ${c.concern}${c.owner ? ` (owner: ${c.owner})` : ''}`) : ['- (none)']),
    '',
    '## Non-goals',
    ...(spec.nonGoals.length ? spec.nonGoals.map((n) => `- ${n}`) : ['- (none)']),
    '',
    '## Acceptance',
    ...(spec.acceptance.length ? spec.acceptance.map((a, i) => `- ${i + 1}. ${a}`) : ['- 1. <fact that means done>. [R1]']),
    '',
  ].join('\n');
  return renderFrontMatter(fm, body);
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
