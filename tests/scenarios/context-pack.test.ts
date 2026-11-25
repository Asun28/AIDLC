import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import childProcess, { execFileSync } from 'node:child_process';
import path from 'node:path';
import { makeFixture, writeCard } from './_harness.ts';
import { loadContextPack } from '../../src/loop/context-pack.ts';
import { tmpDir } from '../infra/helpers.ts';

test('a Windows short-name repository root reads the same plan as its long path', { skip: process.platform !== 'win32' }, (t) => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'plans'));
    writeFileSync(path.join(fx.tmp, 'plans/plan.md'), 'same plan');
    writeCard(fx, { id: 'T1-PACK', title: 'short root', planRef: 'plans/plan.md' });
    const short = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; (New-Object -ComObject Scripting.FileSystemObject).GetFolder([Console]::In.ReadToEnd()).ShortPath'], { input: fx.tmp, encoding: 'utf8', windowsHide: true }).trim();
    if (short.toLowerCase() === fs.realpathSync.native(short).toLowerCase()) { t.skip('8.3 names unavailable on this filesystem'); return; }
    assert.equal(JSON.parse(loadContextPack(fx.card('T1-PACK'), short, [])).planSection, 'same plan');
  } finally { fx.cleanup(); }
});

test('run-card carries the referenced plan section and matching lessons as JSON data', () => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'plans'));
    mkdirSync(path.join(fx.tmp, 'docs'));
    writeFileSync(path.join(fx.tmp, 'plans/feature.md'), '# Plan\n## Selected section\nImplement carefully.\n### Detail\nKeep this.\n## Other\nExclude this.\n');
    writeFileSync(path.join(fx.tmp, 'docs/LESSONS.md'), '# Lessons\n- src/loop: keep receipts\n- unrelated: exclude this\n');
    writeCard(fx, { id: 'T1-PACK', title: 'project context', planRef: 'plans/feature.md#selected-section', allowPaths: ['src/loop/example.ts'] });
    const goal = fx.controller.createGoal({ text: 'implement T1-PACK', source: 'card', ref: 'T1-PACK', affectedSurfaces: [] }, { cards: ['T1-PACK'] });
    const { directive } = fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-PACK'] } });
    assert.equal(directive.kind, 'run-card');
    if (directive.kind !== 'run-card') throw new Error('expected run-card');
    assert.equal(typeof directive.context.pack, 'string');
    const pack = JSON.parse(directive.context.pack as string);
    assert.equal(pack.planSection, '## Selected section\nImplement carefully.\n### Detail\nKeep this.');
    assert.deepEqual(pack.acceptance, fx.card('T1-PACK').acceptance);
    assert.deepEqual(pack.lessons, ['- src/loop: keep receipts']);
    assert.deepEqual(pack.missingSources, []);
    const again = fx.controller.next(goal.id);
    assert.equal(again.kind === 'run-card' && again.context.pack, directive.context.pack);
  } finally { fx.cleanup(); }
});

