import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { parsePharmacyPage, type ParsedProduct } from "./parser.ts";

type JsonRecord = Record<string, unknown>;
type Task = { id: number; run_id: number; supermarket: string; kind: string; payload: JsonRecord; attempts: number };
type QueueTask = { task_key: string; supermarket: string; kind: string; payload: JsonRecord };
type Result = { products: ParsedProduct[]; newTasks: QueueTask[] };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const USER_AGENT = "MGP-PharmacyCatalogBot/1.1 (+public-price-research; respects robots.txt)";
const HOSTS = new Set([
  "salcobrand.cl", "www.salcobrand.cl",
  "beta.cruzverde.cl", "cruzverde.cl", "www.cruzverde.cl",
  "farmaciasahumada.cl", "www.farmaciasahumada.cl",
]);
const BATCH_SIZE = 8;

function json(body: unknown, status = 200) {
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

function safeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Blocked pharmacy URL host: ${url.hostname}`);
  }
  url.hash = "";
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"]) {
    url.searchParams.delete(key);
  }
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
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase service credentials unavailable");
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
  if (!response.ok) throw new Error(`RPC ${name} ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function fetchPublic(raw: string, timeout = 45_000): Promise<string> {
  const url = safeUrl(raw);
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/ld+json,text/plain,*/*",
      "accept-language": "es-CL,es;q=0.9",
      "cache-control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.toString()}`);
  return response.text();
}

function locations(xml: string): string[] {
  return [...new Set(Array.from(
    xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi),
    (match) => match[1]
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .trim(),
  ).filter(Boolean))];
}

function hrefs(html: string, base: string): string[] {
  const raw = Array.from(html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi), (match) => match[1]);
  const output: string[] = [];
  for (const item of raw) {
    try {
      output.push(safeUrl(new URL(item.replace(/\\u0026/g, "&"), base).toString()).toString());
    } catch {
      // Ignore external or malformed links.
    }
  }
  return [...new Set(output)];
}

function sitemapUrl(raw: string): boolean {
  try {
    const value = `${new URL(raw).pathname}${new URL(raw).search}`.toLowerCase();
    return value.includes("sitemap") || value.endsWith(".xml") || value.includes(".xml?");
  } catch {
    return false;
  }
}

function productUrl(retailer: string, raw: string): boolean {
  let path: string;
  try { path = decodeURIComponent(safeUrl(raw).pathname).toLowerCase(); }
  catch { return false; }
  if (retailer === "Salcobrand") {
    return path.includes("/products/") && path.split("/").filter(Boolean).length >= 2;
  }
  if (retailer === "Farmacias Ahumada") {
    return /-[0-9]{4,}\.html$/.test(path) && !path.includes("terms-and-conditions");
  }
  if (retailer === "Cruz Verde") {
    const excluded = [
      "/servicio-al-cliente/", "/servicios/", "/bases-legales/", "/contents-content-pages-module/",
      "/campanas/", "/vive-mejor/", "/especiales/", "/content/", "/legal/",
    ];
    if (excluded.some((item) => path.includes(item))) return false;
    if (!path.endsWith(".html")) return false;
    return !["/index.html", "/home.html"].some((item) => path.endsWith(item));
  }
  return false;
}

function listingUrl(retailer: string, raw: string): boolean {
  try {
    const path = safeUrl(raw).pathname.toLowerCase();
    if (productUrl(retailer, raw) || sitemapUrl(raw)) return false;
    if (retailer === "Salcobrand") {
      return path === "/" || ["medic", "cuidado", "vitamin", "belleza", "salud"].some((item) => path.includes(item));
    }
    if (retailer === "Cruz Verde") {
      return ["/medicamentos/", "/ofertas/", "/precios-bajos/", "/productos-mas/", "/cuidado-de-la-piel/"].some((item) => path.includes(item));
    }
    if (retailer === "Farmacias Ahumada") {
      return path === "/" || ["/medicamentos", "/genericos", "/promociones", "/hotdeals", "/dermocosmetica", "/vitaminas"].some((item) => path.includes(item));
    }
  } catch {
    return false;
  }
  return false;
}

function inherited(task: Task, values: JsonRecord): JsonRecord {
  return {
    mode: stringValue(task.payload.mode) ?? "pilot",
    root_url: stringValue(task.payload.root_url) ?? stringValue(task.payload.url),
    max_depth: numberValue(task.payload.max_depth) ?? 4,
    max_product_urls: numberValue(task.payload.max_product_urls),
    crawl_delay_ms: numberValue(task.payload.crawl_delay_ms) ?? 1200,
    max_pages: numberValue(task.payload.max_pages) ?? 3,
    ...values,
  };
}

function batches<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function processSitemap(task: Task): Promise<Result> {
  const raw = stringValue(task.payload.url);
  if (!raw) throw new Error("Missing pharmacy sitemap URL");
  const depth = Math.max(0, numberValue(task.payload.depth) ?? 0);
  const maxDepth = Math.max(1, numberValue(task.payload.max_depth) ?? 4);
  if (depth > maxDepth) return { products: [], newTasks: [] };

  const discovered = locations(await fetchPublic(raw, 55_000))
    .map((item) => { try { return safeUrl(item).toString(); } catch { return null; } })
    .filter((item): item is string => Boolean(item));
  if (!discovered.length) throw new Error(`Sitemap returned no allowed locations: ${raw}`);

  const pilot = stringValue(task.payload.mode) !== "full";
  let child = discovered.filter(sitemapUrl);
  let products = discovered.filter((item) => productUrl(task.supermarket, item));
  let listings = discovered.filter((item) => listingUrl(task.supermarket, item));
  if (pilot) {
    child = child.slice(0, 3);
    products = products.slice(0, 250);
    listings = listings.slice(0, 8);
  } else {
    products = products.slice(0, 15000);
    listings = listings.slice(0, 100);
  }

  const tasks: QueueTask[] = child.map((url) => ({
    task_key: `pharmacy-sitemap:${task.supermarket.toLowerCase()}:${hash(url)}`,
    supermarket: task.supermarket,
    kind: "pharmacy_sitemap",
    payload: inherited(task, { url, depth: depth + 1 }),
  }));
  for (const url of listings) {
    tasks.push({
      task_key: `pharmacy-listing:${task.supermarket.toLowerCase()}:${hash(url)}`,
      supermarket: task.supermarket,
      kind: "pharmacy_listing_page",
      payload: inherited(task, { url, page: 1 }),
    });
  }
  for (const urls of batches(products, BATCH_SIZE)) {
    tasks.push({
      task_key: `pharmacy-batch:${task.supermarket.toLowerCase()}:${hash(urls.join("|"))}`,
      supermarket: task.supermarket,
      kind: "pharmacy_product_batch",
      payload: inherited(task, { urls }),
    });
  }
  return { products: [], newTasks: tasks };
}

async function processListing(task: Task): Promise<Result> {
  const raw = stringValue(task.payload.url);
  if (!raw) throw new Error("Missing pharmacy listing URL");
  const page = Math.max(1, numberValue(task.payload.page) ?? 1);
  const maxPages = Math.max(1, numberValue(task.payload.max_pages) ?? 3);
  const html = await fetchPublic(raw, 55_000);
  const links = hrefs(html, raw);
  const productLinks = links
    .filter((item) => productUrl(task.supermarket, item))
    .slice(0, stringValue(task.payload.mode) === "full" ? 1200 : 180);
  const nextListings = page < maxPages
    ? links.filter((item) => listingUrl(task.supermarket, item) && (/[?&](?:start|page|p|sz)=/i.test(item) || /\/page\/[0-9]+/i.test(item))).slice(0, 3)
    : [];
  const tasks: QueueTask[] = [];
  for (const urls of batches(productLinks, BATCH_SIZE)) {
    tasks.push({
      task_key: `pharmacy-batch:${task.supermarket.toLowerCase()}:${hash(urls.join("|"))}`,
      supermarket: task.supermarket,
      kind: "pharmacy_product_batch",
      payload: inherited(task, { urls }),
    });
  }
  for (const url of nextListings) {
    tasks.push({
      task_key: `pharmacy-listing:${task.supermarket.toLowerCase()}:${hash(url)}`,
      supermarket: task.supermarket,
      kind: "pharmacy_listing_page",
      payload: inherited(task, { url, page: page + 1 }),
    });
  }
  if (!tasks.length) throw new Error(`No public pharmacy product links found at ${raw}`);
  return { products: [], newTasks: tasks };
}

async function processPage(task: Task): Promise<Result> {
  const raw = stringValue(task.payload.url);
  if (!raw) throw new Error("Missing pharmacy product URL");
  const products = parsePharmacyPage(task.supermarket, safeUrl(raw).toString(), await fetchPublic(raw), true);
  if (!products.length) throw new Error(`No public pharmacy product metadata found at ${raw}`);
  return { products, newTasks: [] };
}

async function processBatch(task: Task): Promise<Result> {
  const urls = Array.isArray(task.payload.urls)
    ? task.payload.urls.map(stringValue).filter((item): item is string => Boolean(item)).slice(0, BATCH_SIZE)
    : [];
  if (!urls.length) throw new Error("Missing pharmacy batch URLs");
  const delay = Math.max(400, Math.min(10000, numberValue(task.payload.crawl_delay_ms) ?? 1200));
  const output = new Map<string, ParsedProduct>();
  const failures: string[] = [];
  for (let index = 0; index < urls.length; index += 1) {
    try {
      for (const product of parsePharmacyPage(task.supermarket, safeUrl(urls[index]).toString(), await fetchPublic(urls[index]), true)) {
        output.set(product.external_id, product);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    if (index < urls.length - 1) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!output.size && failures.length) throw new Error(failures.slice(0, 3).join(" | "));
  if (!output.size) throw new Error("No valid pharmacy products were parsed from the batch");
  return { products: [...output.values()], newTasks: [] };
}

async function processTask(task: Task): Promise<Result> {
  switch (task.kind) {
    case "pharmacy_sitemap": return processSitemap(task);
    case "pharmacy_listing_page": return processListing(task);
    case "pharmacy_product_page": return processPage(task);
    case "pharmacy_product_batch": return processBatch(task);
    default: throw new Error(`Unsupported pharmacy task kind: ${task.kind}`);
  }
}

async function enqueue(runId: number, tasks: QueueTask[]): Promise<number> {
  let inserted = 0;
  for (let index = 0; index < tasks.length; index += 200) {
    inserted += await rpc<number>("enqueue_pharmacy_tasks_service", {
      p_run_id: runId,
      p_tasks: tasks.slice(index, index + 200),
    });
  }
  return inserted;
}

async function handle(task: Task): Promise<JsonRecord> {
  try {
    const result = await processTask(task);
    const tasksInserted = await enqueue(task.run_id, result.newTasks);
    const completion = await rpc<JsonRecord>("complete_pharmacy_task_service", {
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
    const completion = await rpc<JsonRecord>("complete_pharmacy_task_service", {
      p_task_id: task.id,
      p_products: [],
      p_error: message,
    });
    return { taskId: task.id, retailer: task.supermarket, kind: task.kind, error: message, completion };
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const body = await request.text();
  if (body && body !== "{}") return json({ error: "request_body_not_accepted" }, 400);
  try {
    const tasks = await rpc<Task[]>("claim_pharmacy_tasks_service", { p_limit: 3 });
    if (!tasks.length) {
      return json({ ok: true, claimed: 0, status: await rpc("pharmacy_crawl_status_service", { p_run_id: null }) });
    }
    const results = await Promise.all(tasks.map(handle));
    return json({
      ok: true,
      claimed: tasks.length,
      results,
      status: await rpc("pharmacy_crawl_status_service", { p_run_id: tasks[0].run_id }),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});