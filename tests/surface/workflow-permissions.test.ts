import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflows = path.join(root, '.github', 'workflows');

function isMapping(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function render(v: unknown): string {
  return v === undefined ? 'absent' : JSON.stringify(v);
}
function isScope(v: unknown): boolean {
  return v === 'read' || v === 'none';
}

export function permissionProblems(text: string): string[] {
  const doc: unknown = YAML.parse(text);
  const top = isMapping(doc) ? doc : {};
  const problems: string[] = [];
  const perms = top.permissions;
  if (!isMapping(perms)) {
    problems.push('top-level permissions is not a mapping of scopes');
  } else {
    if (perms.contents !== 'read') problems.push(`top-level contents is ${render(perms.contents)}`);
    for (const [scope, value] of Object.entries(perms)) {
      if (scope !== 'contents' && !isScope(value)) problems.push(`top-level ${scope} is ${render(value)}`);
    }
  }
  if ('jobs' in top) {
    if (!isMapping(top.jobs)) {
      problems.push('jobs is not a mapping of jobs');
    } else {
      for (const [id, job] of Object.entries(top.jobs)) {
        if (!isMapping(job)) {
          problems.push(`job ${id} is not a mapping`);
          continue;
        }
        if (!('permissions' in job)) continue;
        const jp = job.permissions;
        if (jp === 'read-all') continue;
        if (!isMapping(jp)) {
          problems.push(`job ${id} permissions is not "read-all" or a mapping of scopes: ${render(jp)}`);
          continue;
        }
        for (const [scope, value] of Object.entries(jp)) {
          if (!isScope(value)) problems.push(`job ${id} ${scope} is ${render(value)}`);
        }
      }
    }
  }
  return problems;
}

export function ciPermissionsExact(text: string): boolean {
  const doc: unknown = YAML.parse(text);
  if (!isMapping(doc)) return false;
  const p = doc.permissions;
  if (!isMapping(p)) return false;
  const keys = Object.keys(p);
  if (keys.length !== 1 || keys[0] !== 'contents' || p.contents !== 'read') return false;
  if (isMapping(doc.jobs)) {
    for (const job of Object.values(doc.jobs)) {
      if (isMapping(job) && Object.hasOwn(job, 'permissions')) return false;
    }
  }
  return true;
}

const OK = 'permissions:\n  contents: read\n';
const J = OK + 'jobs:\n  a:\n';
const P = 'top-level permissions is not a mapping of scopes';
const JP = (v: string) => `job a permissions is not "read-all" or a mapping of scopes: ${v}`;

describe('T0-CI-PERMISSIONS workflow permissions [R1] [R2] [R3]', () => {
  test('permissionProblems on each input class', () => {
    const rows: Array<[string, string[]]> = [
      [OK, []],
      ['permissions:\n  contents: read\n  actions: none\n', []],
      [OK + 'jobs:\n  a:\n    runs-on: x\n', []],
      [J + '    permissions: read-all\n', []],
      [J + '    permissions:\n      contents: read\n      checks: none\n', []],
      [J + '    permissions: {}\n', []],
      ['name: x\n', [P]],
      ['permissions:\n', [P]],
      ['permissions: read-all\n', [P]],
      ['permissions: write-all\n', [P]],
      ['permissions: [contents]\n', [P]],
      ['permissions: true\n', [P]],
      ['permissions: 1\n', [P]],
      ['permissions: ""\n', [P]],
      ['- a\n', [P]],
      ['permissions: {}\n', ['top-level contents is absent']],
      ['permissions:\n  contents: write\n', ['top-level contents is "write"']],
      ['permissions:\n  contents: Read\n', ['top-level contents is "Read"']],
      ['permissions:\n  contents: true\n', ['top-level contents is true']],
      ['permissions:\n  contents:\n', ['top-level contents is null']],
      [OK + '  pull-requests: write\n', ['top-level pull-requests is "write"']],
      [OK + '  id-token: WRITE\n', ['top-level id-token is "WRITE"']],
      [OK + '  actions: 1\n', ['top-level actions is 1']],
      [OK + 'jobs: [a]\n', ['jobs is not a mapping of jobs']],
      [OK + 'jobs: x\n', ['jobs is not a mapping of jobs']],
      [OK + 'jobs:\n', ['jobs is not a mapping of jobs']],
      [OK + 'jobs:\n  a: x\n', ['job a is not a mapping']],
      [J, ['job a is not a mapping']],
      [OK + 'jobs:\n  a: [1]\n', ['job a is not a mapping']],
      [J + '    permissions:\n', [JP('null')]],
      [J + '    permissions: [contents]\n', [JP('["contents"]')]],
      [J + '    permissions: true\n', [JP('true')]],
      [J + '    permissions: 1\n', [JP('1')]],
      [J + '    permissions: ""\n', [JP('""')]],
      [J + '    permissions: Read-all\n', [JP('"Read-all"')]],
      [J + '    permissions: write-all\n', [JP('"write-all"')]],
      [J + '    permissions:\n      contents: write\n', ['job a contents is "write"']],
      [J + '    permissions:\n      contents: true\n', ['job a contents is true']],
      [
        'permissions:\n  contents: write\n  pull-requests: write\njobs:\n  a:\n    permissions:\n      contents: write\n  b: x\n',
        ['top-level contents is "write"', 'top-level pull-requests is "write"', 'job a contents is "write"', 'job b is not a mapping'],
      ],
    ];
    for (const [text, expected] of rows) {
      assert.deepEqual(permissionProblems(text), expected, JSON.stringify(text));
    }
    assert.throws(() => permissionProblems('permissions: [\n'));
  });

  test('ciPermissionsExact refuses an added read scope and a job override', () => {
    assert.equal(ciPermissionsExact(OK + 'jobs:\n  a:\n    runs-on: x\n'), true);
    assert.equal(ciPermissionsExact('permissions:\n  contents: read\n  actions: read\n'), false);
    assert.equal(ciPermissionsExact(J + '    permissions: {}\n'), false);
    assert.equal(ciPermissionsExact(J + '    permissions:\n      contents: read\n'), false);
    assert.equal(ciPermissionsExact('name: x\n'), false);
  });

  test('every workflow under .github/workflows has no permission problem and ci.yml is exact', () => {
    const files = readdirSync(workflows).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    assert.ok(files.length >= 5, `workflow files: ${files.join(', ')}`);
    assert.ok(files.includes('ci.yml'));
    for (const f of files) {
      const problems = permissionProblems(readFileSync(path.join(workflows, f), 'utf8'));
      assert.deepEqual(problems, [], `${f}: ${problems.join('; ')}`);
    }
    assert.equal(ciPermissionsExact(readFileSync(path.join(workflows, 'ci.yml'), 'utf8')), true);
  });
});
