/**
 * Stage 1 artifact: intent.md (Anthropic AI-native SDLC playbook).
 *
 * "Ideas enter as version-controlled intent." Sections: Problem, Proposed outcome, Affected
 * users and systems, Constraints, Open questions. The product owner merges or closes.
 * Findings from Stage 6 (Maintain) re-enter the loop as intent.md too.
 */
import { renderFrontMatter, splitFrontMatter } from './frontmatter.ts';

export interface Intent {
  slug: string;
  title: string;
  author: string;
  status: 'draft' | 'review' | 'accepted' | 'closed';
  createdAt: string;
  source?: 'human' | 'incident' | 'security-scan' | 'on-call';
  problem: string;
  proposedOutcome: string;
  affected: string;
  constraints: string;
  openQuestions: string[];
  /** Linkage to a legacy tracker record (playbook sidebar: "Linkage as minimum"). */
  trackerRef?: string;
  evidence?: string[];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'intent';
}

export function renderIntent(intent: Intent): string {
  const fm: Record<string, unknown> = {
    slug: intent.slug,
    title: intent.title,
    author: intent.author,
    status: intent.status,
    created: intent.createdAt,
    source: intent.source ?? 'human',
  };
  if (intent.trackerRef) fm['tracker_ref'] = intent.trackerRef;
  const body = [
    `# Intent: ${intent.title}`,
    `Author: ${intent.author}. Status: ${intent.status}.`,
    '',
    '## Problem',
    intent.problem.trim() || '(state the problem in plain language)',
    '',
    '## Proposed outcome',
    intent.proposedOutcome.trim() || '(what changes for users when this is done)',
    '',
    '## Affected users and systems',
    intent.affected.trim() || '(who and what is touched)',
    '',
    '## Constraints',
    intent.constraints.trim() || '(hard constraints: data, auth, compatibility, deadlines)',
    '',
    '## Open questions',
    ...(intent.openQuestions.length ? intent.openQuestions.map((q) => `- ${q}`) : ['- (none)']),
    ...(intent.evidence?.length ? ['', '## Evidence', ...intent.evidence.map((e) => `- ${e}`)] : []),
    '',
  ].join('\n');
  return renderFrontMatter(fm, body);
}

const REQUIRED_SECTIONS = ['Problem', 'Proposed outcome', 'Affected users and systems', 'Constraints', 'Open questions'];

export interface IntentValidation {
  ok: boolean;
  problems: string[];
  intent?: Partial<Intent>;
}

export function parseIntent(text: string): IntentValidation {
  const doc = splitFrontMatter(text);
  const problems: string[] = [];
  if (!doc) return { ok: false, problems: ['missing front matter'] };
  if (doc.yamlError) problems.push(`front matter: ${doc.yamlError}`);
  const fm = doc.yaml ?? {};
  const sections = sectionMap(doc.body);
  for (const s of REQUIRED_SECTIONS) {
    const content = sections.get(s.toLowerCase());
    if (content === undefined) problems.push(`missing section "## ${s}"`);
    else if (!content.trim() || /^\((state|what|who|hard)/.test(content.trim())) problems.push(`section "## ${s}" is empty or still a placeholder`);
  }
  if (!fm['title']) problems.push('front matter needs title');
  if (!fm['status'] || !['draft', 'review', 'accepted', 'closed'].includes(String(fm['status']))) problems.push('status must be draft|review|accepted|closed');
  const questions = (sections.get('open questions') ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter((l) => l && l !== '(none)');
  return {
    ok: problems.length === 0,
    problems,
    intent: {
      slug: typeof fm['slug'] === 'string' ? fm['slug'] : undefined,
      title: typeof fm['title'] === 'string' ? fm['title'] : undefined,
      author: typeof fm['author'] === 'string' ? fm['author'] : undefined,
      status: fm['status'] as Intent['status'],
      problem: sections.get('problem') ?? '',
      proposedOutcome: sections.get('proposed outcome') ?? '',
      affected: sections.get('affected users and systems') ?? '',
      constraints: sections.get('constraints') ?? '',
      openQuestions: questions,
      trackerRef: typeof fm['tracker_ref'] === 'string' ? fm['tracker_ref'] : undefined,
    },
  };
}

export function sectionMap(body: string): Map<string, string> {
  const map = new Map<string, string>();
  let current: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    if (current !== undefined) map.set(current, buf.join('\n').trim());
  };
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      current = m[1]!.toLowerCase();
      buf = [];
    } else if (current !== undefined) {
      buf.push(line);
    }
  }
  flush();
  return map;
}
