/** RED stub of card T1-CARD-CONTRACT-2: the four functions exist and return nothing useful. */
import type { Card } from './types.ts';

export function contractDigests(_card: Card): Record<string, string> {
  return {};
}

export function changedContractFields(_recorded: Partial<Record<string, string>>, _card: Card): string[] {
  return [];
}

export function invalidatedBy(_changed: readonly string[]): Array<'dod' | 'review'> {
  return [];
}

export function amendedDigest(digest: string, _count: number): string {
  return digest;
}
