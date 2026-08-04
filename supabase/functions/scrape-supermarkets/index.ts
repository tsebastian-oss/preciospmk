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

const TARGETS = [
  { supermarket: "Lider", url: "https://super.lider.cl/v/productos-de-despensa-y-abarrotes" },
  { supermarket: "Jumbo", url: "https://www.jumbo.cl/despensa" },
  { supermarket: "Santa Isabel", url: "https://www.santaisabel.cl/despensa" },
  { supermarket: "Unimarc", url: "https://www.unimarc.cl/category/despensa" }
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
      // Some retailers emit malformed JSON-LD. Continue with the next block.
    }
  }
  return results;
}

async function runScrapers() {
  const products: ScrapedProduct[] = [];
  const errors: string[] = [];
  const sources: Record<string, number> = {};

  for (const target of TARGETS) {
    try {
      const found = await scrapeJsonLdCollection(target.supermarket, target.url);
      sources[target.supermarket] = found.length;
      products.push(...found);
      if (found.length === 0) errors.push(`${target.supermarket}: no JSON-LD products found`);
    } catch (error) {
      sources[target.supermarket] = 0;
      errors.push(`${target.supermarket}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { products, errors, sources };
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
  if ((req.headers.get("content-length") ?? "0") !== "0") {
    const body = await req.text();
    if (body && body !== "{}") return json({ error: "Request body is not accepted" }, 400);
  }

  let runId: number;
  try {
    runId = await rpc<number>("start_scrape_service", {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("started recently") ? 429 : 500;
    return json({ error: message }, status);
  }

  try {
    const { products, errors, sources } = await runScrapers();
    const result = await rpc<{ run_id: number; products_found: number }>("finish_scrape_service", {
      p_run_id: runId,
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
      ok: result.products_found > 0,
      runId: result.run_id,
      productsFound: result.products_found,
      sources,
      errors
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), runId }, 500);
  }
});
