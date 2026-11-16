export type FetchJson = (url: string) => Promise<unknown>;

const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'jobs42/0.1';

/** GETs a URL and returns its parsed JSON body; throws on a non-2xx status, a timeout or invalid JSON. */
export const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  }
  return (await response.json()) as unknown;
};
