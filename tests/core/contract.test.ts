import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { amendedDigest, changedContractFields, contractDigests, invalidatedBy } from '../../src/core/contract.ts';
import { parseCardText } from '../../src/artifacts/card.ts';
import { card } from './_fixtures.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const FIELDS = ['requirements', 'acceptance', 'allow_paths', 'forbid', 'non_goals', 'dod_command', 'dod_exit', 'budget', 'tdd'] as const;
const BASE = { requirements: ['R1. The x shall hold y.'], acceptance: ['1. y holds. [R1]'], forbid: ['f'], non_goals: ['n'], budget: 100 };
const base = card('T1-X', BASE);

// One row per field: the value that changes it alone, and the row of R4.
const ROWS: Array<[(typeof FIELDS)[number], Record<string, unknown>, string[]]> = [
  ['requirements', { requirements: ['R1. The x shall hold z.'] }, ['review']],
  ['acceptance', { acceptance: ['1. z holds. [R1]'] }, ['dod', 'review']],
  ['allow_paths', { allow_paths: ['src/other.ts'] }, ['review']],
  ['forbid', { forbid: ['g'] }, ['review']],
  ['non_goals', { non_goals: ['m'] }, ['review']],
  ['dod_command', { dod_command: 'npm run check' }, ['dod']],
  ['dod_exit', { dod_exit: 1 }, ['dod']],
  ['budget', { budget: 150 }, []],
  ['tdd', { tdd: false }, ['dod']],
];

test('R1: contractDigests gives the nine fields, each the SHA-256 of the JSON of its value', () => {
  const digests = contractDigests(base);
  assert.deepEqual(Object.keys(digests), [...FIELDS]);
  assert.deepEqual(digests, Object.fromEntries(FIELDS.map((f) => [f, sha(JSON.stringify(base[f]))])));
});

for (const [field, change, invalidated] of ROWS) {
  test(`R1/R5/R6: a card that differs in ${field} alone differs in that digest alone and invalidates [${invalidated.join(', ')}]`, () => {
    const other = card('T1-X', { ...BASE, ...change });
    const a = contractDigests(base);
    const b = contractDigests(other);
    for (const f of FIELDS) assert.equal(b[f], f === field ? sha(JSON.stringify(other[f])) : a[f], f);
    assert.notEqual(b[field], a[field]);
    assert.deepEqual(changedContractFields(a, other), [field]);
    assert.deepEqual(invalidatedBy([field]), invalidated);
  });
}

// Card files read by the real parser, one layout change per row against file A.
const FILE_A = '---\nid: T1-X\ntitle: x\nstatus: todo\nbranch: T1-X\nworktree: C:\\wt\\T1-X\nallow_paths:\n  - src/t1-x/\ndod_command: npm test\ndod_exit: 0\nbudget: 100\nrequirements:\n  - R1. The x shall hold y.\nacceptance:\n  - 1. y holds. [R1]\nforbid: [f]\nnon_goals: [n]\n---\n\n# T1-X\n';
const ITEM = '  - R1. The x shall hold y.\n';
const LAYOUTS: Array<[string, string]> = [
  ['another key order', FILE_A.replace('budget: 100\n', '').replace('non_goals: [n]\n', 'non_goals: [n]\nbudget: 100\n')],
  ['a block list against a flow list', FILE_A.replace('forbid: [f]\n', 'forbid:\n  - f\n')],
  ['CRLF against LF line endings', FILE_A.replace(/\n/g, '\r\n')],
  // blockList (src/artifacts/frontmatter.ts:202-215) reads an item's first line and skips an indented line that is not an item.
  ['a list item followed by an indented continuation line', FILE_A.replace(ITEM, `${ITEM}    a second line of the item\n`)],
];
const parsed = (text: string) => {
  const p = parseCardText(text);
  assert.ok('card' in p, JSON.stringify(p));
  return p.card;
};

for (const [layout, text] of LAYOUTS) {
  test(`R1: a card file with ${layout} parses to the same values and gives the same nine digests`, () => {
    assert.notEqual(text, FILE_A);
    for (const f of FIELDS) assert.deepEqual(parsed(text)[f], parsed(FILE_A)[f], f);
    assert.deepEqual(contractDigests(parsed(text)), contractDigests(parsed(FILE_A)));
    assert.deepEqual(contractDigests(parsed(FILE_A)), contractDigests(base));
  });
}

test('R1: a list item folded so that its first line differs parses to another value, and that digest alone differs', () => {
  const folded = parsed(FILE_A.replace(ITEM, '  - R1. The x shall\n    hold y.\n'));
  assert.deepEqual(folded.requirements, ['R1. The x shall']);
  assert.deepEqual(changedContractFields(contractDigests(parsed(FILE_A)), folded), ['requirements']);
});

for (const [field, absentAs] of [['requirements', []], ['forbid', []], ['non_goals', []], ['budget', null]] as const) {
  test(`R1: a card that leaves ${field} out has the digest of ${JSON.stringify(absentAs)}, the same as an empty list and not that of a value`, () => {
    const { [field]: _left, ...rest } = BASE;
    const absent = contractDigests(card('T1-X', rest))[field];
    assert.equal(absent, sha(JSON.stringify(absentAs)));
    if (absentAs) assert.equal(absent, contractDigests(card('T1-X', { ...rest, [field]: [] }))[field]);
    assert.notEqual(absent, contractDigests(base)[field]);
  });
}

test('R5/R6: several changed fields come in the order of R1, equal contracts give none, an empty record gives all nine; budget with acceptance gives dod and review, no field nothing', () => {
  const other = card('T1-X', { ...BASE, tdd: false, budget: 150, requirements: ['R1. The x shall hold z.'] });
  assert.deepEqual(changedContractFields(contractDigests(base), other), ['requirements', 'budget', 'tdd']);
  assert.deepEqual(changedContractFields(contractDigests(base), card('T1-X', BASE)), []);
  assert.deepEqual(changedContractFields({}, base), [...FIELDS]);
  assert.deepEqual(invalidatedBy(['budget', 'acceptance']), ['dod', 'review']);
  assert.deepEqual(invalidatedBy([]), []);
});

test('R7: amendedDigest chains SHA-256 of the previous digest, a line feed and "amended", once per count', () => {
  const d = sha('candidate');
  const once = sha(`${d}\namended`);
  assert.equal(amendedDigest(d, 0), d);
  assert.equal(amendedDigest(d, 1), once);
  assert.equal(amendedDigest(d, 2), sha(`${once}\namended`));
  assert.equal(amendedDigest(d, 2), amendedDigest(amendedDigest(d, 1), 1));
  assert.notEqual(amendedDigest(d, 2), d);
  assert.notEqual(amendedDigest(d, 2), once);
});
