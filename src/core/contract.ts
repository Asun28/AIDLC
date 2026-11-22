/**
 * The contract of a card run and the pure rules of an amendment (card T1-CARD-CONTRACT-2). Each field holds a string, a whole
 * number, a boolean or a list of strings, so `JSON.stringify` of the parsed value is canonical and layout changes no digest.
 */
import { createHash } from 'node:crypto';
import { CONTRACT_FIELDS, type Card, type ContractField } from './types.ts';

export type ContractDigests = Record<ContractField, string>;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const LISTS: readonly ContractField[] = ['requirements', 'forbid', 'non_goals'];
const TOUCHES_DOD: readonly ContractField[] = ['acceptance', 'dod_command', 'dod_exit', 'tdd'];
const TOUCHES_REVIEW: readonly ContractField[] = ['requirements', 'acceptance', 'allow_paths', 'forbid', 'non_goals'];

/** One SHA-256 hex digest per contract field; an absent `requirements`, `forbid` or `non_goals` is `[]`, an absent `budget` `null`. */
export function contractDigests(card: Card): ContractDigests {
  const value = (f: ContractField): unknown => card[f] ?? (LISTS.includes(f) ? [] : null);
  return Object.fromEntries(CONTRACT_FIELDS.map((f) => [f, sha256(JSON.stringify(value(f)))])) as ContractDigests;
}

/** The fields whose recorded digest differs from the card's, in the order of `CONTRACT_FIELDS`. */
export function changedContractFields(recorded: Partial<ContractDigests>, card: Card): ContractField[] {
  const current = contractDigests(card);
  return CONTRACT_FIELDS.filter((f) => recorded[f] !== current[f]);
}

/** The evidence the changed fields invalidate: `dod` (the DoD receipt), `review` (the current candidate's review decisions), both or neither. */
export function invalidatedBy(changed: readonly ContractField[]): Array<'dod' | 'review'> {
  const out: Array<'dod' | 'review'> = [];
  if (changed.some((f) => TOUCHES_DOD.includes(f))) out.push('dod');
  if (changed.some((f) => TOUCHES_REVIEW.includes(f))) out.push('review');
  return out;
}

/** SHA-256 of the previous result, a line feed and `amended`, applied `count` times to `digest`. */
export function amendedDigest(digest: string, count: number): string {
  let out = digest;
  for (let i = 0; i < count; i += 1) out = sha256(`${out}\namended`);
  return out;
}
