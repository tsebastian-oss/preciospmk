import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type JsonRecord = Record<string, unknown>;
type TaskKind = "retail_sitemap" | "retail_product_batch" | "retail_product_page";

type CatalogTask = {
  id: number;
  run_id: number;
  supermarket: string;
  kind: TaskKind;
  payload: JsonRecord;
  attempts: number;
};

type QueueTask = {
  task_key: string;
  supermarket: string;
  kind: TaskKind;
  payload: JsonRecord;
};

type ScrapedProduct = {
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

type ProcessedTask = {
  products: ScrapedProduct[];
  newTasks: QueueTask[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const USER_AGENT = "MGP-CatalogBot/1.0 (+public-catalog-research; respects robots.txt)";
const ALLOWED_HOSTS = new Set([
  "paris.cl",
  "www.paris.cl",
  "falabella.com",
  "www.falabella.com",
  "simple.ripley.cl",
]);
const BATCH_SIZE = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let normalized = trimmed.replace(/[^0-9,.-]/g, "");
  if (!normalized) return undefined;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma > dot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (dot > comma && /^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  } else {
    normalized = normalized.replace(/,/g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function assertAllowedUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Blocked crawl URL host: ${url.hostname}`);
  }
  url.hash = "";
  return url;
}

function canonicalUrl(rawUrl: string): string {
  const url = assertAllowedUrl(rawUrl);
  for (const parameter of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    url.searchParams.delete(parameter);
  }
  return url.toString();
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase service credentials are unavailable");
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase RPC ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function fetchText(rawUrl: string, timeoutMs = 40_000): Promise<string> {
  const url = assertAllowedUrl(rawUrl);
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/ld+json,text/plain,*/*",
      "accept-language": "es-CL,es;q=0.9,en;q=0.6",
      "cache-control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.toString()}`);
  return response.text();
}

function xmlLocations(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi), (match) => decodeHtml(match[1]))
    .filter(Boolean);
}

function looksLikeSitemap(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const candidate = `${url.pathname}${url.search}`.toLowerCase();
    return candidate.includes("sitemap") || candidate.endsWith(".xml") || candidate.endsWith(".xml.gz") || candidate.includes(".xml?");
  } catch {
    return false;
  }
}

function looksLikeProductUrl(retailer: string, rawUrl: string): boolean {
  let url: URL;
  try {
    url = assertAllowedUrl(rawUrl);
  } catch {
    return false;
  }
  const path = decodeURIComponent(url.pathname).toLowerCase();
  if (retailer === "Paris") return path.endsWith(".html") && !path.includes("/search") && !path.includes("/category");
  if (retailer === "Falabella") return path.includes("/falabella-cl/product/");
  if (retailer === "Ripley") {
    if (["/minisitios/", "/evento/", "/search/", "/landing/", "/blog/"].some((fragment) => path.includes(fragment))) return false;
    return /-mpm[0-9a-z]+$/.test(path) || /-[0-9]{6,}$/.test(path);
  }
  return false;
}

function categoryFromUrl(rawUrl: string): string | null {
  try {
    const ignored = new Set(["falabella-cl", "product", "productos", "simple", "cl"]);
    const parts = new URL(rawUrl).pathname.split("/").filter(Boolean)
      .map((item) => decodeURIComponent(item).replace(/[-_]+/g, " ").trim())
      .filter((item) => item && !ignored.has(item.toLowerCase()) && !/^\d+$/.test(item) && !item.toLowerCase().endsWith(".html"));
    return parts.length > 1 ? parts.slice(0, -1).join(" > ") : null;
  } catch {
    return null;
  }
}

