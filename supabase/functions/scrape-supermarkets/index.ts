import { createRemoteJWKSet, decodeJwt, jwtVerify } from "npm:jose@5.9.6";

type ScrapedProduct = {
  supermarket: string;
  externalId: string;
  name: string;
  brand?: string;
  category?: string;
  url: string;
  imageUrl?: string;
  regularPrice?: number;
  offerPrice: number;
  unit?: string;
  unitPrice?: number;
  stock?: boolean;
};

const TEAM_SLUG = "tsebastian-oss-projects";
const PROJECT_NAME = "preciospmk";
const EXPECTED_AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const EXPECTED_SUBJECT = `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:production`;
const ALLOWED_ISSUERS = new Set([
  "https://oidc.vercel.com",
  `https://oidc.vercel.com/${TEAM_SLUG}`
]);
const JWKS = createRemoteJWKSet(new URL("https://oidc.vercel.com/.well-known/jwks"));

const TARGETS = [
  { supermarket: "Lider", url: "https://www.lider.cl/supermercado/category/Despensa" },
  { supermarket: "Jumbo", url: "https://www.jumbo.cl/despensa" },
  { supermarket: "Santa Isabel", url: "https://www.santaisabel.cl/despensa" },
  { supermarket: "Unimarc", url: "https://www.unimarc.cl/category/despensa" }
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function verifyVercelOidc(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("Missing Vercel OIDC token");

  const unverified = decodeJwt(token);
  const issuer = typeof unverified.iss === "string" ? unverified.iss : "";
  const audience = Array.isArray(unverified.aud) ? unverified.aud : [unverified.aud];
  if (!ALLOWED_ISSUERS.has(issuer)) throw new Error("Unexpected OIDC issuer");
  if (!audience.includes(EXPECTED_AUDIENCE)) throw new Error("Unexpected OIDC audience");
  if (unverified.sub !== EXPECTED_SUBJECT) throw new Error("Unexpected OIDC subject");

  await jwtVerify(token, JWKS, {
    issuer,
    audience: EXPECTED_AUDIENCE,
    subject: EXPECTED_SUBJECT
  });
}

function money(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scripts(html: string): string[] {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  return Array.from(matches, (match) => match[1].trim());
}

function productNodes(raw: unknown): unknown[] {
  const roots = Array.isArray(raw) ? raw : [raw];
  const output: unknown[] = [];
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    const node = root as Record<string, unknown>;
    if (node["@type"] === "Product") output.push(node);
    const list = node.itemListElement;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === "object" && "item" in item) {
          output.push((item as { item: unknown }).item);
        } else {
          output.push(item);
        }
      }
    }
    const graph = node["@graph"];
    if (Array.isArray(graph)) output.push(...productNodes(graph));
  }
  return output;
}

async function scrapeJsonLdCollection(supermarket: string, url: string): Promise<ScrapedProduct[]> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; MGPPriceMonitor/1.0; +https://mgpconsultoria.cl)",
      accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`${supermarket}: HTTP ${response.status}`);

  const html = await response.text();
  const results: ScrapedProduct[] = [];
  for (const script of scripts(html)) {
    try {
      const parsed = JSON.parse(script) as unknown;
      for (const candidate of productNodes(parsed)) {
        if (!candidate || typeof candidate !== "object") continue;
        const product = candidate as Record<string, unknown>;
        if (typeof product.name !== "string") continue;
        const rawOffers = product.offers;
        const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
        const offers = offer && typeof offer === "object" ? offer as Record<string, unknown> : {};
        const price = money(offers.price ?? offers.lowPrice);
        if (!price) continue;
        const productUrl = typeof product.url === "string" ? product.url : url;
        const brand = typeof product.brand === "string"
          ? product.brand
          : product.brand && typeof product.brand === "object" && "name" in product.brand
            ? String((product.brand as { name: unknown }).name)
            : undefined;
        const image = Array.isArray(product.image) ? product.image[0] : product.image;

        results.push({
          supermarket,
          externalId: String(product.sku ?? product.productID ?? productUrl),
          name: product.name,
          brand,
          category: typeof product.category === "string" ? product.category : undefined,
          url: productUrl,
          imageUrl: typeof image === "string" ? image : undefined,
          offerPrice: price,
          regularPrice: money(offers.highPrice),
          stock: offers.availability ? !String(offers.availability).includes("OutOfStock") : undefined
        });
      }
    } catch {
      // Retailers sometimes emit malformed JSON-LD. Continue with the next block.
    }
  }
  return results;
}

async function runScrapers() {
  const products: ScrapedProduct[] = [];
  const errors: string[] = [];
  for (const target of TARGETS) {
    try {
      products.push(...await scrapeJsonLdCollection(target.supermarket, target.url));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { products, errors };
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service credentials are unavailable");

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Supabase RPC ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await verifyVercelOidc(req);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unauthorized" }, 401);
  }

  try {
    const canRun = await rpc<boolean>("scrape_service_status", {});
    if (!canRun) return json({ error: "A scraping run was completed recently. Try again later." }, 429);

    const startedAt = new Date().toISOString();
    const { products, errors } = await runScrapers();
    const result = await rpc<{ products_found: number }>("ingest_scrape_service", {
      p_started_at: startedAt,
      p_products: products.map((item) => ({
        supermarket: item.supermarket,
        external_id: item.externalId,
        name: item.name,
        brand: item.brand ?? null,
        category: item.category ?? null,
        url: item.url,
        image_url: item.imageUrl ?? null,
        regular_price: item.regularPrice ?? null,
        offer_price: item.offerPrice,
        unit: item.unit ?? null,
        unit_price: item.unitPrice ?? null,
        in_stock: item.stock ?? true,
        observed_at: new Date().toISOString()
      })),
      p_errors: errors
    });

    return json({
      ok: errors.length === 0,
      productsFound: result.products_found,
      errors
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
