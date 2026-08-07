const FLAGCOUNTER_ID = "Y8Lt";
const FLAGCOUNTER_PAGES = [
  `https://s01.flagcounter.com/countries/${FLAGCOUNTER_ID}/`,
  `https://s01.flagcounter.com/countries/${FLAGCOUNTER_ID}/2`,
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function parseVisitorRows(html) {
  let total = 0;
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  rows.forEach((row) => {
    const text = row
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (row.includes(`/factbook/`) && row.includes(`/${FLAGCOUNTER_ID}`)) {
      const visitorCell = row.match(
        /<td\s+width=1%>\s*<font[^>]*>\s*([0-9,]+)\s*<\/font>\s*<\/td>/i
      );
      if (visitorCell) {
        total += Number(visitorCell[1].replace(/,/g, ""));
      }
    }
  });

  return total;
}

async function fetchFlagCounterTotal() {
  const pages = await Promise.all(
    FLAGCOUNTER_PAGES.map(async (url) => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 visitor-count-fetcher",
        },
      });
      if (!response.ok) {
        throw new Error(`FlagCounter returned ${response.status} for ${url}`);
      }
      return response.text();
    })
  );

  return pages.reduce((sum, html) => sum + parseVisitorRows(html), 0);
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    try {
      const total = await fetchFlagCounterTotal();
      return Response.json(
        {
          source: "flagcounter",
          counterId: FLAGCOUNTER_ID,
          total,
          updatedAt: new Date().toISOString(),
        },
        {
          headers: {
            ...corsHeaders,
            "Cache-Control": "public, max-age=300",
          },
        }
      );
    } catch (error) {
      return Response.json(
        {
          error: "Unable to fetch FlagCounter total",
          message: error.message,
        },
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Cache-Control": "no-store",
          },
        }
      );
    }
  },
};
