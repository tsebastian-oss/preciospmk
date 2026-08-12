import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { clean, discover, parseProducts, slug, type AutomotiveProduct } from "./parsers.ts";
import { discoverMarket, parseMarketProducts } from "./market-parsers-v4.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const UA = "MGP-AutomotiveBot/1.6 (+public-dealer-catalog-research; rate-limited)";
const MAX_CONCURRENCY = 2;

type Task = {
  id: number;
  run_id: number;
  supermarket: string;
  kind: "automotive_dealer_catalog" | "automotive_model_page";
  payload: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function headers() {
  return {
    apikey: SERVICE_ROLE ?? "",
    Authorization: `Bearer ${SERVICE_ROLE ?? ""}`,
    "content-type": "application/json",
  };
}

async function rpc<T = unknown>(fn: string, body: Record<string, unknown>): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("supabase_env_missing");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${fn}_${response.status}_${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function brandFromSlug(value: string) {
  const aliases: Record<string, string> = {
    jmc: "JMC", ram: "RAM", fiat: "Fiat", jeep: "Jeep", dongfeng: "Dongfeng", "dongfeng-adp": "Dongfeng ADP",
    citroen: "Citroën", peugeot: "Peugeot", kgm: "KGM", foton: "Foton", chery: "Chery", mitsubishi: "Mitsubishi",
    jetour: "Jetour", landking: "Landking", opel: "Opel", sinotruk: "Sinotruk", soueast: "Soueast", leapmotor: "Leapmotor",
  };
  return aliases[value] ?? value.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function modelFromSlug(value: string) {
  return value.split("-").filter(Boolean).map((part) => part.length <= 3 && /\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function enforceUrlIdentity(parser: string, url: string, sourceKey: string, products: AutomotiveProduct[]) {
  if (parser !== "rosselot") return products;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts[0] !== "nuevos" || !parts[1] || !parts[2]) return products;
    const expectedBrandSlug = parts[1];
    if (products.every((product) => slug(product.brand) === expectedBrandSlug)) return products;
    const brand = brandFromSlug(expectedBrandSlug);
    const model = modelFromSlug(parts[2]);
    return products.map((product) => {
      if (slug(product.brand) === expectedBrandSlug) return product;
      return {
        ...product,
        external_id: `${sourceKey}:${slug(`${brand}-${model}-${product.version}`)}`,
        brand,
        model,
        name: `${brand} ${model} · ${product.version}`,
        metadata: { ...product.metadata, identity_source: "dealer_url" },
      };
    });
  } catch {
    return products;
  }
}

async function fetchHtml(url: string, delayMs: number) {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "es-CL,es;q=0.9" },
    signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw new Error(`source_${response.status}_${new URL(url).hostname}`);
  const html = await response.text();
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 2500)));
  return html;
}

async function finish(task: Task, success: boolean, products = 0, error: string | null = null) {
  return await rpc("finish_automotive_task_service", {
    p_task_id: task.id,
    p_success: success,
    p_products_found: products,
    p_error: error,
  });
}

async function ingest(task: Task, products: AutomotiveProduct[]) {
  return products.length
    ? await rpc<number>("ingest_automotive_products_service", {
        p_run_id: task.run_id,
        p_task_id: task.id,
        p_dealer: task.supermarket,
        p_products: products,
      })
    : 0;
}

async function processTask(task: Task) {
  const parser = clean(task.payload?.parser_key, 80);
  const sourceKey = clean(task.payload?.source_key, 100) || slug(task.supermarket);
  const url = clean(task.payload?.url, 800);
  const stage = clean(task.payload?.stage, 40) || "model";
  const delayMs = Number(task.payload?.crawl_delay_ms ?? 800);
  if (!url) throw new Error("automotive_url_missing");

  const html = await fetchHtml(url, Number.isFinite(delayMs) ? delayMs : 800);
  const marketProducts = parseMarketProducts(parser, html, url, sourceKey, task.supermarket);
  const rawProducts = marketProducts ?? parseProducts(parser, html, url, sourceKey, task.supermarket, task.kind);
  const products = enforceUrlIdentity(parser, url, sourceKey, rawProducts);
  const ingested = await ingest(task, products);

  if (task.kind === "automotive_dealer_catalog") {
    const marketItems = discoverMarket(parser, html, url, stage);
    const items = marketItems ?? discover(parser, html, url, stage);
    const enqueued = items.length
      ? await rpc<number>("enqueue_automotive_tasks_service", { p_parent_task_id: task.id, p_items: items })
      : 0;
    const state = await finish(task, true, Number(ingested || 0), null);
    return { id: task.id, dealer: task.supermarket, stage, parsed: products.length, ingested, discovered: items.length, enqueued, state };
  }

  const state = await finish(task, true, Number(ingested || 0), null);
  return { id: task.id, dealer: task.supermarket, parsed: products.length, ingested, state };
}

async function safeTask(task: Task) {
  try { return await processTask(task); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await finish(task, false, 0, message); } catch { /* preserve original source error */ }
    return { id: task.id, dealer: task.supermarket, error: message };
  }
}

async function pool(tasks: Task[]) {
  const output = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      output[index] = await safeTask(tasks[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, tasks.length)) }, () => worker()));
  return output;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SERVICE_ROLE || request.headers.get("authorization") !== `Bearer ${SERVICE_ROLE}`) return json({ error: "unauthorized" }, 401);
  try {
    const tasks = await rpc<Task[]>("claim_automotive_tasks_service", { p_limit: 4 });
    if (!tasks.length) return json({ ok: true, claimed: 0 });
    const started = Date.now();
    const results = await pool(tasks);
    const failures = results.filter((item) => item?.error);
    return json({
      ok: failures.length < results.length,
      claimed: tasks.length,
      failed: failures.length,
      durationMs: Date.now() - started,
      results,
    }, failures.length === results.length ? 502 : 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
