// Supabase Edge Function : récupère la vignette OpenGraph (og:image) et le titre d'une page produit.
// Appelée depuis index.html via supabaseClient.functions.invoke('og-image', { body: { url } }).
//
// Déploiement :
//   supabase functions deploy og-image --no-verify-jwt --project-ref rzobwjmccavhkouhlcph

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Refuse les adresses locales / privées pour ne pas servir de proxy vers le réseau interne
const isPublicHttpUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      host.startsWith("[")
    ) return null;
    return url;
  } catch {
    return null;
  }
};

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// Lit le contenu d'une balise <meta property|name="..." content="..."> quel que soit l'ordre des attributs
const findMeta = (html: string, keys: string[]): string | null => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key && keys.includes(key)) {
      const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
      if (content) return decodeEntities(content.trim());
    }
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  let target: URL | null = null;
  try {
    const { url } = await req.json();
    target = typeof url === "string" ? isPublicHttpUrl(url) : null;
  } catch {
    // corps invalide
  }
  if (!target) return json({ error: "URL invalide" }, 400);

  try {
    const res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        // Beaucoup de boutiques ne servent les balises OG qu'aux navigateurs / robots connus
        "User-Agent": "Mozilla/5.0 (compatible; FamilleNoelBot/1.0; +https://github.com)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) return json({ image: null, title: null, status: res.status });

    // On ne lit que le début de la page : les balises OG sont dans le <head>
    const html = (await res.text()).slice(0, 500_000);

    let image = findMeta(html, ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"]);
    if (image) image = new URL(image, res.url).toString(); // résout les URLs relatives

    const title = findMeta(html, ["og:title", "twitter:title"]) ??
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;

    return json({ image, title: title ? decodeEntities(title) : null });
  } catch (e) {
    return json({ image: null, title: null, error: String(e) });
  }
});
