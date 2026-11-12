/**
 * Preload for tests/scenarios/seal-binding.test.ts (card T0-AUDIT-BINDING), loaded with
 * `node --import <this file> src/cli/main.ts audit seal ...`. It wraps `EvidenceStore.prototype.seal`:
 * - AIDLC_TEST_RETAIN_BEFORE_SEAL: an evidence id retained through the real `retain` as a `dod-receipt` with no candidate
 *   digest, after the command loaded the manifest and before the real `seal` takes the manifest lock.
 */
import { EvidenceStore } from '../../src/audit/manifest.ts';

const late = process.env['AIDLC_TEST_RETAIN_BEFORE_SEAL'];
const real = { seal: EvidenceStore.prototype.seal, retain: EvidenceStore.prototype.retain };

EvidenceStore.prototype.seal = function (this: EvidenceStore, ...args: Parameters<EvidenceStore['seal']>) {
  const [manifest] = args;
  if (late) real.retain.call(this, { ...manifest, models: manifest.models ?? [] }, { id: late, kind: 'dod-receipt', content: late });
  return real.seal.apply(this, args);
};
