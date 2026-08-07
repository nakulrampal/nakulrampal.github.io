# FlagCounter Total Worker

This Cloudflare Worker reads the public FlagCounter country pages for `Y8Lt`,
sums the country visitor totals, and returns JSON for the homepage flip counter.

Expected response:

```json
{
  "source": "flagcounter",
  "counterId": "Y8Lt",
  "total": 5360,
  "updatedAt": "2026-08-07T00:00:00.000Z"
}
```

Deploy from this folder:

```bash
cd workers
npx wrangler deploy
```

Permanent deployed URL:

```text
https://nakulrampal-flagcounter-total.nakulrampal.workers.dev
```

Paste the deployed Worker URL into `index.html`:

```html
data-count-endpoint="https://nakulrampal-flagcounter-total.nakulrampal.workers.dev"
```

The homepage will continue to fall back to `data-visitor-count` if the Worker is
not configured or temporarily unavailable.
