import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRecovery, binaryRollbackCompatible, buildMigrationPlan, checkMigrationOrdering, detectDataImpact } from '../../src/core/migrate.ts';

describe('data impact detection (LC2 / Q20)', () => {
  test('Q20: ORM builder calls outside any migration directory are strong signals', () => {
    const r = detectDataImpact([{ path: 'src/db/schema.ts', content: "await knex.schema.alterTable('users', (t) => t.string('plan'))" }]);
    assert.equal(r.impacted, true);
    assert.equal(r.strong, true);
    assert.ok(r.signals.some((s) => s.kind === 'orm-model'));
    assert.ok(detectDataImpact([{ path: 'src/models.py', content: 'class Order(models.Model):' }]).strong);
  });

  test('Q20: ORM class definitions and entity annotations are strong signals', () => {
    // BUG: src/core/migrate.ts wraps the ORM alternation in an outer `\b(...)\b`.
    //  - `class \w+\(.*(?:Base|Model|db\.Model)\)` ends in `)`, so the trailing `\b` needs a word
    //    boundary right after `)`, which `class User(Base):` never provides.
    //  - `@Entity\b` / `@Table\b` / `@Column\b` start with `@`, so the leading `\b` fails at a line
    //    start or after a space (`\b` before a non-word char needs a word char before it).
    //  - `Schema\s*\(` followed by `{` fails the trailing `\b` the same way.
    // Verified: /\b(class \w+\(.*(?:Base|Model|db\.Model)\)|@Entity\b|...)\b/.test('class User(Base):') === false
    // and .test('@Entity\ndata class User(val id: Long)') === false. Expected: strong orm-model signal.
    // Fix: drop the outer `\b(...)\b` and anchor each alternative individually.
    const py = detectDataImpact([{ path: 'src/models/user.py', content: 'class User(Base):\n    email = Column(String)' }]);
    assert.equal(py.strong, true, 'SQLAlchemy declarative class');
    const kt = detectDataImpact([{ path: 'src/entity/User.kt', content: '@Entity\ndata class User(val id: Long)' }]);
    assert.equal(kt.strong, true, 'JPA/Room @Entity annotation');
    assert.ok(py.signals.some((s) => s.kind === 'orm-model') && kt.signals.some((s) => s.kind === 'orm-model'));
  });

  test('Q20: embedded DDL and backfill scripts are strong signals', () => {
    assert.ok(detectDataImpact([{ path: 'src/db.ts', content: 'await sql`ALTER TABLE users ADD COLUMN plan text`' }]).strong);
    assert.ok(detectDataImpact([{ path: 'scripts/backfill-plans.ts' }]).strong);
    assert.ok(detectDataImpact([{ path: 'src/repo.kt', content: 'UPDATE users SET plan = 1 WHERE plan IS NULL' }]).strong);
  });

  test('migration directories are only hints', () => {
    const r = detectDataImpact([{ path: 'db/migrations/0001_init.py' }]);
    assert.equal(r.impacted, true);
    assert.equal(r.strong, false);
    assert.equal(r.signals[0]?.kind, 'migration-dir');
  });

  test('schema files and storage contracts are strong; UI code is not data impact', () => {
    assert.ok(detectDataImpact([{ path: 'android/core/src/main/sqldelight/Inspection.sq' }]).strong);
    assert.ok(detectDataImpact([{ path: 'src/format.kt', content: 'const val STORAGE_VERSION = 3' }]).strong);
    const ui = detectDataImpact([{ path: 'src/ui/button.tsx', content: 'export const Button = () => null;' }]);
    assert.equal(ui.impacted, false);
    assert.deepEqual(ui.signals, []);
  });
});