function taskPayload(task: CatalogTask, overrides: JsonRecord = {}): JsonRecord {
  return {
    mode: text(task.payload.mode) ?? "pilot",
    root_url: text(task.payload.root_url) ?? text(task.payload.url) ?? null,
    max_depth: numberValue(task.payload.max_depth) ?? 4,
    max_product_urls: numberValue(task.payload.max_product_urls) ?? null,
    crawl_delay_ms: numberValue(task.payload.crawl_delay_ms) ?? 1000,
    ...overrides,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

async function processSitemap(task: CatalogTask): Promise<ProcessedTask> {
  const rawUrl = text(task.payload.url);
  const depth = Math.max(0, numberValue(task.payload.depth) ?? 0);
  const maxDepth = Math.max(1, numberValue(task.payload.max_depth) ?? 4);
  const mode = text(task.payload.mode) === "full" ? "full" : "pilot";
  if (!rawUrl) throw new Error("Invalid retail sitemap payload");
  if (depth > maxDepth) return { products: [], newTasks: [] };

  const xml = await fetchText(rawUrl, 50_000);
  const locations = [...new Set(xmlLocations(xml).map((location) => {
    try { return canonicalUrl(location); } catch { return ""; }
  }).filter(Boolean))];
  if (!locations.length) throw new Error(`Sitemap returned no locations: ${rawUrl}`);

  let childSitemaps = locations.filter(looksLikeSitemap);
  let productUrls = locations.filter((location) => looksLikeProductUrl(task.supermarket, location));
  if (mode === "pilot") {
    childSitemaps = childSitemaps.slice(0, 2);
    const requestedLimit = Math.max(25, numberValue(task.payload.max_product_urls) ?? 120);
    productUrls = productUrls.slice(0, Math.min(requestedLimit, 120));
  }

  const newTasks: QueueTask[] = [];
  for (const childUrl of childSitemaps) {
    newTasks.push({
      task_key: `retail-sitemap:${task.supermarket.toLowerCase()}:${childUrl}`,
      supermarket: task.supermarket,
      kind: "retail_sitemap",
      payload: taskPayload(task, { url: childUrl, depth: depth + 1 }),
    });
  }

  for (const urls of chunk(productUrls, BATCH_SIZE)) {
    const first = urls[0];
    newTasks.push({
      task_key: `retail-product-batch:${task.supermarket.toLowerCase()}:${btoa(first).replace(/=+$/g, "").slice(-80)}`,
      supermarket: task.supermarket,
      kind: "retail_product_batch",
      payload: taskPayload(task, { urls }),
    });
  }

  return { products: [], newTasks };
}

function jsonLdScripts(html: string): string[] {
  return Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1].trim());
}

function nodeTypes(node: JsonRecord): string[] {
  const raw = node["@type"];
  return Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
}

function collectProductNodes(value: unknown, output: JsonRecord[] = [], inheritedParent?: string): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectProductNodes(item, output, inheritedParent);
    return output;
  }
  const node = asRecord(value);
  if (!node) return output;
  const types = nodeTypes(node);
  const ownId = text(node.sku) ?? text(node.productID) ?? text(node.mpn) ?? inheritedParent;
  if (types.includes("Product")) output.push(inheritedParent && !node.isVariantOf ? { ...node, isVariantOf: { sku: inheritedParent } } : node);
  if (Array.isArray(node.hasVariant)) collectProductNodes(node.hasVariant, output, ownId);
  if (Array.isArray(node["@graph"])) collectProductNodes(node["@graph"], output, inheritedParent);
  if (Array.isArray(node.itemListElement)) collectProductNodes(node.itemListElement, output, inheritedParent);
  if (node.item && typeof node.item === "object") collectProductNodes(node.item, output, inheritedParent);
  return output;
}

function flattenOffers(raw: unknown): JsonRecord[] {
  if (Array.isArray(raw)) return raw.flatMap(flattenOffers);
  const record = asRecord(raw);
  if (!record) return [];
  const nested = Array.isArray(record.offers) ? record.offers.flatMap(flattenOffers) : [];
  return nested.length ? nested : [record];
}

function sellerInfo(offer: JsonRecord, product: JsonRecord): { seller: string | null; sellerId: string | null } {
  const rawSeller = offer.seller ?? product.seller ?? product.manufacturer;
  const seller = asRecord(rawSeller);
  return {
    seller: text(rawSeller) ?? text(seller?.name) ?? text(seller?.legalName) ?? null,
    sellerId: text(seller?.identifier) ?? text(seller?.taxID) ?? text(offer.sellerId) ?? null,
  };
}

function imageUrl(raw: unknown): string | null {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const record = asRecord(candidate);
  return text(candidate) ?? text(record?.url) ?? text(record?.contentUrl) ?? null;
}

function brandName(raw: unknown): string | null {
  const record = asRecord(raw);
  return text(raw) ?? text(record?.name) ?? null;
}

function parentSku(product: JsonRecord): string | null {
  const parent = asRecord(product.isVariantOf);
  return text(parent?.sku) ?? text(parent?.productID) ?? text(parent?.mpn) ?? null;
}

function externalIdFromUrl(rawUrl: string): string {
  const path = new URL(rawUrl).pathname.split("/").filter(Boolean);
  return decodeURIComponent(path.at(-1) ?? rawUrl).replace(/\.html$/i, "");
}

