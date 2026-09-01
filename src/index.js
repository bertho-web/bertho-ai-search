/**
 * bertho-ai-code/src/index.js
 * Microservice Spécialisé en Génération de Code & Ingénierie Logicielle (DeepSeek-R1 / 70B - 0 Émoji).
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

const SYSTEM_CODE_DIRECTIVE = `
Tu es l'Architecte Logiciel et Ingénieur Développeur d'Élite de l'écosystème Bertho.
Tu es spécialisé dans la production de code informatique de niveau professionnel international.

RÈGLES STRICTES D'INGÉNIERIE :
1. Code Complet : Tout code fourni doit être 100% complet, robuste, sémantique et prêt à être déployé en production.
2. Zéro Paresse : Il est formellement interdit d'utiliser des commentaires tels que "// insérer le reste ici", "// à compléter" ou des fonctions vides.
3. Langages pris en charge : HTML5 moderne, CSS3/Flexbox/Grid, JavaScript ES Modules, TypeScript, Python, SQL, Shell, REST APIs.
4. Formatage : Fournis toujours le code dans un bloc Markdown propre avec indication exacte du langage (\`\`\`html, \`\`\`javascript, etc.).
5. Clarté : Place les explications techniques synthétiques APRÈS le bloc de code, jamais avant.
6. Refactorisation : Si du code contient des failles de sécurité ou des erreurs de performance, corrige-les directement avec explication.
`.trim();

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
        service: "bertho-ai-code",
        model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
        status: "online"
      });
    }
    
    // 3. EXÉCUTION DU CODE ENGINE (POST / ou POST /generate)
    if (request.method === "POST") {
      try {
        const body = await request.json();
        const prompt = body.prompt || body.message || body.code;
        
        if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
          return json({ success: false, error: "code_prompt_required" }, 400);
        }
        
        const targetModel = body.model === "turbo" ?
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast" :
          "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b";
        
        const messages = [
          { role: "system", content: SYSTEM_CODE_DIRECTIVE },
          { role: "user", content: prompt.trim() }
        ];
        
        const response = await env.AI.run(targetModel, {
          messages,
          max_tokens: 4096,
          temperature: 0.3 // Température basse pour une précision chirurgicale sur le code
        });
        
        let codeResult = (response && typeof response.response === "string") ?
          response.response :
          JSON.stringify(response);
        
        // Nettoyage du monologue interne DeepSeek-R1 si présent
        codeResult = codeResult.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        
        return json({
          success: true,
          model: targetModel,
          code: codeResult
        });
        
      } catch (error) {
        console.error("[Code Engine Error]:", error);
        return json({
          success: false,
          error: error.message || "code_generation_failed"
        }, 500);
      }
    }
    
    return json({ success: false, error: "route_not_found" }, 404);
  }
};