# FlagCounter Total Worker

This Cloudflare Worker reads the public FlagCounter country pages for `Y8Lt`,
sums the country visitor totals (including Unknown), and returns JSON for the
homepage flip counter. It follows pagination automatically and parses the HTML
visitor cells independently of the country links.

Expected response:

```json
{
  "source": "flagcounter",
  "counterId": "Y8Lt",
  "total": 5992,
  "updatedAt": "2026-11-17T17:00:00.000Z",
  "stale": false
}
```

Deploy from this folder:

```bash
cd workers
npx wrangler deploy
```

If the Cloudflare session has expired, run `npx wrangler login` first and
complete the browser sign-in.

Run the regression tests from this folder with `npm ci` followed by `npm test`.

Permanent deployed URL:

```text
https://nakulrampal-flagcounter-total.nakulrampal.workers.dev
```

Paste the deployed Worker URL into `index.html`:

```html
data-count-endpoint="https://nakulrampal-flagcounter-total.nakulrampal.workers.dev"
```

Totals refresh at most once a minute. The Worker retains the last successful
result in its edge cache for up to seven days and returns `stale: true` if an
upstream request fails. Incomplete or zero totals are never cached.

The homepage refreshes once a minute while visible and when the tab is reopened.
It also saves the last valid total in browser storage. If neither a saved nor a
live total is available, it shows dashes instead of an invented number. Clicking
the flip counter continues to open the original FlagCounter visitor map.
