# jobs42

MVP feature for WOW42: a feed of Go and Java engineering jobs in the US, read straight from company career
boards, where every posting is rated on whether the company is still hiring for it. Each posting links into
WOW42 interview prep.

## Run

Needs Node 24 or newer. There are no runtime dependencies.

```bash
npm install          # only TypeScript, for the type check
npm run ingest       # read every board in companies.json once
npm run serve        # feed at http://127.0.0.1:4242, re-reads the boards every 4 hours
npm test
npm run typecheck
```

Settings are environment variables; `node src/cli.ts` prints the list.

## How it works

1. **Collect.** `companies.json` lists boards on Greenhouse, Lever and Ashby. Their public JSON APIs return
   every open posting of a company.
2. **Filter.** `src/classify.ts` keeps engineering titles that name Go or Java, and marks the region
   (`us`, `other`, `unknown`).
3. **Track.** `src/sync.ts` compares the board with what is stored: new postings, edits to title, text or pay,
   postings that left the board, and postings that came back under a new link (same title, 80% of the same
   wording, closed within 180 days). A repost keeps the original publication date.
4. **Rate.** `src/liveness.ts` turns that history into a score from 0 to 100 and a verdict. The rules are
   fixed, so the same history always gives the same score, and each verdict lists its reasons.

| Signal | Effect on the score |
|---|---|
| Open 31-60 / 61-90 / 91-180 / over 180 days | -15 / -30 / -45 / -60 |
| Reposted once / more than once | -15 / -30 |
| Tracked for over 60 days and the text never changed | -10 |
| Text edited in the last 30 days | +10 |
| Open longer than 90% of open postings | -15 |
| Title reads like a talent pool | -40 |

75 and above is "Actively hiring", 45-74 "Unclear", below 45 "Unlikely to be hiring". A posting with no
publication date and under 14 days of history gets no verdict.

## Endpoints

| Path | Returns |
|---|---|
| `/` | Feed. Query: `q`, `stack=go\|java`, `region=all`, `live=1`, `remote=1`, `page` |
| `/jobs/:id` | Posting with the reasons for its rating and its history |
| `/api/jobs` | The same feed as JSON: `{success, data, error, meta: {total, page, limit}}` |
| `/api/jobs/:id` | Posting with `events` |
| `/healthz` | Counts and the time of the last board read |

## Company hiring report (sales leads)

```bash
npm run discover   # look up boards for the names in discovery/candidates.txt, add them to companies.json
npm run ingest     # INGEST_CONCURRENCY=8 speeds it up for a long list
npm run report     # writes reports/leads.csv (git-ignored)
```

One row per company with at least 3 open US Go/Java roles:

| Column | Meaning |
|---|---|
| `segment` | Company size by all open roles on its board: small (<100), mid (100-299), large (300+) |
| `go_java_open`, `go_open`, `java_open` | Open US roles naming Go or Java |
| `new_30d` | Published in the last 30 days: budget and active hiring |
| `open_90_365d` | Open 3-12 months: roles they struggle to fill |
| `open_365d_plus` | Open over a year: usually evergreen pipelines, not counted in the score |
| `reposted` | Taken down and posted again under a new link |
| `score` | `new_30d × 2 + open_90_365d + reposted × 3` |

Cells that would start a spreadsheet formula are prefixed with a quote. Repost counts only build up after
several weeks of regular runs.

## Not done yet

- The prep link is `https://wow42.tech/?job=<posting URL>` by default. WOW42 does not handle that parameter
  yet; set `WOW42_PREP_URL` once it has a real entry point.
- Repost and edit signals only build up as the service keeps running. On the first run the rating rests on
  the publication date alone.
- No rate limiting or authentication: put it behind the WOW42 gateway before exposing it.
- Boards that answered slower than 30 seconds during selection (Asana, Samsara, Toast, Roblox, Anduril) are
  not in the list. Workday and other career systems are not supported.