test('missing plan files, anchors and lesson files are explicit and outside references are refused', () => {
  const fx = makeFixture();
  const outside = tmpDir('aidlc-pack-outside-');
  try {
    writeCard(fx, { id: 'T1-PACK', title: 'project context' });
    const card = { ...fx.card('T1-PACK'), plan_ref: 'plans/missing.md#section' };
    assert.deepEqual(JSON.parse(loadContextPack(card, fx.tmp, [])).missingSources, ['plans/missing.md', 'docs/LESSONS.md']);
    assert.deepEqual(JSON.parse(loadContextPack({ ...card, plan_ref: undefined }, fx.tmp, [])).missingSources, ['plan_ref', 'docs/LESSONS.md']);
    assert.deepEqual(JSON.parse(loadContextPack({ ...card, plan_ref: '#fragment' }, fx.tmp, [])).missingSources, ['plan_ref', 'docs/LESSONS.md']);
    mkdirSync(path.join(fx.tmp, 'plans'));
    writeFileSync(path.join(fx.tmp, 'plans/missing.md'), '# Other\nNot the requested section.');
    assert.deepEqual(JSON.parse(loadContextPack(card, fx.tmp, [])).missingSources, ['plans/missing.md#section', 'docs/LESSONS.md']);
    for (const ref of ['../escape.md', path.join(outside, 'secret.md')]) assert.throws(() => loadContextPack({ ...card, plan_ref: ref }, fx.tmp, []), /outside repository/);
    writeFileSync(path.join(outside, 'secret.md'), 'private material');
    symlinkSync(outside, path.join(fx.tmp, 'plans/external'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => loadContextPack({ ...card, plan_ref: 'plans/external/secret.md' }, fx.tmp, []), /outside repository/);
    mkdirSync(path.join(fx.tmp, 'docs'));
    symlinkSync(outside, path.join(fx.tmp, 'docs/LESSONS.md'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => loadContextPack(card, fx.tmp, []), /outside repository/);
  } finally { fx.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test('plan section extraction ignores headings in fenced code and reports an empty missing anchor', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-PACK', title: 'project context' });
    mkdirSync(path.join(fx.tmp, 'plans'));
    const card = { ...fx.card('T1-PACK'), plan_ref: 'plans/plan.md#selected' };
    writeFileSync(path.join(fx.tmp, 'plans/plan.md'), '# Plan\n```md\n## Selected\nwrong\n```\n## Selected\nreal\n~~~md\n## Example\n~~~\n## Other\nexcluded');
    assert.equal(JSON.parse(loadContextPack(card, fx.tmp, [])).planSection, '## Selected\nreal\n~~~md\n## Example\n~~~');
    for (const plan_ref of ['plans/plan.md#selected#extra', 'plans/plan.md#']) {
      const pack = JSON.parse(loadContextPack({ ...card, plan_ref }, fx.tmp, []));
      assert.equal(pack.planSection, '');
      assert.deepEqual(pack.missingSources, [plan_ref, 'docs/LESSONS.md']);
    }
    writeFileSync(path.join(fx.tmp, 'plans/plan.md'), '');
    assert.deepEqual(JSON.parse(loadContextPack(card, fx.tmp, [])).missingSources, ['plans/plan.md#selected', 'docs/LESSONS.md']);
  } finally { fx.cleanup(); }
});

test('controller reports missing source data and refuses an outside plan reference', () => {
  for (const planRef of ['plans/missing.md#section', '../outside.md']) {
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T1-PACK', title: 'project context', planRef });
      const goal = fx.controller.createGoal({ text: 'implement T1-PACK', source: 'card', ref: 'T1-PACK', affectedSurfaces: [] }, { cards: ['T1-PACK'] });
      const project = () => fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected' as const, data: { cards: ['T1-PACK'] } });
      if (planRef.startsWith('..')) assert.throws(project, /outside repository/);
      else {
        const { directive } = project();
        assert.equal(directive.kind, 'run-card');
        if (directive.kind !== 'run-card') throw new Error('expected run-card');
        assert.deepEqual(JSON.parse(directive.context.pack as string).missingSources, ['plans/missing.md', 'docs/LESSONS.md']);
      }
    } finally { fx.cleanup(); }
  }
});

test('a symlinked root works and a source-link swap after resolution never redirects the read', () => {
  const fx = makeFixture();
  const outside = tmpDir('aidlc-pack-swap-');
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    writeCard(fx, { id: 'T1-PACK', title: 'project context' });
    mkdirSync(path.join(fx.tmp, 'plans'));
    const card = { ...fx.card('T1-PACK'), plan_ref: 'plans/plan.md' };
    writeFileSync(path.join(fx.tmp, 'plans/plan.md'), 'inside');
    symlinkSync(fx.tmp, path.join(outside, 'root'), linkType);
    assert.equal(JSON.parse(loadContextPack(card, path.join(outside, 'root'), [])).planSection, 'inside');
    mkdirSync(path.join(fx.tmp, 'plans/safe'));
    writeFileSync(path.join(fx.tmp, 'plans/safe/plan.md'), 'checked inside');
    writeFileSync(path.join(outside, 'plan.md'), 'outside secret');
    const alias = path.join(fs.realpathSync.native(fx.tmp), 'plans/alias');
    symlinkSync(path.join(fx.tmp, 'plans/safe'), alias, linkType);
    const resolve = fs.realpathSync.native;
    let swapped = false;
    const spy = mock.method(fs.realpathSync, 'native', (file: fs.PathLike) => {
      const resolved = resolve(file);
      if (String(file) === path.join(alias, 'plan.md')) {
        rmSync(alias);
        symlinkSync(outside, alias, linkType);
        swapped = true;
      }
      return resolved;
    });
    syncBuiltinESMExports();
    try {
      assert.equal(JSON.parse(loadContextPack({ ...card, plan_ref: 'plans/alias/plan.md' }, fx.tmp, [])).planSection, 'checked inside');
      assert.equal(swapped, true);
    }
    finally { spy.mock.restore(); syncBuiltinESMExports(); }
  } finally { fx.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test('plan references and symlinks cannot serialize unrelated repository files', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-PACK', title: 'project context' });
    writeFileSync(path.join(fx.tmp, '.env'), 'private material');
    writeFileSync(path.join(fx.tmp, 'private.md'), 'private material');
    const card = fx.card('T1-PACK');
    for (const ref of ['.env', 'private.md']) assert.throws(() => loadContextPack({ ...card, plan_ref: ref }, fx.tmp, []), /plan source/i);
    mkdirSync(path.join(fx.tmp, 'plans'));
    mkdirSync(path.join(fx.tmp, 'private'));
    writeFileSync(path.join(fx.tmp, 'private/secret.md'), 'private material');
    symlinkSync(path.join(fx.tmp, 'private'), path.join(fx.tmp, 'plans/alias'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => loadContextPack({ ...card, plan_ref: 'plans/alias/secret.md' }, fx.tmp, []), /plan source/i);
    mkdirSync(path.join(fx.tmp, 'docs'));
    symlinkSync(path.join(fx.tmp, 'private'), path.join(fx.tmp, 'docs/LESSONS.md'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => loadContextPack({ ...card, plan_ref: undefined }, fx.tmp, []), /lesson source/i);
  } finally { fx.cleanup(); }
});

test('an existing source refuses loading when Linux descriptor-path verification is unavailable', () => {
  const fx = makeFixture();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    mkdirSync(path.join(fx.tmp, 'plans'));
    writeFileSync(path.join(fx.tmp, 'plans/plan.md'), 'existing plan');
    writeCard(fx, { id: 'T1-PACK', title: 'unavailable descriptor lookup', planRef: 'plans/plan.md' });
    const card = fx.card('T1-PACK');
    const unavailable = Object.assign(new Error('descriptor lookup unavailable'), { code: 'ENOENT' });
    const spy = mock.method(fs, 'realpathSync', () => { throw unavailable; });
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    syncBuiltinESMExports();
    try { assert.throws(() => loadContextPack(card, fx.tmp, []), (error) => error === unavailable); }
    finally { spy.mock.restore(); Object.defineProperty(process, 'platform', platform); syncBuiltinESMExports(); }
  } finally { fx.cleanup(); }
});

test('Windows helper failures retain safe diagnostics without subprocess output', () => {
  const fx = makeFixture();
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    mkdirSync(path.join(fx.tmp, 'plans'));
    writeFileSync(path.join(fx.tmp, 'plans/plan.md'), 'existing plan');
    writeCard(fx, { id: 'T1-PACK', title: 'helper failure', planRef: 'plans/plan.md' });
    const card = fx.card('T1-PACK');
    for (const [failure, diagnostic] of [[{ status: 43 }, 'exit 43'], [{ code: 'ETIMEDOUT' }, 'timeout'], [{ code: 'ENOBUFS' }, 'output limit']] as const) {
      const spy = mock.method(childProcess, 'execFileSync', () => { throw Object.assign(new Error('private subprocess output'), failure, { stdout: 'private source', stderr: 'private diagnostic' }); });
      Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
      syncBuiltinESMExports();
      try {
        assert.throws(() => loadContextPack(card, fx.tmp, []), (error) => error instanceof Error && error.message === `Opened context source helper failed (${diagnostic})` && error.cause === undefined);
      } finally { spy.mock.restore(); Object.defineProperty(process, 'platform', platform); syncBuiltinESMExports(); }
    }
  } finally { fx.cleanup(); }
});

test('a parent-directory swap after resolution is refused before outside content is read', () => {
  for (const source of ['plans/plan.md', 'docs/LESSONS.md']) {
    const fx = makeFixture();
    const outside = tmpDir('aidlc-pack-parent-swap-');
    try {
      writeCard(fx, { id: 'T1-PACK', title: 'project context' });
      const parent = path.join(fx.tmp, path.dirname(source));
      mkdirSync(parent);
      const target = path.join(fs.realpathSync.native(fx.tmp), source);
      writeFileSync(target, 'inside');
      writeFileSync(path.join(outside, path.basename(source)), 'outside secret');
      const card = { ...fx.card('T1-PACK'), plan_ref: source.startsWith('plans/') ? source : undefined };
      assert.doesNotThrow(() => loadContextPack(card, fx.tmp, []));
      const resolve = fs.realpathSync.native;
      let swapped = false;
      const spy = mock.method(fs.realpathSync, 'native', (file: fs.PathLike) => {
        const resolved = resolve(file);
        if (!swapped && String(file) === target) {
          swapped = true;
          fs.renameSync(parent, `${parent}-saved`);
          symlinkSync(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
        }
        return resolved;
      });
      syncBuiltinESMExports();
      try {
        assert.throws(() => loadContextPack(card, fx.tmp, []), /^Error: Opened context source path changed$/);
        assert.equal(swapped, true);
      } finally { spy.mock.restore(); syncBuiltinESMExports(); }
    } finally { fx.cleanup(); rmSync(outside, { recursive: true, force: true }); }
  }
});

test('controller honors configured plansDir and the repository docs/plans location', () => {
  const fx = makeFixture({ config: { plansDir: 'design' } });
  try {
    mkdirSync(path.join(fx.tmp, 'design'));
    mkdirSync(path.join(fx.tmp, 'docs/plans'), { recursive: true });
    writeFileSync(path.join(fx.tmp, 'design/feature.md'), 'configured plan');
    writeFileSync(path.join(fx.tmp, 'docs/plans/feature.md'), 'repository plan');
    writeCard(fx, { id: 'T1-PACK', title: 'project context', planRef: 'design/feature.md' });
    const goal = fx.controller.createGoal({ text: 'implement T1-PACK', source: 'card', ref: 'T1-PACK', affectedSurfaces: [] }, { cards: ['T1-PACK'] });
    const { directive } = fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-PACK'] } });
    assert.equal(directive.kind, 'run-card');
    if (directive.kind !== 'run-card') throw new Error('expected run-card');
    assert.equal(JSON.parse(directive.context.pack as string).planSection, 'configured plan');
    assert.equal(JSON.parse(loadContextPack({ ...fx.card('T1-PACK'), plan_ref: 'docs/plans/feature.md' }, fx.tmp, [], 'design')).planSection, 'repository plan');
  } finally { fx.cleanup(); }
});

test('a case-insensitive filesystem accepts the same LESSONS file under its canonical casing', (t) => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'docs'));
    writeFileSync(path.join(fx.tmp, 'docs/lessons.md'), '- loop: keep this');
    if (!fs.existsSync(path.join(fx.tmp, 'docs/LESSONS.md'))) { t.skip('filesystem is case-sensitive'); return; }
    writeCard(fx, { id: 'T1-PACK', title: 'project context', allowPaths: ['src/loop/example.ts'] });
    assert.deepEqual(JSON.parse(loadContextPack(fx.card('T1-PACK'), fx.tmp, [])).lessons, ['- loop: keep this']);
  } finally { fx.cleanup(); }
});

