import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type JsonRecord = Record<string, unknown>;
type TaskKind = "retail_sitemap" | "retail_product_batch" | "retail_product_page";

type CatalogTask = {
  id: number;
  run_id: number;
  supermarket: string;
  kind: string;
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
const BATCH_SIZE = 4;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function object(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericValue(value: unknown): number | null {
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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function allowedUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Blocked crawl URL host: ${url.hostname}`);
  }
  url.hash = "";
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    url.searchParams.delete(key);
  }
  return url;
}

function urlHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase service credentials are unavailable");
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

async function fetchPublic(rawUrl: string, timeoutMs = 45_000): Promise<string> {
  const url = allowedUrl(rawUrl);
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/ld+json,text/plain,*/*",
      "accept-language": "es-CL,es;q=0.9,en;q=0.5",
      "cache-control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.toString()}`);
  return response.text();
}

function locationsFromXml(xml: string): string[] {
  const locations = Array.from(xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi), (match) => decodeEntities(match[1]));
  return [...new Set(locations.filter(Boolean))];
}

function isSitemapUrl(rawUrl: string): boolean {
  try {
    const value = `${new URL(rawUrl).pathname}${new URL(rawUrl).search}`.toLowerCase();
    return value.includes("sitemap") || value.endsWith(".xml") || value.endsWith(".xml.gz") || value.includes(".xml?");
  } catch {
    return false;
  }
}

function isProductUrl(retailer: string, rawUrl: string): boolean {
  let path: string;
  try { path = decodeURIComponent(allowedUrl(rawUrl).pathname).toLowerCase(); }
  catch { return false; }
  if (retailer === "Paris") return path.endsWith(".html") && !path.includes("/search");
  if (retailer === "Falabella") return path.includes("/falabella-cl/product/");
  if (retailer === "Ripley") {
    if (["/minisitios/", "/evento/", "/search/", "/landing/", "/blog/"].some((part) => path.includes(part))) return false;
    return /-mpm[0-9a-z]+$/.test(path) || /-[0-9]{6,}$/.test(path);
  }
  return false;
}

function inheritedPayload(task: CatalogTask, values: JsonRecord): JsonRecord {
  return {
    mode: stringValue(task.payload.mode) ?? "pilot",
    root_url: stringValue(task.payload.root_url) ?? stringValue(task.payload.url),
    max_depth: numericValue(task.payload.max_depth) ?? 4,
    max_product_urls: numericValue(task.payload.max_product_urls),
    crawl_delay_ms: numericValue(task.payload.crawl_delay_ms) ?? 1000,
    ...values,
  };
}

function groups<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function sitemapTask(task: CatalogTask): Promise<ProcessedTask> {
  const rawUrl = stringValue(task.payload.url);
  if (!rawUrl) throw new Error("Invalid retail_sitemap payload: missing url");
  const depth = Math.max(0, numericValue(task.payload.depth) ?? 0);
  const maxDepth = Math.max(1, numericValue(task.payload.max_depth) ?? 4);
  const pilot = stringValue(task.payload.mode) !== "full";
  if (depth > maxDepth) return { products: [], newTasks: [] };

  const xml = await fetchPublic(rawUrl, 50_000);
  const safeLocations = locationsFromXml(xml).map((location) => {
    try { return allowedUrl(location).toString(); }
    catch { return null; }
  }).filter((location): location is string => Boolean(location));
  if (!safeLocations.length) throw new Error(`Sitemap returned no allowed locations: ${rawUrl}`);

  let sitemapUrls = safeLocations.filter(isSitemapUrl);
  let productUrls = safeLocations.filter((location) => isProductUrl(task.supermarket, location));
  if (pilot) {
    sitemapUrls = sitemapUrls.slice(0, 2);
    productUrls = productUrls.slice(0, 80);
  }

  const newTasks: QueueTask[] = [];
  for (const child of sitemapUrls) {
    newTasks.push({
      task_key: `retail-sitemap:${task.supermarket.toLowerCase()}:${urlHash(child)}`,
      supermarket: task.supermarket,
      kind: "retail_sitemap",
      payload: inheritedPayload(task, { url: child, depth: depth + 1 }),
    });
  }
  for (const batch of groups(productUrls, BATCH_SIZE)) {
    newTasks.push({
      task_key: `retail-product-batch:${task.supermarket.toLowerCase()}:${urlHash(batch.join("|"))}`,
      supermarket: task.supermarket,
      kind: "retail_product_batch",
      payload: inheritedPayload(task, { urls: batch }),
    });
  }

  return { products: [], newTasks };
}

