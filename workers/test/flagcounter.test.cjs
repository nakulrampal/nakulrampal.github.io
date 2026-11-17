const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { Miniflare, Response } = require("miniflare");

const endpoint = "https://counter.example/";

function countryPage(start, end, total, counts, next = []) {
  return `<table><tr><td colspan="4">Countries ${start} - ${end} of ${total}.</td></tr>` +
    counts.map(count => `<tr><td><a href="https://en.wikipedia.org/wiki/Example">Country</a></td>` +
      `<td width=1%><font>${count}</font></td></tr>`).join("") +
    `<tr style="display:none"><td><table><tr><td width="100">999</td></tr></table></td></tr></table>` +
    next.map(page => `<a href="/countries/Y8Lt/${page}?">${page}</a>`).join("");
}

function runtime(t, handler) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: path.resolve(__dirname, "../flagcounter-total.js"),
    // Latest compatibility date supported by the pinned test runtime.
    compatibilityDate: "2026-08-06",
    outboundService: handler,
  });
  t.after(() => mf.dispose());
  return mf;
}

test("sums modern country pages, extra pages and Unknown without double-counting regions", async t => {
  const visited = [];
  const pages = {
    "/countries/Y8Lt/": countryPage(1, 1, 3, ["1,<b>2</b>34"], [2, 3]),
    "/countries/Y8Lt/2": countryPage(2, 2, 3, ["5"], [3]),
    "/countries/Y8Lt/3": countryPage(3, 3, 3, ["6", "2"]),
  };
  const mf = runtime(t, request => {
    const route = new URL(request.url).pathname;
    visited.push(route);
    assert.ok(pages[route], "Unexpected upstream page: " + route);
    return new Response(pages[route], { headers: { "Content-Type": "text/html" } });
  });
  const response = await mf.dispatchFetch(endpoint);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 1247);
  assert.equal(data.stale, false);
  assert.equal(visited.length, 3);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

for (const [name, html] of [
  ["upstream busy page", "<html>Server too busy</html>"],
  ["missing country rows", countryPage(1, 2, 2, ["5"])],
  ["missing pagination links", countryPage(1, 1, 2, ["5"])],
  ["zero total", countryPage(1, 1, 1, ["0"])],
]) {
  test("rejects " + name + " instead of displaying a misleading total", async t => {
    const mf = runtime(t, () => new Response(html));
    const response = await mf.dispatchFetch(endpoint);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).total, undefined);
  });
}

test("does not return a partial total when another country page fails", async t => {
  const mf = runtime(t, request => new URL(request.url).pathname.endsWith("/2")
    ? new Response("Unavailable", { status: 503 })
    : new Response(countryPage(1, 1, 2, ["20"], [2])));
  const response = await mf.dispatchFetch(endpoint);
  assert.equal(response.status, 502);
});

test("rejects duplicate page contents rather than counting the same countries twice", async t => {
  const mf = runtime(t, () => new Response(countryPage(1, 1, 2, ["20"], [2])));
  const response = await mf.dispatchFetch(endpoint);
  assert.equal(response.status, 502);
});

test("keeps the last successful total during an upstream outage", async t => {
  const mf = runtime(t, () => new Response("Unavailable", { status: 503 }));
  const cache = (await mf.getCaches()).default;
  const updatedAt = new Date(Date.now() - 120_000).toISOString();
  await cache.put(endpoint + "last-good/Y8Lt", new Response(JSON.stringify({
    source: "flagcounter", counterId: "Y8Lt", total: 5992, updatedAt, stale: false,
  }), { headers: { "Cache-Control": "public, max-age=3600" } }));
  const response = await mf.dispatchFetch(endpoint + "?t=123");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 5992);
  assert.equal(data.stale, true);
  assert.equal(data.updatedAt, updatedAt);
});

test("reuses fresh totals across browser cache-busting parameters", async t => {
  let requests = 0;
  const mf = runtime(t, () => {
    requests++;
    return new Response(countryPage(1, 1, 1, ["5992"]));
  });
  const first = await mf.dispatchFetch(endpoint + "?t=1");
  assert.equal((await first.json()).total, 5992);
  // waitUntil must finish before checking reuse of the freshly written cache.
  const cache = (await mf.getCaches()).default;
  for (let i = 0; i < 20 && !await cache.match(endpoint + "last-good/Y8Lt"); i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const next = await mf.dispatchFetch(endpoint + "?t=2");
  assert.equal((await next.json()).total, 5992);
  assert.equal(requests, 1);
});

test("handles preflight and unsupported methods without upstream requests", async t => {
  const mf = runtime(t, () => { throw new Error("Unexpected upstream request"); });
  assert.equal((await mf.dispatchFetch(endpoint, { method: "OPTIONS" })).status, 200);
  assert.equal((await mf.dispatchFetch(endpoint, { method: "POST" })).status, 405);
});
