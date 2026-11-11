/**
 * Task cards: the machine-checkable projection of the accepted plan (scaffold specs/README).
 *
 * Parsing follows the scaffold's `_cards.ps1` rules; validation reproduces the blocking
 * sentinels that matter for the loop: id == filename, status enum, dod_command present and
 * not a no-op, allow_paths as a block list with >5 requiring `sweep`, tier value, placeholder
 * tokens, dangling `[R<n>]` citations, resolvable `depends_on`, and `acceptance` required
 * once `review_gate` is declared. Ids are immutable once a file exists.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { Card, CARD_ID_REGEX, type ProjectTier } from '../core/types.ts';
import { blockList, flowItems, hasKey, referenceCuts, renderFrontMatter, scalar, scalarRange, splitFrontMatter, stripComment } from './frontmatter.ts';

export interface CardFinding {
  sentinel: string;
  severity: 'block' | 'warn';
  message: string;
}

export interface ParsedCard {
  card: Card;
  file?: string;
  findings: CardFinding[];
  body: string;
}

/**
 * The largest budget a card that changes `src/` may declare without a `size_exception` (card T0-CARD-SIZE). On the
 * records of 2026-11-10, such cards stopped on R3 review in 10 to 15 percent of runs at or below it and 44 to 60 above.
 */
export const MAX_CODE_CARD_BUDGET = 250;

/**
 * The `size_exception` value of its own line, decoded as a YAML scalar, so a comment, an empty block scalar or an escaped
 * blank is no reason (R3 decision 1, F1). A value that does not parse alone, or is not a scalar node holding a string, is
 * none; the node is read without conversion, so an alias or a collection never throws (R3 decision 2, F2). The whole front
 * matter is not parsed, because many cards are not valid YAML as a document.
 */
function sizeExceptionOf(fm: string): string | undefined {
  const raw = scalar(fm, 'size_exception');
  if (raw === undefined) return undefined;
  const doc = YAML.parseDocument(raw, { logLevel: 'silent' });
  if (doc.errors.length > 0 || !YAML.isScalar(doc.contents)) return undefined;
  return typeof doc.contents.value === 'string' ? doc.contents.value : undefined;
}

