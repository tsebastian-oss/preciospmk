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

type RetailTarget = {
  supermarket: string;
  url: string;
};

const JSON_LD_TARGETS: RetailTarget[] = [
  { supermarket: "Lider", url: "https://super.lider.cl/v/productos-de-despensa-y-abarrotes" },
  { supermarket: "Jumbo", url: "https://www.jumbo.cl/despensa" }
];

const UNIMARC_TARGET: RetailTarget = {
  supermarket: "Unimarc",
  url: "https://www.unimarc.cl/category/despensa"
};

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
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function scripts(html: string): string[] {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  return Array.from(matches, (match) => match[1].trim());
}

function productNodes(raw: unknown): unknown[] {
  const roots = Array.isArray(raw) ? raw : [raw];
  const output: unknown[] = [];
  for (const root of roots) {
    const node = asRecord(root);
    if (!node) continue;
    if (node["@type"] === "Product") output.push(node);

    const list = node.itemListElement;
    if (Array.isArray(list)) {
      for (const item of list) {
        const record = asRecord(item);
        output.push(record && "item" in record ? record.item : item);
      }
    }

    const graph = node["@graph"];
    if (Array.isArray(graph)) output.push(...productNodes(graph));
  }
  return output;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; MGPPriceMonitor/1.0; +https://mgpconsultoria.cl)",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "es-CL,es;q=0.9,en;q=0.7"
    },
    signal: AbortSignal.timeout(25_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function scrapeJsonLdCollection(supermarket: string, url: string): Promise<ScrapedProduct[]> {
  const html = await fetchHtml(url);
  const results: ScrapedProduct[] = [];

  for (const script of scripts(html)) {
    try {
      const parsed = JSON.parse(script) as unknown;
      for (const candidate of productNodes(parsed)) {
        const product = asRecord(candidate);
        if (!product) continue;
        const name = text(product.name);
        if (!name) continue;

        const rawOffers = product.offers;
        const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
        const offers = asRecord(offer) ?? {};
        const price = money(offers.price ?? offers.lowPrice);
        if (!price || price <= 0) continue;

        const productUrl = text(product.url) ?? url;
        const rawBrand = product.brand;
        const brandObject = asRecord(rawBrand);
        const brand = text(rawBrand) ?? text(brandObject?.name);
        const image = Array.isArray(product.image) ? product.image[0] : product.image;

        results.push({
          supermarket,
          externalId: String(product.sku ?? product.productID ?? productUrl),
          name,
          brand,
          category: text(product.category),
          url: productUrl,
          imageUrl: text(image),
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

function santaRenderData(html: string): Record<string, unknown> {
  const match = html.match(/window\.__renderData\s*=\s*("(?:\\.|[^"\\])*")\s*;/s);
  if (!match) throw new Error("window.__renderData not found");

  const encoded = JSON.parse(match[1]);
  if (typeof encoded !== "string") throw new Error("Invalid window.__renderData payload");

  const parsed = JSON.parse(encoded);
  const record = asRecord(parsed);
  if (!record) throw new Error("Invalid Santa Isabel hydration data");
  return record;
}

async function scrapeSantaIsabel(): Promise<ScrapedProduct[]> {
  const html = await fetchHtml("https://www.santaisabel.cl/");
  const root = santaRenderData(html);
  const productGroups = asRecord(root.products);
  if (!productGroups) return [];

  const results = new Map<string, ScrapedProduct>();

  for (const groupValue of Object.values(productGroups)) {
    const group = asRecord(groupValue);
    const products = group?.products;
    if (!Array.isArray(products)) continue;

    for (const productValue of products) {
      const product = asRecord(productValue);
      if (!product) continue;

      const productName = text(product.productName) ?? text(product.name);
      const productId = text(product.productId);
      const brand = text(product.brand);
      const linkText = text(product.linkText);
      const items = product.items;
      if (!productName || !Array.isArray(items)) continue;

      for (const itemValue of items) {
        const item = asRecord(itemValue);
        if (!item) continue;

        const sellers = item.sellers;
        const seller = Array.isArray(sellers) ? asRecord(sellers[0]) : undefined;
        const offer = asRecord(seller?.commertialOffer);
        const offerPrice = money(offer?.Price);
        if (!offerPrice || offerPrice <= 0) continue;

        const externalId = text(item.itemId) ?? productId;
        if (!externalId) continue;

        const images = item.images;
        const image = Array.isArray(images) ? asRecord(images[0]) : undefined;
        const availableQuantity = money(offer?.AvailableQuantity);
        const listPrice = money(offer?.ListPrice);
        const unitMultiplier = money(item.unitMultiplier);
        const measurementUnit = text(item.measurementUnit);
        const productUrl = linkText
          ? `https://www.santaisabel.cl/${linkText.replace(/^\/+/, "")}/p`
          : `https://www.santaisabel.cl/busqueda?ft=${encodeURIComponent(productName)}`;

        results.set(externalId, {
          supermarket: "Santa Isabel",
          externalId,
          name: text(item.name) ?? productName,
          brand,
          url: productUrl,
          imageUrl: text(image?.imageUrl),
          regularPrice: listPrice && listPrice > offerPrice ? listPrice : undefined,
          offerPrice,
          unit: measurementUnit,
          unitPrice: unitMultiplier && unitMultiplier > 1 ? offerPrice / unitMultiplier : undefined,
          stock: availableQuantity === undefined ? undefined : availableQuantity > 0
        });
      }
    }
  }

  return Array.from(results.values());
}

function deduplicate(products: ScrapedProduct[]): ScrapedProduct[] {
  const unique = new Map<string, ScrapedProduct>();
  for (const product of products) {
    unique.set(`${product.supermarket}:${product.externalId}`, product);
  }
  return Array.from(unique.values());
}

async function runScrapers() {
  const products: ScrapedProduct[] = [];
  const errors: string[] = [];
  const sources: Record<string, number> = {};

  for (const target of JSON_LD_TARGETS) {
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

  try {
    const found = await scrapeSantaIsabel();
    sources["Santa Isabel"] = found.length;
    products.push(...found);
    if (found.length === 0) errors.push("Santa Isabel: no hydrated products found");
  } catch (error) {
    sources["Santa Isabel"] = 0;
    errors.push(`Santa Isabel: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const found = await scrapeJsonLdCollection(UNIMARC_TARGET.supermarket, UNIMARC_TARGET.url);
    sources.Unimarc = found.length;
    products.push(...found);
    if (found.length === 0) errors.push("Unimarc: no JSON-LD products found");
  } catch (error) {
    sources.Unimarc = 0;
    errors.push(`Unimarc: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { products: deduplicate(products), errors, sources };
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
