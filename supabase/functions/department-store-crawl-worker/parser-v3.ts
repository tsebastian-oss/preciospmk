type JsonRecord = Record<string, unknown>;

export type ParsedProduct = {
  supermarket: string;
  external_id: string;
  parent_external_id: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  seller: string | null;
  seller_id: string | null;
  variant: string | null;
  url: string;
  image_url: string | null;
  regular_price: number | null;
  offer_price: number;
  unit: string | null;
  unit_price: number | null;
  in_stock: boolean;
  observed_at: string;
  source_metadata: JsonRecord;
};

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let normalized = value.trim().replace(/[^0-9,.-]/g, "");
  if (!normalized) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma > dot) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, "");
  else normalized = normalized.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonLdPayloads(html: string): string[] {
  const payloads = Array.from(
    html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1].trim(),
  );
  const embedded = /"type":"application\/ld\+json","children":"((?:\\.|[^"\\])*)"/g;
  for (const match of html.matchAll(embedded)) {
    try {
      const decoded = JSON.parse(`"${match[1]}"`) as string;
      if (decoded.trim()) payloads.push(decoded);
    } catch {
      // Ignore malformed framework payloads.
    }
  }
  return payloads;
}

function types(node: JsonRecord): string[] {
  const raw = node["@type"];
  return Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
}

function collectProducts(value: unknown, output: JsonRecord[] = [], parentId: string | null = null): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectProducts(item, output, parentId);
    return output;
  }
  const node = record(value);
  if (!node) return output;
  const ownId = stringValue(node.sku) ?? stringValue(node.productID) ?? stringValue(node.mpn) ?? parentId;
  if (types(node).includes("Product")) {
    output.push(parentId && !node.isVariantOf ? { ...node, isVariantOf: { sku: parentId } } : node);
  }
  for (const key of ["hasVariant", "@graph", "itemListElement", "item"]) {
    if (node[key]) collectProducts(node[key], output, ownId);
  }
  return output;
}

function offers(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(offers);
  const item = record(value);
  if (!item) return [];
  if (item.offers) {
    const nested = offers(item.offers);
    if (nested.length) return nested;
  }
  return [item];
}

function image(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const item = record(first);
  return stringValue(first) ?? stringValue(item?.url) ?? stringValue(item?.contentUrl);
}

function brand(value: unknown): string | null {
  return stringValue(value) ?? stringValue(record(value)?.name);
}

function idFromUrl(rawUrl: string): string {
  return decodeURIComponent(new URL(rawUrl).pathname.split("/").filter(Boolean).at(-1) ?? rawUrl).replace(/\.html$/i, "");
}

function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const pattern of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ]) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return null;
}

function categoryFromUrl(rawUrl: string): string | null {
  try {
    const parts = new URL(rawUrl).pathname.split("/").filter(Boolean)
      .map((item) => decodeURIComponent(item).replace(/[-_]+/g, " "))
      .filter((item) => !["falabella cl", "product", "simple"].includes(item.toLowerCase()) && !/^\d+$/.test(item) && !item.endsWith(".html"));
    return parts.length > 1 ? parts.slice(0, -1).join(" > ") : null;
  } catch {
    return null;
  }
}

