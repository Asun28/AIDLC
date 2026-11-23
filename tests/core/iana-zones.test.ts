import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { IANA_ZONE_NAMES } from '../../src/core/iana-zones.ts';

describe('IANA_ZONE_NAMES: the zone and link names of tzdata 2026a (T0-LIMIT-RESET-IANA-NAMES, issue 398)', () => {
  test('597 names, none two that differ only in letter case [R1]', () => {
    assert.equal(IANA_ZONE_NAMES.size, 597);
    assert.equal(new Set([...IANA_ZONE_NAMES].map((n) => n.toLowerCase())).size, 597);
  });

  test('holds zones, links and the names with no area; not the names IANA removed or ICU-only names [R1]', () => {
    for (const name of ['Pacific/Auckland', 'US/Pacific', 'America/Argentina/Buenos_Aires', 'EST5EDT', 'UTC', 'Etc/GMT-5', 'W-SU', 'NZ-CHAT']) assert.ok(IANA_ZONE_NAMES.has(name), name);
    for (const name of ['US/Pacific-New', 'Canada/East-Saskatchewan', 'Factory', 'SystemV/AST4', 'PST']) assert.ok(!IANA_ZONE_NAMES.has(name), name);
  });

  test('Intl accepts every name as a timeZone [R1]', () => {
    for (const name of IANA_ZONE_NAMES) assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: name }), name);
  });
});
