/**
 * Hash-chained, append-only journal (LC12 / plan §5 "Evidence and probes").
 *
 * Every event carries the previous event's hash and its own hash over the canonical JSON of
 * the event without `hash`. `verifyJournal` recomputes the chain and reports the first break,
 * a sequence gap, or a malformed line. The journal records runtime facts; the accepted plan
 * and cards remain the requirement authority.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { ActorIdentity, JournalEvent, JournalEventType, nowIso } from '../core/types.ts';
import { canonicalJson } from './store.ts';
import { hostName, resolveStatePaths } from './paths.ts';

export const GENESIS_HASH = '0'.repeat(64);

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

let cachedActor: ActorIdentity | undefined;

/**
 * Session identity precedence (MS1): `AIDLC_SESSION` (one value per window/session, the explicit
 * override) > the Claude Code session (`CLAUDE_CODE_SESSION_ID`, which Claude Code exports to every
 * Bash and PowerShell subprocess; the older `CLAUDE_SESSION_ID` is still read) > the repository's
 * default session token. The default token is created once under the state directory and shared by
 * every process that does not set a session, which is the plan's interim single-controller mode;
 * `aidlc doctor` warns about it. A hook process acts as the `session_id` of the hook event instead
 * (`hooks/index.ts`, `hookSession`): that is the same Claude Code session.
 */
export function resolveSessionId(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): { session: string; source: 'env' | 'claude' | 'default' } {
  if (env['AIDLC_SESSION']) return { session: env['AIDLC_SESSION'], source: 'env' };
  const claude = env['CLAUDE_CODE_SESSION_ID'] || env['CLAUDE_SESSION_ID'];
  if (claude) return { session: claude, source: 'claude' };
  try {
    const root = resolveStatePaths(cwd, env).root;
    const file = path.join(root, 'session-default');
    if (existsSync(file)) {
      const id = readFileSync(file, 'utf8').trim();
      if (id) return { session: id, source: 'default' };
    }
    mkdirSync(root, { recursive: true });
    const id = `default-${randomBytes(4).toString('hex')}`;
    writeFileSync(file, id + '\n', 'utf8');
    return { session: id, source: 'default' };
  } catch {
    return { session: `s-${process.pid}`, source: 'default' };
  }
}

/** Identity of this process: session id, pid and process start time (pid + start identify the process instance). */
export function currentActor(env: NodeJS.ProcessEnv = process.env): ActorIdentity {
  if (cachedActor) return cachedActor;
  const startMs = Date.now() - Math.round(process.uptime() * 1000);
  const { session } = resolveSessionId(env);
  cachedActor = ActorIdentity.parse({
    session,
    pid: process.pid,
    processStart: new Date(startMs).toISOString(),
    host: hostName(),
  });
  return cachedActor;
}

export function setActorForTests(actor: ActorIdentity | undefined): void {
  cachedActor = actor;
}

export interface AppendInput {
  type: JournalEventType;
  goalId?: string;
  cardId?: string;
  generation?: number;
  data?: Record<string, unknown>;
  actor?: ActorIdentity;
  ts?: string;
}

export interface JournalVerification {
  ok: boolean;
  events: number;
  head: string;
  problems: Array<{ line: number; problem: string }>;
}

export class Journal {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  static forGoal(journalDir: string, goalId: string): Journal {
    return new Journal(path.join(journalDir, `${goalId}.jsonl`));
  }

  static host(journalDir: string): Journal {
    return new Journal(path.join(journalDir, '_host.jsonl'));
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  readAll(): JournalEvent[] {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    return lines.map((line) => JournalEvent.parse(JSON.parse(line)));
  }

  /** Raw lines for verification (does not throw on malformed lines). */
  private readRawLines(): string[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  }

  head(): { seq: number; hash: string } {
    const lines = this.readRawLines();
    const last = lines[lines.length - 1];
    if (!last) return { seq: -1, hash: GENESIS_HASH };
    const parsed = JournalEvent.parse(JSON.parse(last));
    return { seq: parsed.seq, hash: parsed.hash };
  }

  append(input: AppendInput): JournalEvent {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const { seq, hash: prevHash } = this.head();
    const body = {
      seq: seq + 1,
      ts: input.ts ?? nowIso(),
      type: input.type,
      goalId: input.goalId,
      cardId: input.cardId,
      generation: input.generation,
      actor: input.actor ?? currentActor(),
      data: input.data ?? {},
      prevHash,
    };
    const hash = sha256(canonicalJson(body));
    const event = JournalEvent.parse({ ...body, hash });
    appendFileSync(this.file, JSON.stringify(event) + '\n', 'utf8');
    return event;
  }

  verify(): JournalVerification {
    const lines = this.readRawLines();
    const problems: Array<{ line: number; problem: string }> = [];
    let prevHash = GENESIS_HASH;
    let expectedSeq = 0;
    let head = GENESIS_HASH;
    lines.forEach((line, idx) => {
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        problems.push({ line: idx + 1, problem: 'malformed JSON' });
        return;
      }
      const parsed = JournalEvent.safeParse(obj);
      if (!parsed.success) {
        problems.push({ line: idx + 1, problem: `schema: ${parsed.error.issues[0]?.message ?? 'invalid'}` });
        return;
      }
      const ev = parsed.data;
      if (ev.seq !== expectedSeq) problems.push({ line: idx + 1, problem: `sequence gap: expected ${expectedSeq}, found ${ev.seq}` });
      if (ev.prevHash !== prevHash) problems.push({ line: idx + 1, problem: 'previous hash mismatch' });
      const { hash, ...rest } = ev;
      const recomputed = sha256(canonicalJson(rest));
      if (recomputed !== hash) problems.push({ line: idx + 1, problem: 'event hash mismatch (altered content)' });
      prevHash = hash;
      head = hash;
      expectedSeq = ev.seq + 1;
    });
    return { ok: problems.length === 0, events: lines.length, head, problems };
  }

  filter(predicate: (event: JournalEvent) => boolean): JournalEvent[] {
    return this.readAll().filter(predicate);
  }
}
