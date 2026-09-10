/**
 * Stage 2 artifact: spec.md — requirements and design written once with organisational
 * skills applied (brand, security, UX, compliance). Requirements use the scaffold's EARS
 * five patterns and are cited by acceptance items with `[R<n>]`.
 */
import { renderFrontMatter, splitFrontMatter } from './frontmatter.ts';
import { sectionMap } from './intent.ts';

export interface Spec {
  slug: string;
  title: string;
  intentRef: string;
  status: 'draft' | 'review' | 'accepted';
  createdAt: string;
  skillsApplied: string[];
  requirements: string[]; // EARS lines, "R1. The <system> shall ..."
  design: string;
  interfaces: string;
  dataModel: string;
  flaggedConcerns: Array<{ policy: string; concern: string; owner?: string }>;
  nonGoals: string[];
  acceptance: string[]; // Given/When/Then or fact lines citing [R<n>]
}

const EARS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'Ubiquitous', re: /^R\d+\.\s+The\s+.+?\s+shall\s+.+\.$/ },
  { name: 'Event-Driven', re: /^R\d+\.\s+WHEN\s+.+?,\s*the\s+.+?\s+shall\s+.+\.$/ },
  { name: 'State-Driven', re: /^R\d+\.\s+WHILE\s+.+?,\s*the\s+.+?\s+shall\s+.+\.$/ },
  { name: 'Unwanted', re: /^R\d+\.\s+IF\s+.+?,\s*THEN\s+the\s+.+?\s+shall\s+.+\.$/ },
  { name: 'Optional', re: /^R\d+\.\s+WHERE\s+.+?,\s*the\s+.+?\s+shall\s+.+\.$/ },
];

const BANNED_WORDS = /\b(should|could|might|appropriately|quickly|robust|seamless|world-class|user-friendly|easy|fast|as needed|etc\.?)\b/i;

export function classifyEars(line: string): { pattern?: string; problems: string[] } {
  const problems: string[] = [];
  const shallCount = (line.match(/\bshall\b/g) ?? []).length;
  if (shallCount !== 1) problems.push(`expected exactly one "shall", found ${shallCount}`);
  if (BANNED_WORDS.test(line)) problems.push(`vague wording: ${line.match(BANNED_WORDS)?.[0]}`);
  const pattern = EARS_PATTERNS.find((p) => p.re.test(line.trim()))?.name;
  if (!pattern) problems.push('does not match an EARS pattern (Ubiquitous / WHEN / WHILE / IF…THEN / WHERE)');
  if (/\[TBD:[^\]]*\]/.test(line) === false && /\b\d+\s*(ms|s|seconds|minutes|%|rps|qps)\b/.test(line) && /\[SOURCE:/.test(line) === false) {
    problems.push('numeric limit without [SOURCE:…] evidence or [TBD: closed question]');
  }
  return { pattern, problems };
}

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

export interface SpecValidation {
  ok: boolean;
  problems: string[];
  requirements: Array<{ id: string; line: string; pattern?: string; problems: string[] }>;
}

export function parseSpec(text: string): SpecValidation {
  const doc = splitFrontMatter(text);
  const problems: string[] = [];
  if (!doc) return { ok: false, problems: ['missing front matter'], requirements: [] };
  const sections = sectionMap(doc.body);
  for (const s of ['requirements (ears)', 'design', 'acceptance']) if (!sections.has(s)) problems.push(`missing section "## ${s}"`);
  const reqLines = (sections.get('requirements (ears)') ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter((l) => /^R\d+\./.test(l));
  const requirements = reqLines.map((line) => {
    const id = line.match(/^(R\d+)\./)![1]!;
    const c = classifyEars(line);
    return { id, line, pattern: c.pattern, problems: c.problems };
  });
  if (requirements.length === 0) problems.push('no EARS requirements (R<n>. ... shall ...)');
  const ids = new Set(requirements.map((r) => r.id));
  const acc = (sections.get('acceptance') ?? '').split('\n').filter((l) => l.trim());
  for (const a of acc) {
    for (const m of a.matchAll(/\[(R\d+)\]/g)) if (!ids.has(m[1]!)) problems.push(`acceptance cites ${m[1]} which is not declared`);
  }
  if (acc.length === 0) problems.push('no acceptance items');
  if (/\b(TBD|TODO|FIXME|XXX)\b(?!:)/.test(doc.body)) problems.push('unresolved TBD/TODO marker without a closed question');
  if (/<(?:system|observable response|fact that means done|trigger|state|condition|feature)>/i.test(doc.body)) problems.push('template placeholders (<system>, <observable response>, <fact that means done>) still present');
  for (const r of requirements) for (const p of r.problems) problems.push(`${r.id}: ${p}`);
  return { ok: problems.length === 0, problems, requirements };
}
