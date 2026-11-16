import type { FetchJson } from '../http.ts';
import type { Company, RawJob, Source } from '../types.ts';
import { ashbyUrl, parseAshby } from './ashby.ts';
import { greenhouseUrl, parseGreenhouse } from './greenhouse.ts';
import { leverUrl, parseLever } from './lever.ts';

/** Returns every posting currently on a company's board, or throws if the board could not be read. */
export type FetchBoard = (company: Company) => Promise<readonly RawJob[]>;

interface Adapter {
  readonly url: (token: string) => string;
  readonly parse: (company: Company, payload: unknown) => readonly RawJob[];
}

const ADAPTERS: Readonly<Record<Source, Adapter>> = {
  greenhouse: { url: greenhouseUrl, parse: parseGreenhouse },
  lever: { url: leverUrl, parse: parseLever },
  ashby: { url: ashbyUrl, parse: parseAshby },
};

const BOARD_TOKEN = /^[a-z0-9][a-z0-9._-]*$/i;

export function isSource(value: unknown): value is Source {
  return typeof value === 'string' && Object.hasOwn(ADAPTERS, value);
}

export function isBoardToken(value: unknown): value is string {
  return typeof value === 'string' && BOARD_TOKEN.test(value);
}

export function createBoardFetcher(fetchJson: FetchJson): FetchBoard {
  return async (company) => {
    if (!isBoardToken(company.token)) {
      throw new Error(`Invalid board token for ${company.name}`);
    }
    const adapter = ADAPTERS[company.source];
    return adapter.parse(company, await fetchJson(adapter.url(company.token)));
  };
}
