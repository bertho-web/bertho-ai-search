/**
 * bertho-ai-search/src/index.js
 * Microservice de Recherche Web en Temps Réel & Extraction d'Actualités (0 Émoji).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: corsHeaders
  });
}

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
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: "bertho-ai-search",
        status: "online"
      });
    }
    
    // 3. ROUTE DE RECHERCHE EN DIRECT (POST / ou POST /search)
    if (request.method === "POST") {
      try {
        const body = await request.json();
        const query = body.query || body.message;
        
        if (!query || typeof query !== "string" || !query.trim()) {
          return json({ success: false, error: "query_required" }, 400);
        }
        
        const cleanQuery = encodeURIComponent(query.trim());
        const searchEndpoint = `https://html.duckduckgo.com/html/?q=${cleanQuery}`;
        
        // Interrogation du flux d'actualités en direct
        const response = await fetch(searchEndpoint, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
        
        const html = await response.text();
        
        // Extraction des résultats réels (titres, résumés et liens)
        const results = [];
        const resultRegex = /<a class="result__snippet[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
        const titleRegex = /<a class="result__url[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
        
        let match;
        let count = 0;
        
        // Parsing léger et rapide des extraits textuels
        const snippetMatches = [...html.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/gi)];
        const linkMatches = [...html.matchAll(/<a class="result__url"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi)];
        
        for (let i = 0; i < Math.min(snippetMatches.length, 5); i++) {
          const rawSnippet = snippetMatches[i] ? snippetMatches[i][1].replace(/<[^>]+>/g, "").trim() : "";
          const rawUrl = linkMatches[i] ? linkMatches[i][1].trim() : "";
          
          if (rawSnippet) {
            results.push({
              title: `Source ${i + 1}`,
              snippet: rawSnippet,
              url: rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`
            });
          }
        }
        
        return json({
          success: true,
          query: query.trim(),
          resultsCount: results.length,
          results: results,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error("[Live Search Error]:", error);
        return json({
          success: false,
          error: error.message || "search_failed"
        }, 500);
      }
    }
    
    return json({ success: false, error: "route_not_found" }, 404);
  }
};