/**
 * bertho-ai-search/src/index.js
 * Microservice de Recherche Web en Temps Réel & Extraction d'Actualités.
 *
 * Architecture :
 * 1. DuckDuckGo HTML
 * 2. Google News RSS
 * 3. Wikipedia API
 *
 * Aucun appel à Workers AI.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const MAX_RESULTS = 5;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidUrl(value) {
  if (!value || typeof value !== "string") {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value = "") {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

function normalizeUrl(rawUrl = "") {
  let value = decodeHtmlEntities(rawUrl.trim());

  if (!value) {
    return null;
  }

  // URL absolue
  if (isValidUrl(value)) {
    return value;
  }

  // Certaines réponses DuckDuckGo utilisent des URLs relatives.
  if (value.startsWith("//")) {
    const candidate = `https:${value}`;
    return isValidUrl(candidate) ? candidate : null;
  }

  if (value.startsWith("/")) {
    const candidate = `https://html.duckduckgo.com${value}`;
    return isValidUrl(candidate) ? candidate : null;
  }

  return null;
}

/* ============================================================
   DUCKDUCKGO
   ============================================================ */

async function searchDuckDuckGo(query) {
  const endpoint =
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTTP ${response.status}`);
  }

  const html = await response.text();

  if (!html || html.length < 500) {
    throw new Error("DuckDuckGo returned an empty or invalid response");
  }

  /*
   * Structure généralement rencontrée :
   *
   * <div class="result">
   *   <a class="result__a" href="...">Titre</a>
   *   ...
   *   <a class="result__snippet">Snippet</a>
   * </div>
   *
   * On associe titre + URL + snippet à l'intérieur
   * du même bloc de résultat afin d'éviter les décalages.
   */

  const blocks = html.match(
    /<div[^>]+class=["'][^"']*\bresult\b[^"']*["'][\s\S]*?<\/div>\s*<\/div>/gi
  ) || [];

  const results = [];

  for (const block of blocks) {
    if (results.length >= MAX_RESULTS) {
      break;
    }

    const titleMatch = block.match(
      /<a[^>]+class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );

    const snippetMatch = block.match(
      /<a[^>]+class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );

    if (!titleMatch) {
      continue;
    }

    const url = normalizeUrl(titleMatch[1]);
    const title = cleanText(titleMatch[2]);
    const snippet = cleanText(
      snippetMatch ? snippetMatch[1] : ""
    );

    if (!url || !title) {
      continue;
    }

    results.push({
      title,
      snippet,
      url,
      source: "DuckDuckGo"
    });
  }

  /*
   * Fallback de parsing si la structure des blocs change.
   * On cherche directement les liens result__a.
   */

  if (results.length === 0) {
    const matches = [
      ...html.matchAll(
        /<a[^>]+class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
      )
    ];

    for (const match of matches) {
      if (results.length >= MAX_RESULTS) {
        break;
      }

      const url = normalizeUrl(match[1]);
      const title = cleanText(match[2]);

      if (!url || !title) {
        continue;
      }

      results.push({
        title,
        snippet: "",
        url,
        source: "DuckDuckGo"
      });
    }
  }

  if (results.length === 0) {
    throw new Error(
      "DuckDuckGo response received but no valid results could be parsed"
    );
  }

  return results;
}

/* ============================================================
   GOOGLE NEWS RSS
   ============================================================ */

function extractXmlTag(xml, tag) {
  const match = xml.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i")
  );

  return match ? cleanText(match[1]) : "";
}

async function searchGoogleNews(query) {
  const endpoint =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "User-Agent": "BerthoAI-Search/1.0",
      "Accept": "application/rss+xml, application/xml, text/xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Google News HTTP ${response.status}`);
  }

  const xml = await response.text();

  if (!xml || !xml.includes("<item")) {
    throw new Error("Google News returned no RSS items");
  }

  const items =
    xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  const results = [];

  for (const item of items) {
    if (results.length >= MAX_RESULTS) {
      break;
    }

    const title = extractXmlTag(item, "title");
    const link = extractXmlTag(item, "link");
    const description = extractXmlTag(item, "description");
    const source = extractXmlTag(item, "source");

    const url = normalizeUrl(link);

    if (!title || !url) {
      continue;
    }

    results.push({
      title,
      snippet: description,
      url,
      source: source || "Google News"
    });
  }

  if (results.length === 0) {
    throw new Error(
      "Google News RSS returned no valid results"
    );
  }

  return results;
}