function scriptsJsonLd(html: string): string[] {
  return Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1].trim());
}

function typesOf(node: JsonRecord): string[] {
  const value = node["@type"];
  return Array.isArray(value) ? value.map(String) : [String(value ?? "")];
}

function productNodes(value: unknown, output: JsonRecord[] = [], parentId: string | null = null): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const child of value) productNodes(child, output, parentId);
    return output;
  }
  const node = object(value);
  if (!node) return output;
  const nodeId = stringValue(node.sku) ?? stringValue(node.productID) ?? stringValue(node.mpn) ?? parentId;
  if (typesOf(node).includes("Product")) {
    output.push(parentId && !node.isVariantOf ? { ...node, isVariantOf: { sku: parentId } } : node);
  }
  if (node.hasVariant) productNodes(node.hasVariant, output, nodeId);
  if (node["@graph"]) productNodes(node["@graph"], output, parentId);
  if (node.itemListElement) productNodes(node.itemListElement, output, parentId);
  if (node.item) productNodes(node.item, output, parentId);
  return output;
}

function offersOf(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(offersOf);
  const record = object(value);
  if (!record) return [];
  if (record.offers) {
    const nested = offersOf(record.offers);
    if (nested.length) return nested;
  }
  return [record];
}

function bestOffer(product: JsonRecord): JsonRecord {
  const offers = offersOf(product.offers);
  if (!offers.length) return {};
  return offers.sort((left, right) => {
    const leftPrice = numericValue(left.price ?? left.lowPrice ?? left.salePrice ?? object(left.priceSpecification)?.price) ?? Number.MAX_SAFE_INTEGER;
    const rightPrice = numericValue(right.price ?? right.lowPrice ?? right.salePrice ?? object(right.priceSpecification)?.price) ?? Number.MAX_SAFE_INTEGER;
    return leftPrice - rightPrice;
  })[0];
}

function imageOf(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const record = object(candidate);
  return stringValue(candidate) ?? stringValue(record?.url) ?? stringValue(record?.contentUrl);
}

function brandOf(value: unknown): string | null {
  return stringValue(value) ?? stringValue(object(value)?.name);
}

function categoryFromUrl(rawUrl: string): string | null {
  try {
    const parts = new URL(rawUrl).pathname.split("/").filter(Boolean)
      .map((part) => decodeURIComponent(part).replace(/[-_]+/g, " "))
      .filter((part) => !["falabella cl", "product", "simple"].includes(part.toLowerCase()) && !/^\d+$/.test(part) && !part.endsWith(".html"));
    return parts.length > 1 ? parts.slice(0, -1).join(" > ") : null;
  } catch { return null; }
}

function idFromUrl(rawUrl: string): string {
  return decodeURIComponent(new URL(rawUrl).pathname.split("/").filter(Boolean).at(-1) ?? rawUrl).replace(/\.html$/i, "");
}

