import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parseProductPage, type ParsedProduct } from "./parser-v3.ts";

type JsonRecord = Record<string, unknown>;
type TaskKind = "retail_sitemap" | "retail_product_batch" | "retail_product_page";
type Task = { id: number; run_id: number; supermarket: string; kind: string; payload: JsonRecord; attempts: number };
type QueueTask = { task_key: string; supermarket: string; kind: TaskKind; payload: JsonRecord };
type Result = { products: ParsedProduct[]; newTasks: QueueTask[] };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const USER_AGENT = "MGP-CatalogBot/1.0 (+public-catalog-research; respects robots.txt)";
const HOSTS = new Set(["paris.cl", "www.paris.cl", "falabella.com", "www.falabella.com", "simple.ripley.cl"]);
const BATCH_SIZE = 50;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase())) throw new Error(`Blocked crawl URL host: ${url.hostname}`);
  url.hash = "";
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) url.searchParams.delete(key);
  return url;
}

function hash(value: string): string {
  let output = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 16777619);
  }
  return (output >>> 0).toString(36);
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase service credentials are unavailable");
  const request = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!request.ok) throw new Error(`Supabase RPC ${request.status}: ${await request.text()}`);
  return request.json() as Promise<T>;
}

async function fetchPublic(rawUrl: string, timeout = 45_000): Promise<string> {
  const url = safeUrl(rawUrl);
  const request = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/ld+json,text/plain,*/*",
      "accept-language": "es-CL,es;q=0.9,en;q=0.5",
      "cache-control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!request.ok) throw new Error(`HTTP ${request.status} for ${url.toString()}`);
  return request.text();
}

function locations(xml: string): string[] {
  return [...new Set(Array.from(xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi), (match) => match[1]
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim()).filter(Boolean))];
}

function sitemapUrl(rawUrl: string): boolean {
  try {
    const value = `${new URL(rawUrl).pathname}${new URL(rawUrl).search}`.toLowerCase();
    return value.includes("sitemap") || value.endsWith(".xml") || value.endsWith(".xml.gz") || value.includes(".xml?");
  } catch { return false; }
}

function sitemapPriority(retailer: string, rawUrl: string): number {
  const value = rawUrl.toLowerCase();
  if (retailer === "Paris" && value.includes("sitemap_products")) return 0;
  if (retailer === "Falabella" && (value.includes("pdp") || value.includes("product"))) return 0;
  if (retailer === "Ripley" && value.includes("product")) return 0;
  if (value.includes("categor")) return 2;
  return 1;
}

function productUrl(retailer: string, rawUrl: string): boolean {
  let path: string;
  try { path = decodeURIComponent(safeUrl(rawUrl).pathname).toLowerCase(); }
  catch { return false; }
  if (retailer === "Paris") return path.endsWith(".html") && !path.includes("/search");
  if (retailer === "Falabella") return path.includes("/falabella-cl/product/");
  if (retailer === "Ripley") {
    if (["/minisitios/", "/evento/", "/search/", "/landing/", "/blog/"].some((item) => path.includes(item))) return false;
    return /-mpm[0-9a-z]+$/.test(path) || /-[0-9]{6,}$/.test(path);
  }
  return false;
}

function inherited(task: Task, values: JsonRecord): JsonRecord {
  return {
    mode: stringValue(task.payload.mode) ?? "pilot",
    root_url: stringValue(task.payload.root_url) ?? stringValue(task.payload.url),
    max_depth: numberValue(task.payload.max_depth) ?? 4,
    max_product_urls: numberValue(task.payload.max_product_urls),
    crawl_delay_ms: numberValue(task.payload.crawl_delay_ms) ?? 1000,
    ...values,
  };
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function processSitemap(task: Task): Promise<Result> {
  const rawUrl = stringValue(task.payload.url);
  if (!rawUrl) throw new Error("Invalid retail_sitemap payload: missing url");
  const depth = Math.max(0, numberValue(task.payload.depth) ?? 0);
  const maxDepth = Math.max(1, numberValue(task.payload.max_depth) ?? 4);
  const pilot = stringValue(task.payload.mode) !== "full";
  if (depth > maxDepth) return { products: [], newTasks: [] };

  const discovered = locations(await fetchPublic(rawUrl, 50_000)).map((item) => {
    try { return safeUrl(item).toString(); } catch { return null; }
  }).filter((item): item is string => Boolean(item));
  if (!discovered.length) throw new Error(`Sitemap returned no allowed locations: ${rawUrl}`);

  let childSitemaps = discovered.filter(sitemapUrl).sort((left, right) => sitemapPriority(task.supermarket, left) - sitemapPriority(task.supermarket, right));
  const preferredSitemaps = childSitemaps.filter((item) => sitemapPriority(task.supermarket, item) === 0);
  if (preferredSitemaps.length) childSitemaps = preferredSitemaps;
  let productUrls = discovered.filter((item) => productUrl(task.supermarket, item));
  if (pilot) {
    childSitemaps = childSitemaps.slice(0, 2);
    productUrls = productUrls.slice(0, 80);
  }

  const newTasks: QueueTask[] = childSitemaps.map((url) => ({
    task_key: `retail-sitemap:${task.supermarket.toLowerCase()}:${hash(url)}`,
    supermarket: task.supermarket,
    kind: "retail_sitemap",
    payload: inherited(task, { url, depth: depth + 1 }),
  }));
  for (const urls of batches(productUrls, BATCH_SIZE)) {
    newTasks.push({
      task_key: `retail-product-batch:${task.supermarket.toLowerCase()}:${hash(urls.join("|"))}`,
      supermarket: task.supermarket,
      kind: "retail_product_batch",
      payload: inherited(task, { urls }),
    });
  }
  return { products: [], newTasks };
}

async function processPage(task: Task): Promise<Result> {
  const url = stringValue(task.payload.url);
  if (!url) throw new Error("Invalid retail_product_page payload: missing url");
  const products = parseProductPage(task.supermarket, safeUrl(url).toString(), await fetchPublic(url));
  if (!products.length) throw new Error(`No public product metadata found at ${url}`);
  return { products, newTasks: [] };
}

async function processBatch(task: Task): Promise<Result> {
  const urls = Array.isArray(task.payload.urls)
    ? task.payload.urls.map(stringValue).filter((item): item is string => Boolean(item)).slice(0, BATCH_SIZE)
    : [];
  if (!urls.length) throw new Error("Invalid retail_product_batch payload: missing urls");
  const delay = Math.max(250, Math.min(15_000, numberValue(task.payload.crawl_delay_ms) ?? 1000));
  const products = new Map<string, ParsedProduct>();
  const failures: string[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    try {
      for (const product of parseProductPage(task.supermarket, safeUrl(urls[index]).toString(), await fetchPublic(urls[index]))) {
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

async function processTask(task: Task): Promise<Result> {
  switch (String(task.kind).trim()) {
    case "retail_sitemap": return processSitemap(task);
    case "retail_product_batch": return processBatch(task);
    case "retail_product_page": return processPage(task);
    default: throw new Error(`Unsupported department-store task kind: ${task.kind}`);
  }
}

async function enqueue(runId: number, tasks: QueueTask[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < tasks.length; index += 250) {
    inserted += await rpc<number>("enqueue_department_store_tasks_service", { p_run_id: runId, p_tasks: tasks.slice(index, index + 250) });
  }
  return inserted;
}

async function handle(task: Task): Promise<JsonRecord> {
  try {
    const result = await processTask(task);
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
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  if (!SERVICE_ROLE_KEY || request.headers.get("authorization") !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return response({ error: "unauthorized" }, 401);
  }
  const body = await request.text();
  if (body && body !== "{}") return response({ error: "request_body_not_accepted" }, 400);
  try {
    const tasks = await rpc<Task[]>("claim_department_store_tasks_service", { p_limit: 2 });
    if (!tasks.length) return response({ ok: true, claimed: 0, status: await rpc("department_store_crawl_status_service", { p_run_id: null }) });
    const results = await Promise.all(tasks.map(handle));
    return response({ ok: true, claimed: tasks.length, results, status: await rpc("department_store_crawl_status_service", { p_run_id: tasks[0].run_id }) });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
