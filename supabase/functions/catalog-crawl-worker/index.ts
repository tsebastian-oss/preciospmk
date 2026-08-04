type JsonRecord = Record<string, unknown>;

type CatalogTask = {
  id: number;
  run_id: number;
  supermarket: string;
  kind: "vtex_categories" | "vtex_page" | "sitemap" | "product_page" | "product_batch";
  payload: JsonRecord;
  attempts: number;
};

type QueueTask = {
  task_key: string;
  supermarket: string;
  kind: CatalogTask["kind"];
  payload: JsonRecord;
};

type ScrapedProduct = {
  supermarket: string;
  external_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  image_url: string | null;
  regular_price: number | null;
  offer_price: number;
  unit: string | null;
  unit_price: number | null;
  in_stock: boolean;
  observed_at: string;
};

type ProcessedTask = { products: ScrapedProduct[]; newTasks: QueueTask[] };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const USER_AGENT = "Mozilla/5.0 (compatible; MGPPriceMonitor/2.0; +https://mgpconsultoria.cl)";
const ALLOWED_HOSTS = new Set([
  "jumbo.vtexcommercestable.com.br",
  "santaisabel.vtexcommercestable.com.br",
  "super.lider.cl",
  "www.lider.cl",
  "lider.cl",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function assertAllowedUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Blocked crawl URL host: ${url.hostname}`);
  }
  return url;
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
  });
  if (!response.ok) throw new Error(`Supabase RPC ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function fetchText(rawUrl: string, timeoutMs = 25_000): Promise<string> {
  const url = assertAllowedUrl(rawUrl);
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/json,text/plain,*/*",
      "accept-language": "es-CL,es;q=0.9,en;q=0.7",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.toString()}`);
  return response.text();
}

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function normalizeCategory(value: unknown): string | null {
  const category = text(value);
  if (!category) return null;
  const normalized = category.replace(/^\/+|\/+$/g, "").replace(/\//g, " > ");
  return normalized || null;
}

function collectLeafCategories(
  nodes: unknown,
  parentNames: string[] = [],
  parentIds: string[] = [],
): Array<{ id: string; name: string; path: string }> {
  if (!Array.isArray(nodes)) return [];
  const output: Array<{ id: string; name: string; path: string }> = [];
  for (const nodeValue of nodes) {
    const node = asRecord(nodeValue);
    if (!node) continue;
    const id = String(node.id ?? "").trim();
    const name = text(node.name) ?? id;
    if (!id) continue;
    const namePath = [...parentNames, name];
    const idPath = [...parentIds, id];
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      output.push({ id, name: namePath.join(" > "), path: `/${idPath.join("/")}/` });
    } else {
      output.push(...collectLeafCategories(children, namePath, idPath));
    }
  }
  return output;
}

function mapVtexProducts(
  supermarket: string,
  publicOrigin: string,
  rawProducts: unknown,
  fallbackCategory: string | null,
): ScrapedProduct[] {
  if (!Array.isArray(rawProducts)) return [];
  const observedAt = new Date().toISOString();
  const products: ScrapedProduct[] = [];
  for (const rawProduct of rawProducts) {
    const product = asRecord(rawProduct);
    if (!product) continue;
    const productName = text(product.productName) ?? text(product.productTitle) ?? "Producto sin nombre";
    const brand = text(product.brand) ?? null;
    const linkText = text(product.linkText);
    const categories = Array.isArray(product.categories) ? product.categories : [];
    const category = normalizeCategory(categories[0]) ?? fallbackCategory;
    const items = Array.isArray(product.items) ? product.items : [];
    for (const rawItem of items) {
      const item = asRecord(rawItem);
      if (!item) continue;
      const externalId = String(item.itemId ?? item.ean ?? "").trim();
      if (!externalId) continue;
      const sellers = Array.isArray(item.sellers)
        ? item.sellers.map(asRecord).filter((seller): seller is JsonRecord => Boolean(seller))
        : [];
      const seller = sellers.find((candidate) => String(candidate.sellerId ?? "") === "1")
        ?? sellers.find((candidate) => numberValue(asRecord(candidate.commertialOffer)?.Price) !== undefined)
        ?? sellers[0];
      const offer = asRecord(seller?.commertialOffer);
      const price = numberValue(offer?.Price) ?? 0;
      const listPrice = numberValue(offer?.ListPrice);
      const availableQuantity = numberValue(offer?.AvailableQuantity) ?? 0;
      const measurementUnit = text(item.measurementUnit) ?? null;
      const unitMultiplier = numberValue(item.unitMultiplier);
      const itemImages = Array.isArray(item.images) ? item.images : [];
      const firstImage = asRecord(itemImages[0]);
      const itemName = text(item.nameComplete) ?? text(item.name) ?? productName;
      const productUrl = linkText ? `${publicOrigin}/${linkText.replace(/^\/+/, "")}/p` : publicOrigin;
      products.push({
        supermarket,
        external_id: externalId,
        name: itemName,
        brand,
        category,
        url: productUrl,
        image_url: text(firstImage?.imageUrl) ?? null,
        regular_price: listPrice && listPrice > price ? listPrice : null,
        offer_price: price,
        unit: measurementUnit,
        unit_price: unitMultiplier && unitMultiplier > 0 && unitMultiplier !== 1
          ? Math.round((price / unitMultiplier) * 100) / 100
          : null,
        in_stock: availableQuantity > 0,
        observed_at: observedAt,
      });
    }
  }
  return products;
}

function jsonLdScripts(html: string): string[] {
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  return Array.from(matches, (match) => match[1].trim());
}

function productNodes(raw: unknown): unknown[] {
  const roots = Array.isArray(raw) ? raw : [raw];
  const output: unknown[] = [];
  for (const root of roots) {
    const node = asRecord(root);
    if (!node) continue;
    const type = node["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) output.push(node);
    if (Array.isArray(node["@graph"])) output.push(...productNodes(node["@graph"]));
    if (Array.isArray(node.itemListElement)) {
      for (const item of node.itemListElement) {
        const record = asRecord(item);
        output.push(record && "item" in record ? record.item : item);
      }
    }
  }
  return output;
}

function mapJsonLdProduct(supermarket: string, fallbackUrl: string, candidate: unknown): ScrapedProduct | undefined {
  const product = asRecord(candidate);
  if (!product) return undefined;
  const name = text(product.name);
  if (!name) return undefined;
  const rawOffers = product.offers;
  const offers = asRecord(Array.isArray(rawOffers) ? rawOffers[0] : rawOffers) ?? {};
  const price = numberValue(offers.price ?? offers.lowPrice) ?? 0;
  const listPrice = numberValue(offers.highPrice);
  const rawBrand = product.brand;
  const brandRecord = asRecord(rawBrand);
  const rawImage = Array.isArray(product.image) ? product.image[0] : product.image;
  const imageRecord = asRecord(rawImage);
  const productUrl = text(product.url) ?? fallbackUrl;
  let urlSku: string | undefined;
  try { urlSku = new URL(productUrl).pathname.split("/").filter(Boolean).at(-1); } catch { urlSku = undefined; }
  const externalId = String(product.sku ?? product.productID ?? product.gtin13 ?? product.gtin ?? urlSku ?? productUrl).trim();
  const availability = String(offers.availability ?? "");
  return {
    supermarket,
    external_id: externalId,
    name,
    brand: text(rawBrand) ?? text(brandRecord?.name) ?? null,
    category: normalizeCategory(product.category),
    url: productUrl,
    image_url: text(rawImage) ?? text(imageRecord?.url) ?? null,
    regular_price: listPrice && listPrice > price ? listPrice : null,
    offer_price: price,
    unit: null,
    unit_price: null,
    in_stock: availability ? !availability.includes("OutOfStock") : price > 0,
    observed_at: new Date().toISOString(),
  };
}

async function processVtexCategories(task: CatalogTask): Promise<ProcessedTask> {
  const baseUrl = text(task.payload.base_url);
  const publicOrigin = text(task.payload.public_origin);
  if (!baseUrl || !publicOrigin) throw new Error("Invalid VTEX category task payload");
  const body = await fetchText(`${baseUrl}/api/catalog_system/pub/category/tree/3`);
  const categories = collectLeafCategories(JSON.parse(body));
  if (categories.length === 0) throw new Error("VTEX category tree returned no leaf categories");
  return {
    products: [],
    newTasks: categories.map((category) => ({
      task_key: `vtex-page:${task.supermarket}:${category.id}:0`,
      supermarket: task.supermarket,
      kind: "vtex_page",
      payload: {
        base_url: baseUrl,
        public_origin: publicOrigin,
        category_id: category.id,
        category_path: category.path,
        category_name: category.name,
        offset: 0,
      },
    })),
  };
}

async function processVtexPage(task: CatalogTask): Promise<ProcessedTask> {
  const baseUrl = text(task.payload.base_url);
  const publicOrigin = text(task.payload.public_origin);
  const categoryId = String(task.payload.category_id ?? "").trim();
  const categoryPath = text(task.payload.category_path);
  const categoryName = text(task.payload.category_name) ?? null;
  const offset = numberValue(task.payload.offset) ?? 0;
  if (!baseUrl || !publicOrigin || !categoryId || !categoryPath) throw new Error("Invalid VTEX page task payload");
  const endpoint = new URL(`${baseUrl}/api/catalog_system/pub/products/search`);
  endpoint.searchParams.set("fq", `C:${categoryPath}`);
  endpoint.searchParams.set("_from", String(offset));
  endpoint.searchParams.set("_to", String(offset + 49));
  const body = await fetchText(endpoint.toString());
  const rawProducts = JSON.parse(body);
  if (!Array.isArray(rawProducts)) throw new Error("VTEX search response was not an array");
  const products = mapVtexProducts(task.supermarket, publicOrigin, rawProducts, categoryName);
  const newTasks: QueueTask[] = [];
  if (rawProducts.length === 50) {
    const nextOffset = offset + 50;
    newTasks.push({
      task_key: `vtex-page:${task.supermarket}:${categoryId}:${nextOffset}`,
      supermarket: task.supermarket,
      kind: "vtex_page",
      payload: {
        base_url: baseUrl,
        public_origin: publicOrigin,
        category_id: categoryId,
        category_path: categoryPath,
        category_name: categoryName,
        offset: nextOffset,
      },
    });
  }
  return { products, newTasks };
}

function looksLikeSitemap(url: URL): boolean {
  const value = `${url.pathname}${url.search}`.toLowerCase();
  return value.includes("sitemap") || value.endsWith(".xml") || value.includes(".xml?") || value.endsWith(".xml.gz");
}

async function processSitemap(task: CatalogTask): Promise<ProcessedTask> {
  const rawUrl = text(task.payload.url);
  if (!rawUrl) throw new Error("Invalid sitemap task payload");
  const body = await fetchText(rawUrl, 35_000);
  const locations = Array.from(body.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi), (match) => decodeXml(match[1]));
  if (locations.length === 0) throw new Error(`Sitemap returned no locations: ${rawUrl}`);
  const sitemapTasks = new Map<string, QueueTask>();
  const productUrls: string[] = [];
  for (const location of locations) {
    let url: URL;
    try { url = assertAllowedUrl(location); } catch { continue; }
    if (looksLikeSitemap(url)) {
      sitemapTasks.set(`sitemap:${url.toString()}`, {
        task_key: `sitemap:${url.toString()}`,
        supermarket: "Lider",
        kind: "sitemap",
        payload: { url: url.toString() },
      });
    } else if (url.pathname.toLowerCase().includes("/ip/")) {
      productUrls.push(url.toString());
    }
  }
  const productTasks: QueueTask[] = [];
  for (let index = 0; index < productUrls.length; index += 15) {
    productTasks.push({
      task_key: `product-batch:${rawUrl}:${Math.floor(index / 15)}`,
      supermarket: "Lider",
      kind: "product_batch",
      payload: { urls: productUrls.slice(index, index + 15) },
    });
  }
  return { products: [], newTasks: [...sitemapTasks.values(), ...productTasks] };
}

async function processProductPage(task: CatalogTask): Promise<ProcessedTask> {
  const rawUrl = text(task.payload.url);
  if (!rawUrl) throw new Error("Invalid product page task payload");
  const html = await fetchText(rawUrl);
  const products = new Map<string, ScrapedProduct>();
  for (const script of jsonLdScripts(html)) {
    try {
      const parsed = JSON.parse(script) as unknown;
      for (const candidate of productNodes(parsed)) {
        const product = mapJsonLdProduct(task.supermarket, rawUrl, candidate);
        if (product) products.set(product.external_id, product);
      }
    } catch {
      // Malformed analytics JSON-LD blocks are ignored.
    }
  }
  if (products.size === 0) throw new Error(`No product JSON-LD found at ${rawUrl}`);
  return { products: Array.from(products.values()), newTasks: [] };
}

async function processProductBatch(task: CatalogTask): Promise<ProcessedTask> {
  const urls = Array.isArray(task.payload.urls)
    ? task.payload.urls.map(text).filter((url): url is string => Boolean(url))
    : [];
  if (urls.length === 0 || urls.length > 15) throw new Error("Invalid product batch task payload");
  const results = await Promise.all(urls.map(async (url) => {
    const result = await processProductPage({ ...task, kind: "product_page", payload: { url } });
    return result.products;
  }));
  const products = new Map<string, ScrapedProduct>();
  for (const group of results) for (const product of group) products.set(product.external_id, product);
  return { products: Array.from(products.values()), newTasks: [] };
}

async function processTask(task: CatalogTask): Promise<ProcessedTask> {
  switch (task.kind) {
    case "vtex_categories": return processVtexCategories(task);
    case "vtex_page": return processVtexPage(task);
    case "sitemap": return processSitemap(task);
    case "product_page": return processProductPage(task);
    case "product_batch": return processProductBatch(task);
  }
}

async function enqueueTasks(runId: number, tasks: QueueTask[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < tasks.length; index += 300) {
    inserted += await rpc<number>("enqueue_catalog_tasks_service", {
      p_run_id: runId,
      p_tasks: tasks.slice(index, index + 300),
    });
  }
  return inserted;
}

async function handleTask(task: CatalogTask): Promise<JsonRecord> {
  try {
    const result = await processTask(task);
    const tasksInserted = await enqueueTasks(task.run_id, result.newTasks);
    const completion = await rpc<JsonRecord>("complete_catalog_task_service", {
      p_task_id: task.id,
      p_products: result.products,
      p_error: null,
    });
    return { taskId: task.id, kind: task.kind, supermarket: task.supermarket, products: result.products.length, tasksInserted, completion };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completion = await rpc<JsonRecord>("complete_catalog_task_service", {
      p_task_id: task.id,
      p_products: [],
      p_error: message,
    });
    return { taskId: task.id, kind: task.kind, supermarket: task.supermarket, error: message, completion };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.text();
  if (body && body !== "{}") return json({ error: "Request body is not accepted" }, 400);
  try {
    const tasks = await rpc<CatalogTask[]>("claim_catalog_tasks_service", { p_limit: 4 });
    if (tasks.length === 0) {
      const status = await rpc<JsonRecord>("catalog_crawl_status_service", { p_run_id: null });
      return json({ ok: true, claimed: 0, status });
    }
    const results = await Promise.all(tasks.map(handleTask));
    const status = await rpc<JsonRecord>("catalog_crawl_status_service", { p_run_id: tasks[0].run_id });
    return json({ ok: true, claimed: tasks.length, results, status });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