function chooseOffer(product: JsonRecord): JsonRecord {
  const offers = flattenOffers(product.offers);
  if (!offers.length) return {};
  const priced = offers.map((offer) => ({
    offer,
    price: numberValue(offer.price ?? offer.lowPrice ?? offer.salePrice ?? asRecord(offer.priceSpecification)?.price),
  })).filter((item) => item.price !== undefined && item.price >= 0);
  priced.sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER));
  return priced[0]?.offer ?? offers[0];
}

function mapProductNode(retailer: string, pageUrl: string, product: JsonRecord, parser: string): ScrapedProduct | null {
  const name = text(product.name) ?? text(product.headline);
  if (!name) return null;
  const offer = chooseOffer(product);
  const offerPrice = numberValue(offer.price ?? offer.lowPrice ?? offer.salePrice ?? asRecord(offer.priceSpecification)?.price) ?? 0;
  const highPrice = numberValue(offer.highPrice ?? product.highPrice);
  const listPrice = numberValue(offer.listPrice ?? offer.regularPrice ?? asRecord(offer.priceSpecification)?.maxPrice);
  const regularPrice = [highPrice, listPrice].filter((item): item is number => item !== undefined && item > offerPrice).sort((a, b) => b - a)[0] ?? null;
  const rawUrl = text(product.url) ?? text(product["@id"]) ?? pageUrl;
  let canonical = pageUrl;
  try { canonical = canonicalUrl(rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, pageUrl).toString()); } catch { /* keep page URL */ }
  const externalId = String(product.sku ?? product.productID ?? product.gtin13 ?? product.gtin ?? product.mpn ?? externalIdFromUrl(canonical)).trim();
  if (!externalId) return null;
  const availability = String(offer.availability ?? product.availability ?? "").toLowerCase();
  const { seller, sellerId } = sellerInfo(offer, product);
  const variant = text(product.color) ?? text(product.size) ?? text(product.model) ?? text(product.pattern) ?? null;
  return {
    supermarket: retailer,
    external_id: externalId,
    parent_external_id: parentSku(product),
    name,
    brand: brandName(product.brand),
    category: text(product.category) ?? categoryFromUrl(canonical),
    seller,
    seller_id: sellerId,
    variant,
    url: canonical,
    image_url: imageUrl(product.image),
    regular_price: regularPrice,
    offer_price: offerPrice,
    unit: null,
    unit_price: null,
    in_stock: availability ? !availability.includes("outofstock") && !availability.includes("soldout") && !availability.includes("discontinued") : offerPrice > 0,
    observed_at: new Date().toISOString(),
    source_metadata: {
      parser,
      schemaType: nodeTypes(product),
      priceCurrency: text(offer.priceCurrency) ?? null,
      priceMissing: offerPrice <= 0,
    },
  };
}

function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return undefined;
}

function regexText(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1].replace(/\\u002F/g, "/").replace(/\\"/g, '"'));
  }
  return undefined;
}

