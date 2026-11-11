/**
 * Intake router (plan v5 §3 "Input, size and requirement mapping").
 *
 * Classifies a request into size (T0-bugfix / T0 / T1 / T2), kind, delivery target and the
 * modules to load. Explicit user decisions win but impact evidence that requires a different
 * route is reported. Scope is never inferred from prompt length or an id alone; a vague
 * "build a system" never authorises hosting or production.
 */
import { CARD_ID_REGEX, type DeliveryTarget, type GoalRequest, type Module, type RequestKind, type RequestSize, type RoutingResult } from './types.ts';

export interface RouterInput extends Partial<GoalRequest> {
  text: string;
  /** Known card ids in the registry; a bare number is ambiguous when it matches both a card and an issue. */
  knownCardIds?: string[];
  /** Known issue numbers for the resolved repository. */
  knownIssueNumbers?: number[];
  /** Changed or affected surfaces (paths), used for data-impact and risk escalation. */
  affectedSurfaces?: string[];
  /** Whether bug evidence (stack trace, failing test, reproduction) accompanies the request. */
  hasBugEvidence?: boolean;
}

const DATA_IMPACT = /\b(schema|migration|migrate|orm|sql|backfill|storage[- ]contract|database|db table|column|index|prisma|sqldelight|flyway|liquibase|alembic|knex)\b/i;
const HIGH_IMPACT = /\b(auth|authentication|authorization|password|token|session|permission|pii|payment|billing|encryption|secret|credential)\b/i;
const SYSTEM = /\b(new system|new service|new product|from scratch|greenfield|whole system|entire system|new platform|architecture|re-?architect|rewrite the|build (?:me )?(?:a|an) (?:full|complete|entire)|build (?:me )?(?:a|an) new (?:system|service|product|platform|app(?:lication)?|backend|api)|full system|fully ai[- ]native)\b/i;
const FEATURE = /\b(feature|module|epic|workflow|integrate|integration|dashboard|endpoint and ui|multi-?step|several (?:cards|tasks)|extend the|add support for)\b/i;
const BUG = /\b(bug|defect|regression|crash|stack ?trace|exception|fails? with|broken|error:|nullpointer|npe|typeerror|500 error|does not work|doesn't work|incorrect result)\b/i;
const CARD_TEXT_ONLY = /\b(card text|reword|rewrite the card|amend the card|update the card text|card description|acceptance list|only the card|text-only|wording)\b/i;
const RELEASE = /\b(deploy|release|publish|ship to (?:staging|production|prod)|staging|production|go live|rollout|package (?:it|the app|a build)|installer|runnable package|build artifact)\b/i;
// A target comes from a request to deliver, never from a word that names a place (card T0-INTAKE-TARGET-2, issue 222): a delivery
// verb tied by `to` to the target in one sentence, a build verb tied to what it builds, or a phrase that names the operation.
const DELIVER = /\b(?:deploy|release|ship|publish|promote|push|roll[- ]?out)\b/i;
const BUILD = /\b(?:build|produce|make|create|cut|generate|publish)\b/i;
const TO_PRODUCTION = /\bto (?:the )?production\b/i;
const TO_STAGING = /\b(?:to (?:the )?(?:staging|uat|preprod|pre-production|test environment)|for online testing)\b/i;
const PACKAGE_NOUN = /\b(?:runnable package|installer|build artifact|distributable|apk|msi|docker image)\b/i;
const GO_LIVE = /\b(?:go live|release to prod)\b/i;
const PACKAGE_IT = /\bpackage (?:it|the app|a build)\b/i;
// A sentence ends at a terminator, with any closing marks after it, before whitespace (a dot in `2.0` or `example.com` does
// not); at a full-width terminator, which takes no whitespace; at a blank line; or before a list item, a line that opens with
// marks or a short label. Any other line break is wrapping. The lookahead keeps the lookbehind to whitespace, so a long run of
// marks is read back once, not from each of its characters.
const SENTENCE_END = /(?=\s)(?<=[\p{Sentence_Terminal};\u2026][^\p{L}\p{N}\s]*)\s+|(?<=[\u3002\uff01\uff0e\uff1f\uff1b\uff61])|\n\s*\n|\n\s*(?:[^\p{L}\p{N}\s]+|\(?[\p{L}\p{N}]{1,3}[.)])\s/u;
const MIGRATION_OP = /\b(run the migration|apply the migration|migrate the (?:database|data)|backfill the|run (?:the |a )?data migration)\b/i;
const OPERATIONS = /\b(page on-?call|keep watching|ongoing operations|observe production|monitor (?:it|the|this|our|production|prod))\b/i;
const INCIDENT = /\b(alert|incident|outage|p1|p2|sev ?\d|5xx spike|error rate|latency spike|observed regression|prod(?:uction)? (?:is|error))\b/i;
const ISSUE_REF = /(?:^|\s)(?:#(\d+)|issue\s+#?(\d+)|([\w.-]+\/[\w.-]+)#(\d+))(?:\s|$)/i;
const BARE_NUMBER = /^\s*#?(\d{1,6})\s*$/;

/** A line break inside a sentence is wrapping, so a form is read with its whitespace collapsed. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** A verb and an object after it in one sentence. Finding the first verb and testing the rest keeps this linear in the text. */
function tied(sentences: string[], verb: RegExp, object: RegExp): boolean {
  return sentences.some((sentence) => {
    const found = verb.exec(sentence);
    return found !== null && object.test(sentence.slice(found.index + found[0].length));
  });
}

interface TargetReading {
  target: DeliveryTarget;
  explicit: boolean;
  reason?: string;
}

const NO_TARGET: TargetReading = { target: 'development', explicit: false };

function detectTarget(text: string): TargetReading {
  // A bug report that names a target describes a failure there; it asks for no delivery.
  if (BUG.test(flat(text))) return NO_TARGET;
  const sentences = text.split(SENTENCE_END).map(flat);
  const holds = (form: RegExp): boolean => sentences.some((sentence) => form.test(sentence));
  if (tied(sentences, DELIVER, TO_PRODUCTION) || holds(GO_LIVE)) return { target: 'production', explicit: true, reason: 'explicit production release request' };
  if (tied(sentences, DELIVER, TO_STAGING)) return { target: 'staging', explicit: true, reason: 'explicit online testing / staging request' };
  if (holds(PACKAGE_IT) || tied(sentences, BUILD, PACKAGE_NOUN)) return { target: 'package', explicit: true, reason: 'explicit package request' };
  if (holds(MIGRATION_OP)) return { target: 'migration', explicit: true, reason: 'explicit migration operation' };
  if (holds(OPERATIONS)) return { target: 'operations', explicit: true, reason: 'explicit ongoing operations request' };
  return NO_TARGET;
}

export function classifyRequest(input: RouterInput): RoutingResult {
  const text = input.text.trim();
  const reasons: string[] = [];
  const surfaces = input.affectedSurfaces ?? [];
  const surfaceText = surfaces.join(' ');
  let ambiguity: string | undefined;

  // --- resolve card / issue references -------------------------------------------------
  const cardMatch = text.match(CARD_ID_REGEX) ?? text.match(/\bT\d+-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/);
  // Every distinct registered card id the text names (T0-GOAL-CARD-COUNT): more than one leaves the count to the projection.
  // Without a known card list every card id token may be a card, so each one counts (T0-GOAL-CARD-COUNT-3).
  const known = input.knownCardIds;
  const tokens = [...new Set([...text.matchAll(/\bT\d+-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g)].map((m) => m[0]))];
  const namedCards = known ? tokens.filter((id) => known.includes(id)) : tokens;
  // The request's card is the first registered id in text order, never an unknown id that comes before it.
  const knownCard = known ? namedCards[0] : undefined;
  const bare = text.match(BARE_NUMBER);
  const issue = text.match(ISSUE_REF);
  let kind: RequestKind | undefined;
  let ref: string | undefined = input.ref;

  if (bare) {
    const n = Number(bare[1]);
    const isCard = (input.knownCardIds ?? []).some((id) => id.startsWith(`T${n}-`));
    const isIssue = (input.knownIssueNumbers ?? []).includes(n);
    if (isCard && isIssue) {
      ambiguity = `bare number ${n} matches both a card stage prefix and issue #${n}; ask which is meant`;
    } else if (isIssue) {
      kind = 'issue';
      ref = `#${n}`;
    } else if (isCard) {
      ambiguity = `bare number ${n} is a stage prefix, not a unique card id; ask for the full card id`;
    } else {
      ambiguity = `bare number ${n} does not uniquely identify a card or issue`;
    }
  }
  if (knownCard) {
    kind = CARD_TEXT_ONLY.test(text) ? 'card-amendment' : 'card-execute';
    ref = knownCard;
    reasons.push(`resolved card ${knownCard}`);
  } else if (cardMatch && !kind) {
    kind = CARD_TEXT_ONLY.test(text) ? 'card-amendment' : 'card-execute';
    ref = cardMatch[0];
    reasons.push(`card id ${cardMatch[0]} referenced (registry not consulted or id absent; verify before dispatch)`);
  }
  if (issue && !kind) {
    kind = 'issue';
    ref = issue[0].trim();
    reasons.push(`issue reference ${ref}; repository must be resolved before fetching`);
  }

  // --- kind ----------------------------------------------------------------------------
  const read = detectTarget(text);
  // A request that names a card or an issue says what to change and only `--target` says where it goes, and
  // `--target development` keeps a request to deliver out of the kind (card T0-INTAKE-TARGET-2).
  const textDecides = input.explicitTarget ? input.explicitTarget !== 'development' : input.ref === undefined;
  const targetInfo = textDecides ? read : NO_TARGET;
  if (!kind) {
    if (input.source === 'incident' || INCIDENT.test(text)) kind = 'incident';
    else if (targetInfo.explicit && targetInfo.target === 'migration') kind = 'migration';
    else if (targetInfo.explicit && RELEASE.test(flat(text)) && !SYSTEM.test(text) && !FEATURE.test(text)) kind = 'release';
    else if (input.hasBugEvidence || input.source === 'bug-evidence' || BUG.test(flat(text))) kind = 'bugfix';
    else if (SYSTEM.test(text)) kind = 'system';
    else if (FEATURE.test(text)) kind = 'feature';
    else kind = 'change';
  }
  reasons.push(`kind=${kind}`);

  // --- size ----------------------------------------------------------------------------
  let size: RequestSize;
  let sizeSource: 'explicit' | 'inferred' = 'inferred';
  let impactEscalation: string | undefined;
  const dataImpact = DATA_IMPACT.test(text) || DATA_IMPACT.test(surfaceText) || /migrations?\//i.test(surfaceText);
  const highImpact = HIGH_IMPACT.test(text) || HIGH_IMPACT.test(surfaceText);

  const inferred = ((): RequestSize => {
    switch (kind) {
      case 'system':
        return 'T2';
      case 'feature':
        return 'T1';
      case 'bugfix':
        return highImpact || dataImpact ? 'T1' : 'T0-bugfix';
      case 'incident':
        return highImpact || dataImpact ? 'T1' : 'T0-bugfix';
      case 'card-execute':
      case 'card-amendment':
      case 'change':
      case 'issue':
      case 'release':
      case 'migration':
        return highImpact && kind !== 'card-amendment' ? 'T1' : 'T0';
      default:
        return 'T0';
    }
  })();

  if (input.explicitSize) {
    size = input.explicitSize;
    sizeSource = 'explicit';
    reasons.push(`explicit size ${size} preserved`);
    if ((highImpact || dataImpact) && (size === 'T0' || size === 'T0-bugfix') && kind !== 'card-amendment') {
      impactEscalation = `impact evidence (${highImpact ? 'auth/sensitive data' : 'data contract'}) suggests ${inferred}; explicit ${size} kept but reported`;
    }
  } else {
    size = inferred;
    if ((highImpact || dataImpact) && (kind === 'bugfix' || kind === 'incident' || kind === 'change')) {
      impactEscalation = `short ${kind} touches ${highImpact ? 'auth/sensitive data' : 'data contracts'}; routed as ${size} rather than T0`;
    }
  }
  reasons.push(`size=${size} (${sizeSource})`);

  // --- target -------------------------------------------------------------------------
  let target: DeliveryTarget = targetInfo.target;
  let targetSource: 'explicit' | 'default' = targetInfo.explicit ? 'explicit' : 'default';
  if (input.explicitTarget) {
    target = input.explicitTarget;
    targetSource = 'explicit';
  }
  if (targetInfo.reason) reasons.push(targetInfo.reason);
  else if (read.explicit) reasons.push(`the text reads as target ${read.target}; only --target sets the target of this request`);
  if (target === 'development') reasons.push('target=development (default; hosting/deploy not authorised by this request)');

  // --- modules -------------------------------------------------------------------------
  const modules: Module[] = ['router'];
  let cardCount: number | 'unknown';
  if (namedCards.length > 1) {
    cardCount = 'unknown';
    modules.push('arc', 'card-loop');
    reasons.push(`named cards: ${namedCards.join(', ')} (${known ? '' : 'registry not consulted; '}count left to the projection)`);
  } else if (kind === 'card-amendment') {
    cardCount = 1;
    modules.push('card-loop');
  } else if (kind === 'release' || kind === 'migration') {
    cardCount = 0;
  } else if (size === 'T0' || size === 'T0-bugfix') {
    cardCount = 1;
    modules.push('card-loop');
  } else if (size === 'T1') {
    cardCount = 'unknown';
    modules.push('arc', 'card-loop');
  } else {
    cardCount = 'unknown';
    modules.push('arc', 'card-loop');
  }
  if (target !== 'development' && target !== 'operations') modules.push('release');
  if (dataImpact || target === 'migration') modules.push('migrate');
  const nextModule: Module = modules.includes('arc') ? 'arc' : modules.includes('card-loop') ? 'card-loop' : modules.includes('release') ? 'release' : 'router';

  // --- companion skills (names the directives carry; the loop's gates still decide) ------
  const skills: string[] = [];
  const releaseOnly = kind === 'release' || kind === 'migration';
  if (!releaseOnly && (size === 'T0-bugfix' || kind === 'bugfix' || kind === 'incident')) skills.push('diagnose');
  if ((size === 'T1' || size === 'T2') && !releaseOnly) skills.push('grilling');
  if (modules.includes('card-loop')) skills.push('tdd');

  return {
    size,
    sizeSource,
    kind,
    target,
    targetSource,
    cardCount,
    modules: [...new Set(modules)],
    nextModule,
    skills,
    dataImpact,
    impactEscalation,
    ambiguity,
    reasons: ref ? [`ref=${ref}`, ...reasons] : reasons,
  };
}

/** Concise routing line printed at intake. */
export function formatRouting(r: RoutingResult): string {
  const count = r.cardCount === 'unknown' ? 'unknown' : String(r.cardCount);
  const parts = [`size=${r.size}`, `kind=${r.kind}`, `target=${r.target}`, `cards=${count}`, `modules=${r.modules.join('+')}`, `next=${r.nextModule}`, `skills=${r.skills.length ? r.skills.join('+') : 'none'}`];
  if (r.dataImpact) parts.push('data-impact=yes');
  if (r.impactEscalation) parts.push(`escalation="${r.impactEscalation}"`);
  if (r.ambiguity) parts.push(`ASK="${r.ambiguity}"`);
  return `[route] ${parts.join(' ')}`;
}