function productFromNode(retailer: string, pageUrl: string, node: JsonRecord): ScrapedProduct | null {
  const name = stringValue(node.name) ?? stringValue(node.headline);
  if (!name) return null;
  const offer = bestOffer(node);
  const offerPrice = numericValue(offer.price ?? offer.lowPrice ?? offer.salePrice ?? object(offer.priceSpecification)?.price) ?? 0;
  const candidateRegular = numericValue(offer.highPrice ?? offer.listPrice ?? offer.regularPrice ?? object(offer.priceSpecification)?.maxPrice);
  const rawProductUrl = stringValue(node.url) ?? stringValue(node["@id"]) ?? pageUrl;
  let productUrl = pageUrl;
  try { productUrl = allowedUrl(rawProductUrl.startsWith("http") ? rawProductUrl : new URL(rawProductUrl, pageUrl).toString()).toString(); }
  catch { productUrl = allowedUrl(pageUrl).toString(); }
  const externalId = String(node.sku ?? node.productID ?? node.gtin13 ?? node.gtin ?? node.mpn ?? idFromUrl(productUrl)).trim();
  if (!externalId) return null;

  const sellerValue = offer.seller ?? node.seller ?? node.manufacturer;
  const sellerRecord = object(sellerValue);
  const parent = object(node.isVariantOf);
  const availability = String(offer.availability ?? node.availability ?? "").toLowerCase();
  return {
    supermarket: retailer,
    external_id: externalId,
    parent_external_id: stringValue(parent?.sku) ?? stringValue(parent?.productID) ?? stringValue(parent?.mpn),
    name,
    brand: brandOf(node.brand),
    category: stringValue(node.category) ?? categoryFromUrl(productUrl),
    seller: stringValue(sellerValue) ?? stringValue(sellerRecord?.name) ?? stringValue(sellerRecord?.legalName),
    seller_id: stringValue(sellerRecord?.identifier) ?? stringValue(sellerRecord?.taxID) ?? stringValue(offer.sellerId),
    variant: stringValue(node.color) ?? stringValue(node.size) ?? stringValue(node.model) ?? stringValue(node.pattern),
    url: productUrl,
    image_url: imageOf(node.image),
    regular_price: candidateRegular !== null && candidateRegular > offerPrice ? candidateRegular : null,
    offer_price: offerPrice,
    unit: null,
    unit_price: null,
    in_stock: availability ? !availability.includes("outofstock") && !availability.includes("soldout") && !availability.includes("discontinued") : offerPrice > 0,
    observed_at: new Date().toISOString(),
    source_metadata: { parser: "json_ld", schemaType: typesOf(node), priceCurrency: stringValue(offer.priceCurrency), priceMissing: offerPrice <= 0 },
  };
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

function regexCapture(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].replace(/\\u002F/g, "/").replace(/\\"/g, '"'));
  }
  return null;
}

