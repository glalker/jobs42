import type { Liveness, Signal, Verdict } from './types.ts';

export interface LivenessFacts {
  readonly now: string;
  readonly title: string;
  /** False when the board gave no publication date and the history starts at our first sight. */
  readonly postedAtKnown: boolean;
  /** Earliest publication across the whole repost chain. */
  readonly originalPostedAt: string;
  readonly firstSeenAt: string;
  readonly closedAt: string | null;
  readonly repostCount: number;
  readonly textChangeCount: number;
  readonly lastTextChangeAt: string | null;
  /** Share of open postings that are younger than this one, or null when the sample is too small. */
  readonly agePercentile: number | null;
}

const MS_PER_DAY = 86_400_000;
const FULL_SCORE = 100;

const FRESH_DAYS = 30;
const AGING_DAYS = 60;
const STALE_DAYS = 90;
const ABANDONED_DAYS = 180;
const AGING_PENALTY = 15;
const STALE_PENALTY = 30;
const VERY_STALE_PENALTY = 45;
const ABANDONED_PENALTY = 60;

const SINGLE_REPOST_PENALTY = 15;
const MULTIPLE_REPOST_PENALTY = 30;

const NEVER_EDITED_PENALTY = 10;
const RECENT_EDIT_DAYS = 30;
const RECENT_EDIT_BONUS = 10;

const OUTLIER_PERCENTILE = 0.9;
const OUTLIER_PENALTY = 15;

const TALENT_POOL_PENALTY = 40;
const TALENT_POOL_TITLE =
  /talent (?:pool|community|network)|future opportunit|general application|evergreen|expression of interest|always hiring/i;

const MIN_OBSERVED_DAYS = 14;
const HIRING_SCORE = 75;
const UNCLEAR_SCORE = 45;

interface Rule {
  readonly delta: number;
  readonly signal: Signal;
}

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / MS_PER_DAY));
}

function inDays(count: number): string {
  return count === 1 ? '1 day' : `${count} days`;
}

function ageRule(facts: LivenessFacts, ageDays: number): Rule {
  if (ageDays <= FRESH_DAYS) {
    const verb = facts.postedAtKnown ? 'Posted' : 'First seen';
    const when = ageDays === 0 ? 'today' : `${inDays(ageDays)} ago`;
    return { delta: 0, signal: { kind: 'good', text: `${verb} ${when}` } };
  }
  const text = `Open for ${inDays(ageDays)}`;
  if (ageDays <= AGING_DAYS) return { delta: -AGING_PENALTY, signal: { kind: 'neutral', text } };
  if (ageDays <= STALE_DAYS) return { delta: -STALE_PENALTY, signal: { kind: 'bad', text } };
  if (ageDays <= ABANDONED_DAYS) return { delta: -VERY_STALE_PENALTY, signal: { kind: 'bad', text } };
  return { delta: -ABANDONED_PENALTY, signal: { kind: 'bad', text } };
}

function repostRule(facts: LivenessFacts): Rule | null {
  if (facts.repostCount === 0) return null;
  const times = facts.repostCount === 1 ? 'once' : `${facts.repostCount} times`;
  return {
    delta: facts.repostCount === 1 ? -SINGLE_REPOST_PENALTY : -MULTIPLE_REPOST_PENALTY,
    signal: { kind: 'bad', text: `Reposted ${times}, first published ${facts.originalPostedAt.slice(0, 10)}` },
  };
}

function editRule(facts: LivenessFacts, observedDays: number): Rule | null {
  if (facts.lastTextChangeAt !== null) {
    const editedDaysAgo = daysBetween(facts.lastTextChangeAt, facts.now);
    if (editedDaysAgo > RECENT_EDIT_DAYS) return null;
    return {
      delta: RECENT_EDIT_BONUS,
      signal: { kind: 'good', text: `Description updated ${inDays(editedDaysAgo)} ago` },
    };
  }
  // Only our own observation can show that nothing changed, so the posting age alone is not enough.
  if (facts.textChangeCount > 0 || observedDays <= AGING_DAYS) return null;
  return {
    delta: -NEVER_EDITED_PENALTY,
    signal: { kind: 'bad', text: `Description has not changed in the ${inDays(observedDays)} we have tracked it` },
  };
}

function outlierRule(facts: LivenessFacts): Rule | null {
  if (facts.agePercentile === null || facts.agePercentile < OUTLIER_PERCENTILE) return null;
  const percent = Math.round(facts.agePercentile * 100);
  return {
    delta: -OUTLIER_PENALTY,
    signal: { kind: 'bad', text: `Open longer than ${percent}% of open Go/Java roles` },
  };
}

function talentPoolRule(facts: LivenessFacts): Rule | null {
  if (!TALENT_POOL_TITLE.test(facts.title)) return null;
  return {
    delta: -TALENT_POOL_PENALTY,
    signal: { kind: 'bad', text: 'Looks like a talent pool rather than a specific opening' },
  };
}

function verdictFor(score: number): Verdict {
  if (score >= HIRING_SCORE) return 'hiring';
  return score >= UNCLEAR_SCORE ? 'unclear' : 'unlikely';
}

/** Rule-based verdict on whether a posting is actively hired for. The same facts always give the same result. */
export function assessLiveness(facts: LivenessFacts): Liveness {
  if (facts.closedAt !== null) {
    const text = `Closed ${facts.closedAt.slice(0, 10)}`;
    return { verdict: 'closed', score: null, signals: [{ kind: 'neutral', text }] };
  }
  const observedDays = daysBetween(facts.firstSeenAt, facts.now);
  if (!facts.postedAtKnown && facts.repostCount === 0 && observedDays < MIN_OBSERVED_DAYS) {
    const text = `No publication date, and only ${inDays(observedDays)} of history so far`;
    return { verdict: 'insufficient', score: null, signals: [{ kind: 'neutral', text }] };
  }
  const ageDays = daysBetween(facts.originalPostedAt, facts.now);
  const rules = [
    ageRule(facts, ageDays),
    repostRule(facts),
    editRule(facts, observedDays),
    outlierRule(facts),
    talentPoolRule(facts),
  ].filter((rule): rule is Rule => rule !== null);
  const total = rules.reduce((sum, rule) => sum + rule.delta, FULL_SCORE);
  const score = Math.min(FULL_SCORE, Math.max(0, total));
  return { verdict: verdictFor(score), score, signals: rules.map((rule) => rule.signal) };
}