/* ============================================================
   WIKIPEDIA
   ============================================================ */

async function searchWikipedia(query) {
  const endpoint =
    `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${MAX_RESULTS}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "User-Agent": "BerthoAI-Search/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Wikipedia HTTP ${response.status}`);
  }

  const data = await response.json();

  const pages = data?.query?.search;

  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("Wikipedia returned no results");
  }

  const results = [];

  for (const page of pages) {
    if (results.length >= MAX_RESULTS) {
      break;
    }

    const title = cleanText(page.title);
    const snippet = cleanText(page.snippet);

    if (!title) {
      continue;
    }

    const url =
      `https://fr.wikipedia.org/wiki/${encodeURIComponent(
        page.title.replace(/ /g, "_")
      )}`;

    results.push({
      title,
      snippet,
      url,
      source: "Wikipedia"
    });
  }

  if (results.length === 0) {
    throw new Error("Wikipedia returned no valid results");
  }

  return results;
}

/* ============================================================
   DEDUPLICATION
   ============================================================ */

function deduplicateResults(results) {
  const seen = new Set();
  const unique = [];

  for (const result of results) {
    if (!result?.url || !isValidUrl(result.url)) {
      continue;
    }

    const key = result.url.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(result);

    if (unique.length >= MAX_RESULTS) {
      break;
    }
  }

  return unique;
}

/* ============================================================
   SEARCH ORCHESTRATOR
   ============================================================ */

async function performSearch(query) {
  const attempts = [
    {
      provider: "duckduckgo",
      fallback: false,
      execute: () => searchDuckDuckGo(query)
    },
    {
      provider: "google_news_rss",
      fallback: true,
      execute: () => searchGoogleNews(query)
    },
    {
      provider: "wikipedia",
      fallback: true,
      execute: () => searchWikipedia(query)
    }
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      console.log(
        `[Search] Tentative provider: ${attempt.provider}`
      );

      const results = deduplicateResults(
        await attempt.execute()
      );

      if (results.length > 0) {
        return {
          provider: attempt.provider,
          fallback: attempt.fallback,
          results,
          errors
        };
      }

      errors.push({
        provider: attempt.provider,
        error: "no_valid_results"
      });
    } catch (error) {
      console.warn(
        `[Search] ${attempt.provider} failed:`,
        error?.message || String(error)
      );

      errors.push({
        provider: attempt.provider,
        error: error?.message || String(error)
      });
    }
  }

  return {
    provider: null,
    fallback: false,
    results: [],
    errors
  };
}

/* ============================================================
   WORKER
   ============================================================ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS PREFLIGHT
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // 2. HEALTH CHECK
    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {
      return json({
        service: "bertho-ai-search",
        status: "online"
      });
    }

    // 3. SEARCH
    if (
      request.method === "POST" &&
      (url.pathname === "/" || url.pathname === "/search")
    ) {
      try {
        const body = await request.json();

        const query = body.query || body.message;

        if (
          !query ||
          typeof query !== "string" ||
          !query.trim()
        ) {
          return json(
            {
              success: false,
              error: "query_required"
            },
            400
          );
        }

        const cleanQuery = query.trim();

        const search = await performSearch(cleanQuery);

        if (search.results.length === 0) {
          return json(
            {
              success: false,
              error: "search_unavailable",
              query: cleanQuery,
              resultsCount: 0,
              results: [],
              providersAttempted: search.errors,
              timestamp: new Date().toISOString()
            },
            503
          );
        }

        return json({
          success: true,
          query: cleanQuery,
          provider: search.provider,
          fallback: search.fallback,
          resultsCount: search.results.length,
          results: search.results,
          ...(search.errors.length > 0
            ? {
                providerWarnings: search.errors
              }
            : {}),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error(
          "[Live Search Error]:",
          error
        );

        return json(
          {
            success: false,
            error: error?.message || "search_failed"
          },
          500
        );
      }
    }

    return json(
      {
        success: false,
        error: "route_not_found"
      },
      404
    );
  }
};