function mapNode(retailer: string, pageUrl: string, node: JsonRecord): ParsedProduct | null {
  const name = stringValue(node.name) ?? stringValue(node.headline);
  if (!name) return null;
  const allOffers = offers(node.offers);
  const priced = allOffers.map((offer) => ({
    offer,
    price: numberValue(offer.price ?? offer.lowPrice ?? offer.salePrice ?? record(offer.priceSpecification)?.price),
  })).filter((item): item is { offer: JsonRecord; price: number } => item.price !== null && item.price >= 0)
    .sort((left, right) => left.price - right.price);
  const selected = priced[0]?.offer ?? allOffers[0] ?? {};
  const selectedPrice = priced[0]?.price ?? 0;
  const highest = priced.length ? Math.max(...priced.map((item) => item.price)) : null;
  const explicitRegular = numberValue(selected.highPrice ?? selected.listPrice ?? selected.regularPrice ?? record(selected.priceSpecification)?.maxPrice);
  const regularPrice = [highest, explicitRegular]
    .filter((item): item is number => item !== null && item > selectedPrice)
    .sort((left, right) => right - left)[0] ?? null;
  const rawUrl = stringValue(node.url) ?? stringValue(node["@id"]) ?? pageUrl;
  const productUrl = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, pageUrl).toString();
  const externalId = String(node.sku ?? node.productID ?? node.gtin13 ?? node.gtin ?? node.mpn ?? idFromUrl(productUrl)).trim();
  if (!externalId) return null;
  const sellerValue = selected.seller ?? node.seller ?? node.manufacturer;
  const sellerRecord = record(sellerValue);
  const parent = record(node.isVariantOf);
  const availability = String(selected.availability ?? node.availability ?? "").toLowerCase();
  return {
    supermarket: retailer,
    external_id: externalId,
    parent_external_id: stringValue(parent?.sku) ?? stringValue(parent?.productID) ?? stringValue(parent?.mpn),
    name,
    brand: brand(node.brand),
    category: stringValue(node.category) ?? categoryFromUrl(productUrl),
    seller: stringValue(sellerValue) ?? stringValue(sellerRecord?.name) ?? stringValue(sellerRecord?.legalName),
    seller_id: stringValue(sellerRecord?.identifier) ?? stringValue(sellerRecord?.taxID) ?? stringValue(selected.sellerId),
    variant: stringValue(node.color) ?? stringValue(node.size) ?? stringValue(node.model) ?? stringValue(node.pattern),
    url: productUrl,
    image_url: image(node.image),
    regular_price: regularPrice,
    offer_price: selectedPrice,
    unit: null,
    unit_price: null,
    in_stock: selectedPrice > 0 && !availability.includes("outofstock") && !availability.includes("soldout") && !availability.includes("discontinued"),
    observed_at: new Date().toISOString(),
    source_metadata: {
      parser: "json_ld",
      schemaType: types(node),
      priceCurrency: stringValue(selected.priceCurrency),
      detectedPrices: priced.map((item) => item.price),
      priceMissing: selectedPrice <= 0,
    },
  };
}

function fallback(retailer: string, pageUrl: string, html: string): ParsedProduct | null {
  const name = meta(html, "og:title") ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (!name) return null;
  const price = numberValue(meta(html, "product:price:amount")) ?? 0;
  return {
    supermarket: retailer,
    external_id: idFromUrl(pageUrl),
    parent_external_id: null,
    name: decodeEntities(name),
    brand: meta(html, "product:brand"),
    category: meta(html, "product:category") ?? categoryFromUrl(pageUrl),
    seller: null,
    seller_id: null,
    variant: null,
    url: pageUrl,
    image_url: meta(html, "og:image"),
    regular_price: null,
    offer_price: price,
    unit: null,
    unit_price: null,
    in_stock: price > 0,
    observed_at: new Date().toISOString(),
    source_metadata: { parser: "html_meta_fallback", priceMissing: price <= 0 },
  };
}

export function parseProductPage(retailer: string, pageUrl: string, html: string): ParsedProduct[] {
  const output = new Map<string, ParsedProduct>();
  for (const payload of jsonLdPayloads(html)) {
    try {
      for (const node of collectProducts(JSON.parse(payload))) {
        const product = mapNode(retailer, pageUrl, node);
        if (product) output.set(product.external_id, product);
      }
    } catch {
      // Continue through all public structured-data blocks.
    }
  }
  if (!output.size) {
    const item = fallback(retailer, pageUrl, html);
    if (item) output.set(item.external_id, item);
  }
  return [...output.values()];
}
