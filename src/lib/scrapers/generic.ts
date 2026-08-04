import type { ScrapedProduct } from "@/lib/types";

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

export async function scrapeJsonLdCollection(supermarket: string, url: string): Promise<ScrapedProduct[]> {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; MGPPriceMonitor/1.0; +https://mgpconsultoria.cl)",
      accept: "text/html,application/xhtml+xml"
    },
    cache: "no-store",
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
      // Some retailers emit malformed JSON-LD. Ignore that block and continue.
    }
  }
  return results;
}