/** Runs `body` with `process.platform` set to darwin and the replaced fs functions exported, then restores both. */
function onDarwin(body: () => void, ...mocks: Array<() => { mock: { restore(): void } }>): void {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const spies: Array<{ mock: { restore(): void } }> = [];
  try {
    for (const make of mocks) spies.push(make());
    Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
    syncBuiltinESMExports();
    body();
  } finally {
    for (const spy of spies.reverse()) spy.mock.restore();
    Object.defineProperty(process, 'platform', platform);
    syncBuiltinESMExports();
  }
}

/** A fixture whose card names plans/plan.md, with the canonical path of that file. */
function planFixture() {
  const fx = makeFixture();
  mkdirSync(path.join(fx.tmp, 'plans'));
  const target = path.join(fs.realpathSync.native(fx.tmp), 'plans', 'plan.md');
  writeFileSync(target, 'inside');
  writeCard(fx, { id: 'T1-PACK', title: 'project context', planRef: 'plans/plan.md' });
  return { fx, target, card: fx.card('T1-PACK') };
}

/** Spies on fs.openSync and fs.closeSync; `closed` says whether every descriptor opened for `target` was closed, and that there was one. */
function descriptorSpy(target: string) {
  const opened: number[] = [];
  const closes: number[] = [];
  const { openSync, closeSync } = fs;
  return {
    open: () => mock.method(fs, 'openSync', (...args: Parameters<typeof openSync>) => {
      const fd = openSync(...args);
      if (String(args[0]) === target) opened.push(fd);
      return fd;
    }),
    close: () => mock.method(fs, 'closeSync', (fd: number) => { closes.push(fd); closeSync(fd); }),
    closed: () => opened.length === 1 && closes.filter((fd) => fd === opened[0]).length === 1,
  };
}

