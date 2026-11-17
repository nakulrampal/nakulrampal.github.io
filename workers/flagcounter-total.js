const FLAGCOUNTER_ID = "Y8Lt";
const COUNTRY_URL = "https://s01.flagcounter.com/countries/" + FLAGCOUNTER_ID + "/";
const FRESH_FOR_MS = 60_000;
const KEEP_FOR_SECONDS = 7 * 24 * 60 * 60;
const MAX_PAGES = 20;
const MAX_PAGE_BYTES = 1_000_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function readCountryPage(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 visitor-count-fetcher" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("FlagCounter returned " + response.status);

  const cells = [];
  const pages = new Set();
  let cell;
  let heading = "";
  let bytes = 0;
  const rewriter = new HTMLRewriter()
    .on('td[width="1%"]', {
      element() {
        cell = { text: "" };
        cells.push(cell);
      },
      text(chunk) {
        cell.text += chunk.text;
      },
    })
    .on('td[colspan="4"]', {
      text(chunk) {
        heading += chunk.text;
      },
    })
    .on("a[href]", {
      element(element) {
        const target = new URL(element.getAttribute("href"), url);
        if (target.origin !== new URL(COUNTRY_URL).origin) return;
        const page = target.pathname.match(/^\/countries\/Y8Lt\/(\d+)\/?$/);
        if (page && Number(page[1]) > 1) {
          if (Number(page[1]) > MAX_PAGES) throw new Error("Too many country pages");
          pages.add(COUNTRY_URL + Number(page[1]));
        }
      },
    });

  // Parse the streamed HTML instead of relying on country-link markup.
  await rewriter.transform(response).body.pipeTo(new WritableStream({
    write(chunk) {
      bytes += chunk.byteLength;
      if (bytes > MAX_PAGE_BYTES) throw new Error("FlagCounter page is too large");
    },
  }));

  const range = heading.match(/Countries\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/i);
  const counts = cells.map(({ text }) => {
    const value = text.trim();
    if (!/^[0-9][0-9,]*$/.test(value)) throw new Error("Invalid visitor count");
    return Number(value.replace(/,/g, ""));
  });
  if (!range) throw new Error("Missing FlagCounter country range");
  const first = Number(range[1]);
  const last = Number(range[2]);
  const countries = Number(range[3]);
  const expectedRows = last - first + 1;
  if (first < 1 || first > last || last > countries ||
      counts.length < expectedRows || counts.length > expectedRows + (last === countries ? 1 : 0)) {
    throw new Error("Incomplete FlagCounter country page");
  }
  return { total: counts.reduce((sum, count) => sum + count, 0), pages, first, last, countries };
}

async function fetchFlagCounterTotal() {
  const pending = new Set([COUNTRY_URL]);
  const visited = new Set();
  const countries = new Set();
  let expectedCountries;
  let total = 0;
  for (const url of pending) {
    if (visited.size >= MAX_PAGES) throw new Error("Too many country pages");
    const page = await readCountryPage(url);
    if (expectedCountries !== undefined && expectedCountries !== page.countries) {
      throw new Error("FlagCounter country totals changed during the request");
    }
    expectedCountries = page.countries;
    for (let country = page.first; country <= page.last; country++) {
      if (countries.has(country)) throw new Error("Duplicate FlagCounter country page");
      countries.add(country);
    }
    visited.add(url);
    total += page.total;
    for (const next of page.pages) {
      if (!visited.has(next)) pending.add(next);
    }
  }
  if (countries.size !== expectedCountries) throw new Error("Missing FlagCounter country pages");
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error("Invalid FlagCounter total");
  return total;
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "GET") return new Response("Method not allowed", {
      status: 405,
      headers: { ...corsHeaders, Allow: "GET, OPTIONS" },
    });

    // Ignore browser cache-busting parameters when looking up the last good result.
    const cacheKey = new Request(new URL("/last-good/" + FLAGCOUNTER_ID, request.url));
    let cached;
    try {
      const response = await caches.default.match(cacheKey);
      if (response) {
        const data = await response.json();
        const age = Date.now() - Date.parse(data.updatedAt);
        if (Number.isSafeInteger(data.total) && data.total > 0 &&
            age >= 0 && age < KEEP_FOR_SECONDS * 1000) {
          cached = data;
          if (age < FRESH_FOR_MS) return json(data);
        }
      }
    } catch (error) {
      console.error("Unable to read visitor-count cache", error.message);
    }

    try {
      const data = {
        source: "flagcounter",
        counterId: FLAGCOUNTER_ID,
        total: await fetchFlagCounterTotal(),
        updatedAt: new Date().toISOString(),
        stale: false,
      };
      ctx.waitUntil(caches.default.put(cacheKey, Response.json(data, {
        headers: { "Cache-Control": "public, max-age=" + KEEP_FOR_SECONDS },
      })).catch((error) => console.error("Unable to cache visitor count", error.message)));
      return json(data);
    } catch (error) {
      console.error("Unable to refresh visitor count", error.message);
      if (cached) return json({ ...cached, stale: true });
      return json({ error: "Unable to fetch FlagCounter total" }, 502);
    }
  },
};