function fallbackProduct(retailer: string, pageUrl: string, html: string): ScrapedProduct | null {
  const name = meta(html, "og:title") ?? regexCapture(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
  if (!name) return null;
  const externalId = regexCapture(html, [
    /["'](?:sku|skuId|sku_id)["']\s*:\s*["']([^"']+)["']/i,
    /["'](?:productID|productId|product_id)["']\s*:\s*["']?([0-9a-z-]+)["']?/i,
  ]) ?? idFromUrl(pageUrl);
  const offerPrice = numericValue(meta(html, "product:price:amount") ?? regexCapture(html, [/["'](?:salePrice|offerPrice|currentPrice|price)["']\s*:\s*["']?([0-9.,]+)["']?/i])) ?? 0;
  const regular = numericValue(regexCapture(html, [/["'](?:listPrice|regularPrice|originalPrice)["']\s*:\s*["']?([0-9.,]+)["']?/i]));
  const availability = `${meta(html, "product:availability") ?? ""} ${regexCapture(html, [/["']availability["']\s*:\s*["']([^"']+)["']/i]) ?? ""}`.toLowerCase();
  return {
    supermarket: retailer,
    external_id: externalId,
    parent_external_id: null,
    name,
    brand: meta(html, "product:brand") ?? regexCapture(html, [/["']brand["']\s*:\s*(?:\{[^{}]*["']name["']\s*:\s*)?["']([^"']+)["']/i]),
    category: meta(html, "product:category") ?? categoryFromUrl(pageUrl),
    seller: regexCapture(html, [/["'](?:sellerName|seller_name)["']\s*:\s*["']([^"']+)["']/i]),
    seller_id: null,
    variant: null,
    url: allowedUrl(pageUrl).toString(),
    image_url: meta(html, "og:image"),
    regular_price: regular !== null && regular > offerPrice ? regular : null,
    offer_price: offerPrice,
    unit: null,
    unit_price: null,
    in_stock: availability ? !availability.includes("outofstock") && !availability.includes("soldout") : offerPrice > 0,
    observed_at: new Date().toISOString(),
    source_metadata: { parser: "html_meta_fallback", priceMissing: offerPrice <= 0 },
  };
}

function parsePage(retailer: string, pageUrl: string, html: string): ScrapedProduct[] {
  const products = new Map<string, ScrapedProduct>();
  for (const script of scriptsJsonLd(html)) {
    try {
      for (const node of productNodes(JSON.parse(script))) {
        const product = productFromNode(retailer, pageUrl, node);
        if (product) products.set(product.external_id, product);
      }
    } catch { /* malformed analytics block */ }
  }
  if (!products.size) {
    const fallback = fallbackProduct(retailer, pageUrl, html);
    if (fallback) products.set(fallback.external_id, fallback);
  }
  return [...products.values()];
}

async function productPageTask(task: CatalogTask): Promise<ProcessedTask> {
  const url = stringValue(task.payload.url);
  if (!url) throw new Error("Invalid retail_product_page payload: missing url");
  const products = parsePage(task.supermarket, url, await fetchPublic(url));
  if (!products.length) throw new Error(`No public product metadata found at ${url}`);
  return { products, newTasks: [] };
}

async function productBatchTask(task: CatalogTask): Promise<ProcessedTask> {
  const urls = Array.isArray(task.payload.urls)
    ? task.payload.urls.map(stringValue).filter((value): value is string => Boolean(value)).slice(0, BATCH_SIZE)
    : [];
  if (!urls.length) throw new Error("Invalid retail_product_batch payload: missing urls");
  const delay = Math.max(250, Math.min(15_000, numericValue(task.payload.crawl_delay_ms) ?? 1000));
  const products = new Map<string, ScrapedProduct>();
  const failures: string[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    try {
      for (const product of parsePage(task.supermarket, urls[index], await fetchPublic(urls[index]))) {
        products.set(product.external_id, product);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    if (index < urls.length - 1) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!products.size && failures.length) throw new Error(failures.slice(0, 3).join(" | "));
  return { products: [...products.values()], newTasks: [] };
}

async function enqueue(runId: number, tasks: QueueTask[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < tasks.length; index += 250) {
    inserted += await rpc<number>("enqueue_department_store_tasks_service", { p_run_id: runId, p_tasks: tasks.slice(index, index + 250) });
  }
  return inserted;
}

async function executeTask(task: CatalogTask): Promise<ProcessedTask> {
  const kind = String(task.kind ?? "").trim();
  switch (kind) {
    case "retail_sitemap": return await sitemapTask(task);
    case "retail_product_batch": return await productBatchTask(task);
    case "retail_product_page": return await productPageTask(task);
    default: throw new Error(`Unsupported department-store task kind: ${kind || "<empty>"}`);
  }
}

async function handle(task: CatalogTask): Promise<JsonRecord> {
  try {
    const result = await executeTask(task);
    if (!result || !Array.isArray(result.products) || !Array.isArray(result.newTasks)) {
      throw new Error(`Invalid processor result for ${task.kind}`);
    }
    const tasksInserted = await enqueue(task.run_id, result.newTasks);
    const completion = await rpc<JsonRecord>("complete_department_store_task_service", {
      p_task_id: task.id,
      p_products: result.products,
      p_error: null,
    });
    return { taskId: task.id, retailer: task.supermarket, kind: task.kind, products: result.products.length, tasksInserted, completion };
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
    if (!Array.isArray(tasks) || !tasks.length) {
      const status = await rpc<JsonRecord>("department_store_crawl_status_service", { p_run_id: null });
      return json({ ok: true, claimed: 0, status });
    }
    const results = await Promise.all(tasks.map(handle));
    const status = await rpc<JsonRecord>("department_store_crawl_status_service", { p_run_id: tasks[0].run_id });
    return json({ ok: true, claimed: tasks.length, results, status });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
