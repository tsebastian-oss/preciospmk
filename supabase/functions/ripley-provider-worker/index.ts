import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Json = Record<string, unknown>;
type Task = { id: number; run_id: number; supermarket: string; kind: string; payload: Json; attempts: number };
type QueueTask = { task_key: string; supermarket: string; kind: string; payload: Json };
type Product = {
  supermarket: string; external_id: string; parent_external_id: string | null; name: string; brand: string | null;
  category: string | null; seller: string | null; seller_id: string | null; variant: string | null; url: string;
  image_url: string | null; regular_price: number | null; offer_price: number; unit: null; unit_price: null;
  in_stock: boolean; observed_at: string; source_metadata: Json;
};
type PriceLevel = { external_id: string; price_type: string; price: number; currency: string; observed_at: string; metadata: Json };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ZYTE_KEY = Deno.env.get("RIPLEY_ZYTE_API_KEY");
const BATCH_SIZE = 8;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function record(value: unknown): Json | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null; }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9,-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
function hash(value: string) {
  let output = 2166136261;
  for (let index = 0; index < value.length; index += 1) { output ^= value.charCodeAt(index); output = Math.imul(output, 16777619); }
  return (output >>> 0).toString(36);
}
function allowed(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "simple.ripley.cl") throw new Error(`Blocked Ripley URL: ${url.toString()}`);
  url.hash = "";
  return url.toString();
}
async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase service credentials unavailable");
  const request = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  if (!request.ok) throw new Error(`RPC ${name} ${request.status}: ${await request.text()}`);
  return request.json() as Promise<T>;
}
async function zyte(rawUrl: string, browser: boolean) {
  if (!ZYTE_KEY) throw new Error("RIPLEY_ZYTE_API_KEY is not configured");
  const url = allowed(rawUrl);
  const request = await fetch("https://api.zyte.com/v1/extract", {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${ZYTE_KEY}:`)}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(browser ? { url, browserHtml: true } : { url, httpResponseBody: true }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!request.ok) throw new Error(`Zyte ${request.status}: ${await request.text()}`);
  const payload = await request.json() as { browserHtml?: string; httpResponseBody?: string };
  if (browser && payload.browserHtml) return payload.browserHtml;
  if (!browser && payload.httpResponseBody) {
    const binary = atob(payload.httpResponseBody);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  throw new Error("Zyte response did not contain requested content");
}
function locations(xml: string) {
  return [...new Set(Array.from(xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi), (match) => match[1]
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim()).filter(Boolean))];
}
function isSitemap(raw: string) { try { const value = new URL(raw).pathname.toLowerCase(); return value.includes("sitemap") || value.endsWith(".xml") || value.endsWith(".xml.gz"); } catch { return false; } }
function isProduct(raw: string) {
  try {
    const path = new URL(raw).pathname.toLowerCase();
    if (["/minisitios/", "/evento/", "/search/", "/landing/", "/blog/"].some((item) => path.includes(item))) return false;
    return /-mpm[0-9a-z]+\/?$/.test(path) || /-[0-9]{6,}\/?$/.test(path);
  } catch { return false; }
}
function jsonLd(html: string) {
  return Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1].trim());
}
function productNodes(value: unknown, output: Json[] = []): Json[] {
  if (Array.isArray(value)) { for (const item of value) productNodes(item, output); return output; }
  const node = record(value); if (!node) return output;
  const type = node["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) output.push(node);
  for (const [key, child] of Object.entries(node)) if (key !== "@context" && child && typeof child === "object") productNodes(child, output);
  return output;
}
function offers(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(offers);
  const item = record(value); if (!item) return [];
  if (item.offers) { const nested = offers(item.offers); if (nested.length) return nested; }
  return [item];
}
function image(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return stringValue(first) ?? stringValue(record(first)?.url) ?? stringValue(record(first)?.contentUrl);
}
function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const pattern of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ]) { const match = html.match(pattern); if (match?.[1]) return match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim(); }
  return null;
}
function categoryFromUrl(rawUrl: string) {
  const path = new URL(rawUrl).pathname.split("/").filter(Boolean);
  const last = path.at(-1)?.replace(/-mpm[0-9a-z]+$/i, "") ?? "";
  return last.split("-").slice(-4).join(" ") || null;
}
function mapNode(rawUrl: string, node: Json, observedAt: string) {
  const name = stringValue(node.name); if (!name) return null;
  const rawOffers = offers(node.offers);
  const levels = rawOffers.map((offer, index) => ({
    type: String(offer.priceType ?? offer.name ?? `offer_${index + 1}`),
    price: numberValue(offer.price ?? offer.lowPrice ?? record(offer.priceSpecification)?.price),
    crossed: false,
    offer,
  })).filter((item): item is { type: string; price: number; crossed: boolean; offer: Json } => item.price !== null && item.price > 0);
  if (!levels.length) return null;
  const selected = levels.sort((a, b) => a.price - b.price)[0];
  const highest = Math.max(...levels.map((item) => item.price));
  const explicitRegular = numberValue(selected.offer.highPrice ?? selected.offer.listPrice ?? selected.offer.regularPrice);
  const regular = Math.max(highest, explicitRegular ?? 0) > selected.price ? Math.max(highest, explicitRegular ?? 0) : null;
  const productUrl = stringValue(node.url) ?? stringValue(selected.offer.url) ?? rawUrl;
  const externalId = String(node.sku ?? node.productID ?? node.gtin13 ?? node.gtin ?? node.mpn ?? productUrl.split("/").filter(Boolean).at(-1) ?? "").trim();
  if (!externalId) return null;
  const brandValue = node.brand; const sellerValue = selected.offer.seller ?? node.seller;
  const availability = String(selected.offer.availability ?? "").toLowerCase();
  const product: Product = {
    supermarket: "Ripley", external_id: externalId, parent_external_id: null, name,
    brand: stringValue(brandValue) ?? stringValue(record(brandValue)?.name), category: stringValue(node.category) ?? categoryFromUrl(productUrl),
    seller: stringValue(sellerValue) ?? stringValue(record(sellerValue)?.name), seller_id: stringValue(record(sellerValue)?.identifier), variant: null,
    url: productUrl, image_url: image(node.image), regular_price: regular, offer_price: selected.price, unit: null, unit_price: null,
    in_stock: !availability.includes("outofstock") && !availability.includes("soldout"), observed_at: observedAt,
    source_metadata: { parser: "ripley_json_ld_via_authorized_provider", detectedPrices: levels.map(({ type, price }) => ({ type, price })) },
  };
  const priceLevels: PriceLevel[] = levels.map((level) => ({ external_id: externalId, price_type: level.type, price: level.price, currency: "CLP", observed_at: observedAt, metadata: {} }));
  if (regular) priceLevels.push({ external_id: externalId, price_type: "normalPrice", price: regular, currency: "CLP", observed_at: observedAt, metadata: { inferred: true } });
  return { product, priceLevels };
}
function fallback(rawUrl: string, html: string, observedAt: string) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const name = meta(html, "og:title") ?? text.match(/Código de producto[\s\S]{0,300}?([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9 .,_-]{10,})/i)?.[1]?.trim();
  const code = text.match(/Código de producto\s*:?\s*([0-9A-Za-z-]+)/i)?.[1] ?? rawUrl.match(/-mpm([0-9a-z]+)\/?$/i)?.[1];
  const internet = numberValue(text.match(/Internet\s*\$\s*([0-9.]+)/i)?.[1]);
  const normal = numberValue(text.match(/Normal\s*\$\s*([0-9.]+)/i)?.[1]);
  if (!name || !code || !internet) return null;
  const seller = text.match(/Vendido por\s*:?\s*([A-ZÁÉÍÓÚÑ0-9 .&_-]{2,80})/i)?.[1]?.trim() ?? null;
  const brand = text.match(/Marca\s+([A-ZÁÉÍÓÚÑ0-9 .&_-]{2,60})/i)?.[1]?.trim() ?? null;
  const product: Product = {
    supermarket: "Ripley", external_id: code, parent_external_id: null, name, brand, category: categoryFromUrl(rawUrl), seller, seller_id: null,
    variant: null, url: rawUrl, image_url: meta(html, "og:image"), regular_price: normal && normal > internet ? normal : null,
    offer_price: internet, unit: null, unit_price: null, in_stock: !/sin stock|agotado/i.test(text), observed_at: observedAt,
    source_metadata: { parser: "ripley_rendered_html_via_authorized_provider" },
  };
  const priceLevels: PriceLevel[] = [{ external_id: code, price_type: "internetPrice", price: internet, currency: "CLP", observed_at: observedAt, metadata: {} }];
  if (normal && normal > internet) priceLevels.push({ external_id: code, price_type: "normalPrice", price: normal, currency: "CLP", observed_at: observedAt, metadata: {} });
  return { product, priceLevels };
}
function parseProduct(rawUrl: string, html: string) {
  const observedAt = new Date().toISOString();
  const products = new Map<string, Product>(); const levels: PriceLevel[] = [];
  for (const script of jsonLd(html)) {
    try {
      for (const node of productNodes(JSON.parse(script))) {
        const parsed = mapNode(rawUrl, node, observedAt);
        if (parsed) { products.set(parsed.product.external_id, parsed.product); levels.push(...parsed.priceLevels); }
      }
    } catch { /* Continue through structured-data blocks. */ }
  }
  if (!products.size) {
    const parsed = fallback(rawUrl, html, observedAt);
    if (parsed) { products.set(parsed.product.external_id, parsed.product); levels.push(...parsed.priceLevels); }
  }
  return { products: [...products.values()], priceLevels: levels };
}
async function enqueue(runId: number, tasks: QueueTask[]) {
  let inserted = 0;
  for (let index = 0; index < tasks.length; index += 200) inserted += await rpc<number>("enqueue_department_store_tasks_service", { p_run_id: runId, p_tasks: tasks.slice(index, index + 200) });
  return inserted;
}
async function process(task: Task) {
  if (task.kind === "ripley_sitemap") {
    const rawUrl = stringValue(task.payload.url); if (!rawUrl) throw new Error("Ripley sitemap URL missing");
    const depth = Math.max(0, Number(task.payload.depth ?? 0)); const maxDepth = Math.max(1, Number(task.payload.max_depth ?? 4));
    const xml = await zyte(rawUrl, false); const found = locations(xml).map((url) => { try { return allowed(url); } catch { return null; } }).filter((url): url is string => Boolean(url));
    const tasks: QueueTask[] = [];
    if (depth < maxDepth) for (const url of found.filter(isSitemap)) tasks.push({ task_key: `ripley-sitemap:${hash(url)}`, supermarket: "Ripley", kind: "ripley_sitemap", payload: { ...task.payload, url, depth: depth + 1 } });
    const products = found.filter(isProduct); const limit = String(task.payload.mode ?? "pilot") === "full" ? products.length : Math.min(products.length, 200);
    for (let index = 0; index < limit; index += BATCH_SIZE) {
      const urls = products.slice(index, index + BATCH_SIZE);
      tasks.push({ task_key: `ripley-product-batch:${hash(urls.join("|"))}`, supermarket: "Ripley", kind: "ripley_product_batch", payload: { urls } });
    }
    return { products: [] as Product[], priceLevels: [] as PriceLevel[], tasks };
  }
  const urls = Array.isArray(task.payload.urls) ? task.payload.urls.map(stringValue).filter((url): url is string => Boolean(url)).slice(0, BATCH_SIZE) : [];
  if (!urls.length) throw new Error("Ripley product batch is empty");
  const products: Product[] = []; const priceLevels: PriceLevel[] = [];
  for (const url of urls) {
    try { const parsed = parseProduct(url, await zyte(url, true)); products.push(...parsed.products); priceLevels.push(...parsed.priceLevels); }
    catch { /* Preserve successful products from the batch. */ }
  }
  if (!products.length) throw new Error("Ripley provider returned no priced products for the batch");
  return { products, priceLevels, tasks: [] as QueueTask[] };
}
async function handle(task: Task) {
  try {
    const result = await process(task); const tasksInserted = await enqueue(task.run_id, result.tasks);
    const completion = await rpc<Json>("complete_department_store_task_service", { p_task_id: task.id, p_products: result.products, p_error: null });
    const pricesInserted = result.priceLevels.length ? await rpc<number>("record_retail_price_levels_service", { p_run_id: task.run_id, p_retailer: "Ripley", p_rows: result.priceLevels }) : 0;
    return { taskId: task.id, products: result.products.length, pricesInserted, tasksInserted, completion };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completion = await rpc<Json>("complete_department_store_task_service", { p_task_id: task.id, p_products: [], p_error: message });
    return { taskId: task.id, error: message, completion };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const body = await request.text(); if (body && body !== "{}") return reply({ error: "request_body_not_accepted" }, 400);
  if (!ZYTE_KEY) return reply({ error: "provider_not_configured", requiredSecret: "RIPLEY_ZYTE_API_KEY" }, 503);
  try {
    const tasks = await rpc<Task[]>("claim_ripley_provider_tasks_service", { p_limit: 1 });
    if (!tasks.length) return reply({ ok: true, claimed: 0 });
    const results = []; for (const task of tasks) results.push(await handle(task));
    return reply({ ok: true, claimed: tasks.length, results });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : String(error) }, 500); }
});