function htmlFallback(retailer: string, pageUrl: string, html: string): ScrapedProduct | null {
  const name = metaContent(html, "og:title") ?? regexText(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
  if (!name) return null;
  const externalId = regexText(html, [
    /["'](?:sku|skuId|sku_id)["']\s*:\s*["']([^"']+)["']/i,
    /["'](?:productID|productId|product_id)["']\s*:\s*["']?([0-9a-z-]+)["']?/i,
  ]) ?? externalIdFromUrl(pageUrl);
  const offerPrice = numberValue(metaContent(html, "product:price:amount") ?? regexText(html, [
    /["'](?:salePrice|offerPrice|currentPrice|price)["']\s*:\s*["']?([0-9.,]+)["']?/i,
  ])) ?? 0;
  const possibleRegular = numberValue(regexText(html, [/["'](?:listPrice|regularPrice|originalPrice)["']\s*:\s*["']?([0-9.,]+)["']?/i]));
  const seller = regexText(html, [/["'](?:sellerName|seller_name)["']\s*:\s*["']([^"']+)["']/i]);
  const brand = metaContent(html, "product:brand") ?? regexText(html, [/["']brand["']\s*:\s*(?:\{[^{}]*["']name["']\s*:\s*)?["']([^"']+)["']/i]);
  const availability = `${metaContent(html, "product:availability") ?? ""} ${regexText(html, [/["']availability["']\s*:\s*["']([^"']+)["']/i]) ?? ""}`.toLowerCase();
  return {
    supermarket: retailer,
    external_id: externalId,
    parent_external_id: null,
    name,
    brand: brand ?? null,
    category: metaContent(html, "product:category") ?? categoryFromUrl(pageUrl),
    seller: seller ?? null,
    seller_id: null,
    variant: null,
    url: canonicalUrl(pageUrl),
    image_url: metaContent(html, "og:image") ?? null,
    regular_price: possibleRegular && possibleRegular > offerPrice ? possibleRegular : null,
    offer_price: offerPrice,
    unit: null,
    unit_price: null,
    in_stock: availability ? !availability.includes("outofstock") && !availability.includes("soldout") : offerPrice > 0,
    observed_at: new Date().toISOString(),
    source_metadata: { parser: "html_meta_fallback", priceMissing: offerPrice <= 0 },
  };
}

function parseProductPage(retailer: string, pageUrl: string, html: string): ScrapedProduct[] {
  const products = new Map<string, ScrapedProduct>();
  for (const script of jsonLdScripts(html)) {
    try {
      const parsed = JSON.parse(script) as unknown;
      for (const node of collectProductNodes(parsed)) {
        const product = mapProductNode(retailer, pageUrl, node, "json_ld");
        if (product) products.set(product.external_id, product);
      }
    } catch {
      // Ignore malformed analytics JSON-LD blocks and continue with other blocks.
    }
  }
  if (!products.size) {
    const fallback = htmlFallback(retailer, pageUrl, html);
    if (fallback) products.set(fallback.external_id, fallback);
  }
  return Array.from(products.values());
}

async function processProductPage(task: CatalogTask): Promise<ProcessedTask> {
  const rawUrl = text(task.payload.url);
  if (!rawUrl) throw new Error("Invalid retail product page payload");
  const html = await fetchText(rawUrl, 45_000);
  const products = parseProductPage(task.supermarket, rawUrl, html);
  if (!products.length) throw new Error(`No public product metadata found at ${rawUrl}`);
  return { products, newTasks: [] };
}

async function processProductBatch(task: CatalogTask): Promise<ProcessedTask> {
  const urls = Array.isArray(task.payload.urls)
    ? task.payload.urls.map(text).filter((item): item is string => Boolean(item)).slice(0, BATCH_SIZE)
    : [];
  if (!urls.length) throw new Error("Invalid retail product batch payload");
  const delay = Math.max(250, Math.min(15_000, numberValue(task.payload.crawl_delay_ms) ?? 1000));
  const products = new Map<string, ScrapedProduct>();
  const failures: string[] = [];

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    try {
      const html = await fetchText(url, 45_000);
      for (const product of parseProductPage(task.supermarket, url, html)) products.set(product.external_id, product);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    if (index < urls.length - 1) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  if (!products.size && failures.length) throw new Error(failures.slice(0, 3).join(" | "));
  return { products: Array.from(products.values()), newTasks: [] };
}

async function processTask(task: CatalogTask): Promise<ProcessedTask> {
  if (task.kind === "retail_sitemap") return processSitemap(task);
  if (task.kind === "retail_product_batch") return processProductBatch(task);
  return processProductPage(task);
}

async function enqueueTasks(runId: number, tasks: QueueTask[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < tasks.length; index += 250) {
    inserted += await rpc<number>("enqueue_department_store_tasks_service", {
      p_run_id: runId,
      p_tasks: tasks.slice(index, index + 250),
    });
  }
  return inserted;
}

async function handleTask(task: CatalogTask): Promise<JsonRecord> {
  try {
    const result = await processTask(task);
    const tasksInserted = await enqueueTasks(task.run_id, result.newTasks);
    const completion = await rpc<JsonRecord>("complete_department_store_task_service", {
      p_task_id: task.id,
      p_products: result.products,
      p_error: null,
    });
    return {
      taskId: task.id,
      retailer: task.supermarket,
      kind: task.kind,
      products: result.products.length,
      tasksInserted,
      completion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completion = await rpc<JsonRecord>("complete_department_store_task_service", {
      p_task_id: task.id,
      p_products: [],
      p_error: message,
    });
    return { taskId: task.id, retailer: task.supermarket, kind: task.kind, error: message, completion };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await request.text();
  if (body && body !== "{}") return json({ error: "request_body_not_accepted" }, 400);

  try {
    const tasks = await rpc<CatalogTask[]>("claim_department_store_tasks_service", { p_limit: 2 });
    if (!tasks.length) {
      const status = await rpc<JsonRecord>("department_store_crawl_status_service", { p_run_id: null });
      return json({ ok: true, claimed: 0, status });
    }
    const results = await Promise.all(tasks.map(handleTask));
    const status = await rpc<JsonRecord>("department_store_crawl_status_service", { p_run_id: tasks[0].run_id });
    return json({ ok: true, claimed: tasks.length, results, status });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