test('T1-CONTEXT-PACK-POSIX acceptance 1: on a platform other than win32 and linux the plan file and docs/LESSONS.md are read', () => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'plans'));
    mkdirSync(path.join(fx.tmp, 'docs'));
    writeFileSync(path.join(fx.tmp, 'plans/plan.md'), 'inside');
    writeFileSync(path.join(fx.tmp, 'docs/LESSONS.md'), '- src/loop: keep receipts\n- unrelated: exclude this\n');
    writeCard(fx, { id: 'T1-PACK', title: 'project context', planRef: 'plans/plan.md', allowPaths: ['src/loop/example.ts'] });
    const card = fx.card('T1-PACK');
    onDarwin(() => {
      let pack: { planSection: string; lessons: string[] } | undefined;
      assert.doesNotThrow(() => { pack = JSON.parse(loadContextPack(card, fx.tmp, [])); });
      assert.equal(pack!.planSection, 'inside');
      assert.deepEqual(pack!.lessons, ['- src/loop: keep receipts']);
    });
  } finally { fx.cleanup(); }
});

test('T1-CONTEXT-PACK-POSIX acceptance 2: on that platform a parent-directory swap after resolution is refused before outside content is read', () => {
  for (const source of ['plans/plan.md', 'docs/LESSONS.md']) {
    const fx = makeFixture();
    const outside = tmpDir('aidlc-pack-darwin-swap-');
    try {
      writeCard(fx, { id: 'T1-PACK', title: 'project context' });
      const parent = path.join(fx.tmp, path.dirname(source));
      mkdirSync(parent);
      const target = path.join(fs.realpathSync.native(fx.tmp), source);
      writeFileSync(target, 'inside');
      writeFileSync(path.join(outside, path.basename(source)), 'outside secret');
      const card = { ...fx.card('T1-PACK'), plan_ref: source.startsWith('plans/') ? source : undefined };
      const resolve = fs.realpathSync.native;
      let swapped = false;
      onDarwin(() => {
        assert.throws(() => loadContextPack(card, fx.tmp, []), /^Error: Opened context source path changed$/);
        assert.equal(swapped, true);
      }, () => mock.method(fs.realpathSync, 'native', (file: fs.PathLike) => {
        const resolved = resolve(file);
        if (!swapped && String(file) === target) {
          swapped = true;
          fs.renameSync(parent, `${parent}-saved`);
          symlinkSync(outside, parent, path.sep === '\\' ? 'junction' : 'dir');
        }
        return resolved;
      }));
    } finally { fx.cleanup(); rmSync(outside, { recursive: true, force: true }); }
  }
});

