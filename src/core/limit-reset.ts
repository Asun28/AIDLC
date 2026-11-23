/**
 * Limit reset (card T0-CLI-LIMIT-RESET, issue 394): the delay to the wall-clock reset time a CLI limit message names, such
 * as the Claude CLI's `You've hit your Fable limit · resets 1pm (Pacific/Auckland)`. Pure: the caller passes the clock.
 */

import { IANA_ZONE_NAMES } from './iana-zones.ts';

/**
 * `resets <h>[:<mm>]<am|pm> (<zone>)` in any letter case, with no letter or digit of any script joined before `resets`;
 * the first one in the text decides. The zone text opens with a letter and has no `:`, so a numeric offset such as
 * `+05:00`, which Intl also accepts, never matches; `isIanaName` then decides whether it names an IANA zone.
 */
const RESET = /(?<![\p{L}\p{N}])resets (\d{1,2})(?::(\d{2}))?(am|pm) \(([A-Za-z][\w+-]*(?:\/[\w+-]+)*)\)/iu;
const DAY = 86_400_000;
/** The IANA zone and link names in lower case, for a comparison without letter case. */
const IANA_LOWER = new Set([...IANA_ZONE_NAMES].map((n) => n.toLowerCase()));
/**
 * An IANA zone or link name of tzdata 2026a in any letter case, as Intl reads it: the full name is compared, not its area,
 * so a name ICU still accepts after IANA removed it, such as `US/Pacific-New`, is not one (issue 398).
 */
const isIanaName = (zone: string): boolean => IANA_LOWER.has(zone.toLowerCase());

/**
 * The milliseconds from `nowIso` to the first instant after it at which the wall clock of the named zone reads the reset
 * time; a time that a daylight-saving gap skips that day is the end of the gap. Undefined when the text names no such
 * reset, the zone is unknown or the time is out of range; never throws.
 */
export function limitResetMs(text: string, nowIso: string): number | undefined {
  const m = RESET.exec(text);
  const now = Date.parse(nowIso);
  if (!m || !Number.isFinite(now)) return undefined;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h < 1 || h > 12 || min > 59 || !isIanaName(m[4]!)) return undefined;
  const hour = (h % 12) + (m[3]!.toLowerCase() === 'pm' ? 12 : 0);
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: m[4]!, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  } catch {
    return undefined;
  }
  /** The wall clock of the zone at instant `t`, written as if it were UTC. */
  const wall = (t: number): number => {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p['year']!, p['month']! - 1, p['day']!, p['hour']!, p['minute']!, p['second']!);
  };
  const offset = (t: number): number => wall(t) - (t - (((t % 1000) + 1000) % 1000));
  const today = new Date(wall(now));
  for (let d = 0; d <= 2; d++) {
    const target = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + d, hour, min);
    // The offsets a day either side bound the offset at the target: a zone changes its offset at most once a day.
    const candidates = [target - offset(target - DAY), target - offset(target + DAY)].sort((a, b) => a - b);
    // A time a daylight-saving end repeats has two exact candidates: the earliest still ahead decides, and when both have
    // passed the next day does. A time with no exact candidate is in a gap and waits until its end.
    const exact = candidates.filter((t) => wall(t) === target);
    const at = exact.length > 0 ? exact.find((t) => t > now) : gapEnd(candidates[0]!, candidates[1]!, offset);
    if (at !== undefined && at > now) return at - now;
  }
  return undefined;
}

/** The first whole second in (lo, hi] whose offset is the offset at `hi`: where the wall clock jumps over the gap. */
function gapEnd(lo: number, hi: number, offset: (t: number) => number): number {
  const after = offset(hi);
  let a = lo;
  let b = hi;
  while (b - a > 1000) {
    const mid = a + Math.floor((b - a) / 2000) * 1000;
    if (offset(mid) === after) b = mid;
    else a = mid;
  }
  return b;
}