describe('migration phase graph (LC8 / Q20)', () => {
  const steps = buildMigrationPlan({ database: 'main', expand: ['add plan column'], compatibleDeploy: 'deploy v2', backfill: ['fill plan'], contract: ['drop legacy column'] });

  test('expand -> deploy -> backfill -> verify -> contract with contract prerequisites', () => {
    assert.deepEqual(steps.map((s) => s.id), ['expand-1', 'deploy-1', 'backfill-1', 'verify-1', 'contract-1']);
    const contract = steps.find((s) => s.id === 'contract-1')!;
    assert.deepEqual(contract.dependsOn, ['verify-1']);
    assert.ok(contract.prerequisites.includes('consumer-compatibility-verified'));
    assert.ok(contract.prerequisites.includes('explicit-contract-authorization'));
    assert.equal(steps[0]?.dependsOn.length, 0);
    assert.ok(steps.every((s) => s.database === 'main'));
  });

  test('a default verify step is inserted when none is declared', () => {
    const plan = buildMigrationPlan({ database: 'main', expand: ['x'] });
    assert.ok(plan.some((s) => s.phase === 'verify'));
  });

  test('Q20: contraction may never run first or before verify; dependency order is checked', () => {
    const bad = checkMigrationOrdering(steps, ['contract-1', 'expand-1', 'deploy-1', 'backfill-1', 'verify-1']);
    assert.equal(bad.ok, false);
    assert.ok(bad.problems.some((p) => /contract-1 scheduled before its dependency verify-1/.test(p)));
    assert.ok(bad.problems.some((p) => /before any verify step/.test(p)));
    assert.ok(bad.problems.some((p) => /destructive contraction cannot be the first step/.test(p)));
    const schemaFirst = checkMigrationOrdering(steps, ['expand-1', 'contract-1', 'deploy-1', 'backfill-1', 'verify-1']);
    assert.equal(schemaFirst.ok, false, 'all schema operations first solely because they are schema operations is refused');
    assert.equal(checkMigrationOrdering(steps, ['expand-1', 'deploy-1', 'backfill-1', 'verify-1', 'contract-1']).ok, true);
    assert.equal(checkMigrationOrdering(steps, ['expand-1', 'deploy-1']).ok, true, 'partial orders are fine');
  });

  test('irreversible steps are classified by id or description', () => {
    const plan = buildMigrationPlan({ database: 'main', expand: ['add col'], contract: ['drop legacy column'], irreversible: ['drop legacy'] });
    assert.equal(plan.find((s) => s.id === 'expand-1')?.reversible, true);
    assert.equal(plan.find((s) => s.id === 'contract-1')?.reversible, false);
  });
});

describe('recovery (LC9 / Q21)', () => {
  const reversible = buildMigrationPlan({ database: 'main', expand: ['add col'] })[0]!;
  const irreversible = buildMigrationPlan({ database: 'main', contract: ['drop col'], irreversible: ['contract-1'] }).find((s) => s.phase === 'contract')!;

  test('reversible steps rehearse apply/reverse without extra authorization', () => {
    const r = assessRecovery(reversible, {});
    assert.equal(r.strategy, 'apply-reverse');
    assert.equal(r.requiresAuthorization, false);
  });

  test('Q21: irreversible steps need a forward repair or a verified recovery point; otherwise blocked', () => {
    assert.equal(assessRecovery(irreversible, { forwardRepairAvailable: true }).strategy, 'forward-repair');
    assert.equal(assessRecovery(irreversible, { backupVerified: true }).strategy, 'backup-restore');
    const blocked = assessRecovery(irreversible, {});
    assert.equal(blocked.strategy, 'blocked');
    assert.equal(blocked.requiresAuthorization, true);
    assert.match(blocked.detail, /not unrelated development/);
  });

  test('Q21: an old binary is never rolled back onto a contracted schema', () => {
    assert.equal(binaryRollbackCompatible(2, 1, true).ok, false);
    assert.equal(binaryRollbackCompatible(2, 1, false).ok, true);
    assert.equal(binaryRollbackCompatible(2, 2, true).ok, true);
  });
});
