export type Source = 'greenhouse' | 'lever' | 'ashby';
export type Stack = 'go' | 'java';
export type Region = 'us' | 'other' | 'unknown';
export type Verdict = 'hiring' | 'unclear' | 'unlikely' | 'insufficient' | 'closed';

export interface Company {
  readonly source: Source;
  readonly token: string;
  readonly name: string;
}

/** A posting exactly as a job board returned it, normalised to one shape. */
export interface RawJob {
  readonly source: Source;
  readonly company: string;
  readonly companyName: string;
  readonly externalId: string;
  readonly url: string;
  readonly title: string;
  readonly locations: readonly string[];
  readonly countryHints: readonly string[];
  readonly remote: boolean;
  readonly postedAt: string | null;
  readonly description: string;
  readonly salary: string | null;
}

/** A posting that passed the Go/Java filter, with derived fields. */
export interface ClassifiedJob extends RawJob {
  readonly stacks: readonly Stack[];
  readonly region: Region;
  readonly location: string;
  readonly titleKey: string;
  readonly contentHash: string;
}

/** The part of a stored job that syncing needs. */
export interface StoredJob {
  readonly id: number;
  readonly externalId: string;
  readonly title: string;
  readonly titleKey: string;
  readonly location: string;
  readonly description: string;
  readonly contentHash: string;
  readonly salary: string | null;
  /** The earlier posting this one continues, when it is a repost. */
  readonly repostOf: number | null;
  readonly firstSeenAt: string;
  readonly closedAt: string | null;
  readonly repostCount: number;
  readonly originalPostedAt: string;
}

export interface Signal {
  readonly kind: 'good' | 'bad' | 'neutral';
  readonly text: string;
}

export interface Liveness {
  readonly verdict: Verdict;
  readonly score: number | null;
  readonly signals: readonly Signal[];
}