test('T1-CONTEXT-PACK-POSIX acceptance 3: a path whose device or inode differs from the opened descriptor is refused and the descriptor is closed', () => {
  for (const field of ['ino', 'dev'] as const) {
    const { fx, target, card } = planFixture();
    try {
      const { lstatSync } = fs;
      const spy = descriptorSpy(target);
      onDarwin(() => {
        assert.throws(() => loadContextPack(card, fx.tmp, []), /^Error: Opened context source path changed$/, field);
        assert.equal(spy.closed(), true, field);
      }, spy.open, spy.close, () => mock.method(fs, 'lstatSync', (file: fs.PathLike, options?: fs.StatSyncOptions) => {
        const stat = lstatSync(file, options) as fs.BigIntStats;
        return String(file) === target ? Object.assign(Object.create(stat) as fs.BigIntStats, { [field]: stat[field] + 1n }) : stat;
      }));
    } finally { fx.cleanup(); }
  }
});

test('T1-CONTEXT-PACK-POSIX acceptance 4: an error of the path check propagates unchanged and the descriptor is closed', () => {
  const { fx, target, card } = planFixture();
  try {
    const { lstatSync } = fs;
    const failure = Object.assign(new Error('path check failed'), { code: 'EIO' });
    const spy = descriptorSpy(target);
    onDarwin(() => {
      assert.throws(() => loadContextPack(card, fx.tmp, []), (error) => error === failure);
      assert.equal(spy.closed(), true);
    }, spy.open, spy.close, () => mock.method(fs, 'lstatSync', (file: fs.PathLike, options?: fs.StatSyncOptions) => {
      if (String(file) === target) throw failure;
      return lstatSync(file, options);
    }));
  } finally { fx.cleanup(); }
});

test('T1-CONTEXT-PACK-POSIX acceptance 5: a final component replaced by a link after resolution is not read', { skip: process.platform === 'win32' ? 'needs a POSIX host' : false }, () => {
  const { fx, target, card } = planFixture();
  const outside = tmpDir('aidlc-pack-final-link-');
  try {
    writeFileSync(path.join(outside, 'plan.md'), 'outside secret');
    const resolve = fs.realpathSync.native;
    let swapped = false;
    onDarwin(() => {
      assert.throws(() => loadContextPack(card, fx.tmp, []), (error) => (error as NodeJS.ErrnoException).code === 'ELOOP');
      assert.equal(swapped, true);
    }, () => mock.method(fs.realpathSync, 'native', (file: fs.PathLike) => {
      const resolved = resolve(file);
      if (!swapped && String(file) === target) {
        swapped = true;
        rmSync(target);
        symlinkSync(path.join(outside, 'plan.md'), target);
      }
      return resolved;
    }));
  } finally { fx.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});