export const CARD_RULES = {
  id: CARD_ID_REGEX,
  tokenLiteral: /\{\{[A-Z_]+\}\}/,
  placeholder: /path\/to\/|^(?:[^:\r\n]+:|[ \t]*-)[ \t]*<[^>\r\n]+>[ \t]*$/im,
  refDangling: /\bT\d+-(?!T\d+\b)[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g,
  reqCitation: /\[R(\d+)\]/g,
  requirementItem: /^R(\d+)\.\s*(.+)$/,
  noopDod: /^(echo|true|exit\s+0|rem|write-host)\b|^:(\s|$)/i,
  blockScalar: /^[|>][+\-]?[0-9]*\s*(#.*)?$/,
  fmGarbage: /^[^#\s:][^:]*$/,
};

function parseList(fm: string, key: string): string[] | undefined {
  const block = blockList(fm, key);
  if (block === undefined) return undefined;
  if (block.length > 0) return block;
  // Key present with no block items: accept the inline flow form `key: [a, b]` (documented by the template).
  const inline = scalar(fm, key);
  if (inline && inline.startsWith('[')) return parseInlineList(inline);
  return block;
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  if (/^(true|yes)$/i.test(v)) return true;
  if (/^(false|no)$/i.test(v)) return false;
  return undefined;
}

export interface CardParseOptions {
  /** true (default) = upstream scaffold contract where missing acceptance/sweep BLOCK; false = downstream advisory contract. */
  strict?: boolean;
}

export function parseCardText(text: string, file?: string, options: CardParseOptions = {}): ParsedCard | { error: string; findings: CardFinding[] } {
  const strict = options.strict ?? true;
  const advisory: CardFinding['severity'] = strict ? 'block' : 'warn';
  const doc = splitFrontMatter(text);
  const findings: CardFinding[] = [];
  if (!doc) return { error: 'no front matter', findings: [{ sentinel: '[CARD-FM-MISSING]', severity: 'block', message: 'card has no front matter' }] };
  const fm = doc.frontMatter;
  for (const line of fm.split(/\r?\n/)) {
    if (CARD_RULES.fmGarbage.test(line)) findings.push({ sentinel: '[CARD-FM-GARBAGE]', severity: 'block', message: `front-matter line without a colon: "${line}"` });
  }
  const id = scalar(fm, 'id');
  const title = scalar(fm, 'title');
  const status = scalar(fm, 'status');
  const branch = scalar(fm, 'branch') ?? id;
  const worktree = scalar(fm, 'worktree') ?? (id ? `<WorktreeRoot>/${id}` : undefined);
  const allow = parseList(fm, 'allow_paths');
  const dod = scalar(fm, 'dod_command');
  const dodExit = scalar(fm, 'dod_exit');
  const budget = scalar(fm, 'budget');
  const tier = scalar(fm, 'tier');
  const rawCard = {
    id,
    title: title || (id ? `(untitled ${id})` : undefined),
    status,
    branch,
    worktree,
    allow_paths: allow,
    dod_command: dod,
    dod_exit: dodExit !== undefined ? Number(dodExit) : 0,
    review_gate: scalar(fm, 'review_gate') || undefined,
    acceptance: parseList(fm, 'acceptance') ?? [],
    requirements: parseList(fm, 'requirements'),
    depends_on: parseList(fm, 'depends_on') ?? parseInlineList(scalar(fm, 'depends_on')),
    parallelizable_with: parseList(fm, 'parallelizable_with') ?? parseInlineList(scalar(fm, 'parallelizable_with')),
    plan_ref: scalar(fm, 'plan_ref') || undefined,
    budget: budget ? Number(budget) : undefined,
    tier: tier || undefined,
    sweep: scalar(fm, 'sweep') || undefined,
    forbid: parseList(fm, 'forbid') ?? parseInlineList(scalar(fm, 'forbid')),
    non_goals: parseList(fm, 'non_goals') ?? parseInlineList(scalar(fm, 'non_goals')),
    dod_assert: scalar(fm, 'dod_assert') || undefined,
    hygiene: scalar(fm, 'hygiene') || undefined,
    doc_sync: scalar(fm, 'doc_sync') || undefined,
    superseded_by: scalar(fm, 'superseded_by') || undefined,
    size_exception: sizeExceptionOf(fm),
    tdd: parseBool(scalar(fm, 'tdd')) ?? true,
    freeze: parseBool(scalar(fm, 'freeze')) ?? false,
    migration_phase: scalar(fm, 'migration_phase') || undefined,
    resources: parseList(fm, 'resources') ?? [],
  };
  if (rawCard.forbid && rawCard.forbid.length === 0) rawCard.forbid = undefined;
  if (rawCard.non_goals && rawCard.non_goals.length === 0) rawCard.non_goals = undefined;
  if (rawCard.tier && !['S', '1', '0'].includes(rawCard.tier)) {
    findings.push({ sentinel: '[CARD-TIER-BADVALUE]', severity: 'block', message: `tier "${rawCard.tier}" is not S, 1 or 0` });
    rawCard.tier = undefined;
  }
  const diagnosis = hasKey(fm, 'diagnosis') ? { root_cause: scalar(fm, '  root_cause') ?? extractNested(fm, 'diagnosis', 'root_cause') ?? '', same_class: extractNested(fm, 'diagnosis', 'same_class') } : undefined;
  const parsed = Card.safeParse({ ...rawCard, diagnosis: diagnosis && diagnosis.root_cause ? diagnosis : undefined });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) findings.push({ sentinel: '[CARD-SCHEMA]', severity: 'block', message: `${issue.path.join('.')}: ${issue.message}` });
    return { error: 'card schema violation', findings };
  }
  const card = parsed.data;
  // A value a comment cuts at a reference-like hash reaches every reader shortened (card T0-FM-COMMENT-CUT): blocking on a
  // card still to run, a warning on a merged or superseded one.
  const active = card.status !== 'merged' && !card.superseded_by;
  for (const cut of referenceCuts(fm)) {
    findings.push({ sentinel: '[CARD-FM-COMMENT-CUT]', severity: active ? 'block' : 'warn', message: `${cut.key}: the comment "${cut.comment}" cuts "${cut.raw}" to "${cut.kept}"; write the number without the hash sign, or quote the value` });
  }
  // --- scaffold rule set ---------------------------------------------------------------
  if (file && path.basename(file, '.md') !== card.id) findings.push({ sentinel: '[CARD-ID-FILENAME]', severity: 'block', message: `id ${card.id} != file name ${path.basename(file, '.md')}` });
  if (card.branch !== card.id) findings.push({ sentinel: '[CARD-BRANCH-DRIFT]', severity: 'block', message: `branch ${card.branch} must equal id ${card.id}` });
  if (path.basename(card.worktree.replace(/\\/g, '/')) !== card.id) findings.push({ sentinel: '[CARD-WORKTREE-DRIFT]', severity: 'block', message: `worktree leaf must equal id ${card.id}` });
  if (CARD_RULES.blockScalar.test(card.dod_command)) findings.push({ sentinel: '[CARD-DOD-BLOCK-SCALAR]', severity: 'block', message: 'dod_command is a bare block-scalar indicator' });
  if (CARD_RULES.noopDod.test(card.dod_command)) findings.push({ sentinel: '[CARD-DOD-NOOP]', severity: 'block', message: 'dod_command is a no-op' });
  if (/pwsh\s+-Command[^\n]*\$[A-Za-z_]/.test(card.dod_command)) findings.push({ sentinel: '[CARD-DOD-NESTED-VAR]', severity: 'block', message: 'no `$variable` inside a nested pwsh -Command payload (L95)' });
  const changesSrc = card.allow_paths.some((p) => p.replace(/\\/g, '/').replace(/^\.\//, '').startsWith('src/'));
  if (changesSrc && card.budget !== undefined && card.budget > MAX_CODE_CARD_BUDGET) {
    findings.push({ sentinel: '[CARD-SIZE]', severity: active && !card.size_exception?.trim() ? 'block' : 'warn', message: `budget ${card.budget} is over ${MAX_CODE_CARD_BUDGET} on a card that changes src/: split the card, or record who approved it and why as size_exception` });
  }
  if (card.allow_paths.length > 5 && !card.sweep) findings.push({ sentinel: '[CARD-SWEEP]', severity: advisory, message: `allow_paths has ${card.allow_paths.length} entries (>5) but no sweep` });
  if (CARD_RULES.tokenLiteral.test(text)) findings.push({ sentinel: '[CARD-TOKEN-LITERAL]', severity: 'block', message: 'template token literal {{...}} left in card' });
  if (CARD_RULES.placeholder.test(fm)) findings.push({ sentinel: '[CARD-PLACEHOLDER]', severity: 'warn', message: 'placeholder text (path/to/ or <...>) left in front matter' });
  if (card.review_gate && card.acceptance.length === 0) findings.push({ sentinel: '[CARD-ACCEPTANCE]', severity: advisory, message: 'review_gate declared without a non-empty acceptance list' });
  // requirements / citations
  const reqIds = new Set<string>();
  for (const r of card.requirements ?? []) {
    const m = r.match(CARD_RULES.requirementItem);
    if (m && m[2]?.trim()) reqIds.add(m[1]!);
  }
  for (const acc of card.acceptance) {
    for (const m of acc.matchAll(CARD_RULES.reqCitation)) {
      if (!reqIds.has(m[1]!)) findings.push({ sentinel: '[CARD-REQ-DANGLING]', severity: 'block', message: `acceptance cites [R${m[1]}] but no such requirement is declared` });
    }
    if (/^\s*\d+\.\s*(verify|test|confirm|check|ensure)\b/i.test(acc)) findings.push({ sentinel: '[CARD-ACC-VERB]', severity: 'warn', message: `acceptance item is an instruction, not a fact: "${acc.slice(0, 60)}"` });
  }
  for (const r of card.requirements ?? []) {
    if (!/\bshall\b/.test(r)) findings.push({ sentinel: '[CARD-REQ-EARS]', severity: 'warn', message: `requirement lacks a single "shall": "${r.slice(0, 60)}"` });
  }
  return { card, file, findings, body: doc.body };
}

function parseInlineList(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const items = flowItems(v);
  if (!items) return v ? [v] : [];
  // A quoted item loses its pair of outer quotes (escapes stay as written); a plain item is read as written.
  return items.map((s) => s.match(/^(["'])(.*)\1$/)?.[2] ?? s).filter((s) => s.length > 0);
}

function extractNested(fm: string, parent: string, child: string): string | undefined {
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^${parent}[ \\t]*:`).test(l));
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/^\s+/.test(line)) break;
    const m = line.match(new RegExp(`^\\s+${child}[ \\t]*:[ \\t]*(.*)$`));
    if (m) return stripComment(m[1] ?? '').split('·')[0]?.trim();
  }
  return undefined;
}

export interface CardRegistry {
  dir: string;
  archiveDir?: string;
  cards: ParsedCard[];
  errors: Array<{ file: string; error: string; findings: CardFinding[] }>;
}

/** The card text with the value of its front-matter `status` set; every other byte stays. */
export function withCardStatus(text: string, status: Card['status']): string {
  const doc = splitFrontMatter(text);
  const head = doc ? text.slice(0, text.length - doc.body.length) : '';
  const value = scalarRange(head, 'status');
  if (!doc || !value || value.start === value.end) throw new Error('the card has no status in its front matter');
  return `${head.slice(0, value.start)}${status}${head.slice(value.end)}${doc.body}`;
}

export function loadCardRegistry(dir: string, archiveDir?: string, options: CardParseOptions = {}): CardRegistry {
  const cards: ParsedCard[] = [];
  const errors: CardRegistry['errors'] = [];
  const read = (d: string, archived: boolean) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      if (!name.endsWith('.md') || name.startsWith('_')) continue;
      const file = path.join(d, name);
      const result = parseCardText(readFileSync(file, 'utf8'), file, options);
      if ('error' in result) {
        if (!archived) errors.push({ file, error: result.error, findings: result.findings });
        continue;
      }
      if (archived) result.findings = [];
      cards.push(result);
    }
  };
  read(dir, false);
  if (archiveDir) read(archiveDir, true);
  return { dir, archiveDir, cards, errors };
}

/** Cross-card checks: dangling references, duplicate ids, parallel overlap. */
export function validateRegistry(registry: CardRegistry, tierPaths: { tierS?: string[]; tier0?: string[]; frozen?: string[] } = {}): Map<string, CardFinding[]> {
  const out = new Map<string, CardFinding[]>();
  const ids = new Set(registry.cards.map((c) => c.card.id));
  for (const parsed of registry.cards) {
    const findings = [...parsed.findings];
    const isArchived = registry.archiveDir !== undefined && parsed.file?.startsWith(registry.archiveDir);
    if (!isArchived) {
      // One id, one card: a second file with the id (a copy left in the archive or beside the card) makes every lookup by id ambiguous.
      const twins = registry.cards.filter((other) => other !== parsed && other.card.id === parsed.card.id);
      if (twins.length) findings.push({ sentinel: '[CARD-ID-DUPLICATE]', severity: 'block', message: `id ${parsed.card.id} is also the id of ${twins.map((t) => t.file ?? 'another card').join(', ')}` });
      for (const dep of parsed.card.depends_on) if (!ids.has(dep)) findings.push({ sentinel: '[CARD-REF-DANGLING]', severity: 'block', message: `depends_on ${dep} does not resolve` });
      for (const p of parsed.card.parallelizable_with) if (!ids.has(p)) findings.push({ sentinel: '[CARD-REF-DANGLING]', severity: 'block', message: `parallelizable_with ${p} does not resolve` });
      const computed = computeTier(parsed.card.allow_paths, tierPaths);
      if (parsed.card.tier && rank(parsed.card.tier) < rank(computed)) findings.push({ sentinel: '[CARD-TIER-LOWER]', severity: 'block', message: `declared tier ${parsed.card.tier} is below computed ${computed}` });
      findings.push({ sentinel: '[CARD-TIER]', severity: 'warn', message: `id=${parsed.card.id} tier=${parsed.card.tier ?? computed} reason=${parsed.card.tier ? 'declared' : 'computed from allow_paths'}` });
      for (const other of registry.cards) {
        if (other === parsed) continue;
        if (parsed.card.parallelizable_with.includes(other.card.id)) {
          const overlap = parsed.card.allow_paths.some((a) => other.card.allow_paths.some((b) => a === b || a.startsWith(b) || b.startsWith(a)));
          if (overlap) findings.push({ sentinel: '[CARD-PARALLEL-OVERLAP]', severity: 'block', message: `parallelizable_with ${other.card.id} but allow_paths overlap` });
        }
      }
    }
    // Findings are keyed by id, so two cards with one id share an entry: each adds to it and neither replaces the other's.
    out.set(parsed.card.id, [...(out.get(parsed.card.id) ?? []), ...findings]);
  }
  return out;
}

function rank(t: ProjectTier): number {
  return t === 'S' ? 2 : t === '1' ? 1 : 0;
}

/** Tier is computed, never chosen: any Tier-S path => S; every entry Tier-0 => 0; else 1. Empty TierS list => every card is S. */
export function computeTier(allowPaths: string[], tierPaths: { tierS?: string[]; tier0?: string[]; frozen?: string[] }): ProjectTier {
  const tierS = tierPaths.tierS ?? [];
  if (tierS.length === 0) return 'S';
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const matchesS = (p: string) => tierS.some((s) => norm(p).startsWith(norm(s)) || norm(s).startsWith(norm(p))) || (tierPaths.frozen ?? []).some((f) => safeRegex(f).test(norm(p)));
  if (allowPaths.some(matchesS)) return 'S';
  const tier0 = tierPaths.tier0 ?? [];
  const matches0 = (p: string) => tier0.some((z) => (z.startsWith('*.') ? norm(p).endsWith(z.slice(1).toLowerCase()) : norm(p).startsWith(norm(z))));
  if (tier0.length && allowPaths.every(matches0)) return '0';
  return '1';
}

function safeRegex(fragment: string): RegExp {
  try {
    return new RegExp(fragment, 'i');
  } catch {
    return /.^/; // unknown fragment resolves to S at the call site by never matching here; caller treats empty as S
  }
}

export interface NewCardInput {
  id: string;
  title: string;
  allowPaths: string[];
  dodCommand: string;
  acceptance: string[];
  requirements?: string[];
  dependsOn?: string[];
  planRef?: string;
  budget?: number;
  worktreeRoot?: string;
  reviewGate?: string;
  nonGoals?: string[];
  diagnosis?: { root_cause: string; same_class?: string };
  tdd?: boolean;
  freeze?: boolean;
  migrationPhase?: Card['migration_phase'];
  resources?: string[];
  deliverable: string;
  dodAssert?: string;
}

export function renderCard(input: NewCardInput): string {
  if (!CARD_ID_REGEX.test(input.id)) throw new Error(`invalid card id ${input.id}`);
  const data: Record<string, unknown> = {
    id: input.id,
    title: input.title,
    status: 'todo',
    branch: input.id,
    worktree: `${input.worktreeRoot ?? 'C:\\wt'}\\${input.id}`,
    allow_paths: input.allowPaths,
    dod_command: input.dodCommand,
    dod_exit: 0,
  };
  if (input.reviewGate) data['review_gate'] = input.reviewGate;
  data['acceptance'] = input.acceptance;
  if (input.requirements?.length) data['requirements'] = input.requirements;
  if (input.dependsOn?.length) data['depends_on'] = input.dependsOn;
  if (input.planRef) data['plan_ref'] = input.planRef;
  data['budget'] = input.budget ?? MAX_CODE_CARD_BUDGET;
  if (input.nonGoals?.length) data['non_goals'] = input.nonGoals;
  if (input.diagnosis) data['diagnosis'] = input.diagnosis;
  if (input.dodAssert) data['dod_assert'] = input.dodAssert;
  if (input.tdd === false) data['tdd'] = false;
  if (input.freeze) data['freeze'] = true;
  if (input.migrationPhase) data['migration_phase'] = input.migrationPhase;
  if (input.resources?.length) data['resources'] = input.resources;
  const body = `\n# ${input.id}\n\n## Deliverable\n${input.deliverable}\n\n## Acceptance (DoD = command + exit code + assertion; paired with the closed \`acceptance:\` list)\n\`\`\`powershell\n${input.dodCommand}\n\`\`\`\n- Expected exit code: 0\n- Assertion: ${input.dodAssert ?? 'the command exits 0 and its assertions hold'}\n`;
  return renderFrontMatter(data, body);
}
