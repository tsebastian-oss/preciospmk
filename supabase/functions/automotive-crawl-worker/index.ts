import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const UA = "MGP-AutomotiveBot/1.0 (+public-dealer-catalog-research; rate-limited)";
const MAX_CONCURRENCY = 2;

type Task = {
  id: number;
  run_id: number;
  supermarket: string;
  kind: "automotive_dealer_catalog" | "automotive_model_page";
  payload: Record<string, unknown>;
};

type AutomotiveProduct = {
  external_id: string;
  source_key: string;
  brand: string;
  model: string;
  version: string;
  name: string;
  body_type: string;
  url: string;
  image_url: string | null;
  list_price: number | null;
  cash_price: number | null;
  final_price: number | null;
  metadata: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function headers(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE ?? "",
    Authorization: `Bearer ${SERVICE_ROLE ?? ""}`,
    "content-type": "application/json",
    ...extra,
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

function clean(value: unknown, max = 220) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function titleCase(value: string) {
  return value.replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function price(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function absoluteUrl(value: string, base: string) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function links(html: string, base: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], base);
    if (url) found.add(url.split("#")[0]);
  }
  return [...found];
}

function metaContent(html: string, property: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
  return null;
}

function firstHeading(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  return match?.[1] ? clean(htmlToText(match[1])) : "";
}

function technicalSheetUrl(html: string, base: string) {
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = clean(htmlToText(match[2]), 180).toLowerCase();
    const href = absoluteUrl(match[1], base);
    if (href && (label.includes("ficha") || /\.pdf(?:$|\?)/i.test(href))) return href;
  }
  return null;
}

function imageUrls(html: string, base: string) {
  const result: string[] = [];
  const og = metaContent(html, "og:image");
  if (og) {
    const url = absoluteUrl(og, base);
    if (url) result.push(url);
  }
  for (const match of html.matchAll(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], base);
    if (!url || result.includes(url)) continue;
    if (/logo|icon|sprite|pixel/i.test(url)) continue;
    result.push(url);
    if (result.length >= 6) break;
  }
  return result;
}

function bodyType(text: string) {
  const match = text.match(/\b(SUV|Sed[aá]n|Hatchback|Pickup|Pick-up|Camioneta|Furg[oó]n|Comercial|Crossover|Van)\b/i);
  return match ? titleCase(match[1]) : "Vehículo";
}

function fuelType(text: string) {
  if (/PHEV|h[ií]brido enchufable/i.test(text)) return "PHEV";
  if (/h[ií]brido/i.test(text)) return "Híbrido";
  if (/el[eé]ctric[oa]|\bEV\b/i.test(text)) return "Eléctrico";
  if (/di[eé]sel|BlueHDi|TDI/i.test(text)) return "Diésel";
  if (/gasolina|bencina|TSI|turbo gasolina/i.test(text)) return "Gasolina";
  return null;
}

function rosselotDiscovery(html: string, base: string) {
  return links(html, base)
    .filter((value) => {
      try {
        const url = new URL(value);
        const parts = url.pathname.split("/").filter(Boolean);
        return /(^|\.)rosselot\.cl$/i.test(url.hostname) && parts[0] === "nuevos" && parts.length >= 3;
      } catch { return false; }
    })
    .slice(0, 500)
    .map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function salazarDiscovery(html: string, base: string, stage: string) {
  const all = links(html, base).filter((value) => {
    try { return /(^|\.)salazarisrael\.cl$/i.test(new URL(value).hostname); } catch { return false; }
  });
  if (stage === "root") {
    return all
      .filter((value) => /^\/marcas\/[^/]+\/nuevo\/?$/i.test(new URL(value).pathname))
      .slice(0, 120)
      .map((url) => ({ kind: "automotive_dealer_catalog", stage: "brand", url, task_key: `brand-${slug(new URL(url).pathname)}` }));
  }
  return all
    .filter((value) => /^\/marcas\/[^/]+\/nuevo\/[^/?#]+\/?$/i.test(new URL(value).pathname))
    .slice(0, 400)
    .map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function valueAfter(block: string, label: string) {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*\\$?\\s*([0-9.]+)`, "i");
  return price(block.match(pattern)?.[1]);
}

function parseRosselot(html: string, url: string, sourceKey: string): AutomotiveProduct[] {
  const text = htmlToText(html);
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const versionHeading = text.match(/Versiones\s+([^,\n]+),\s*([^\n]+)/i);
  const brand = clean(versionHeading?.[1]) || titleCase(path[1] ?? "");
  const model = clean(versionHeading?.[2]) || clean(firstHeading(html)) || titleCase(path[2] ?? "");
  const images = imageUrls(html, url);
  const sheet = technicalSheetUrl(html, url);
  const type = bodyType(text);
  const fuel = fuelType(text);
  const markers = [...text.matchAll(/\nPrecio de Lista:\s*\$?\s*([0-9.]+)/gi)];
  const products: AutomotiveProduct[] = [];

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    const before = text.slice(0, marker.index ?? 0).split("\n").filter(Boolean);
    const version = clean(before.at(-1), 180);
    if (!version || /precios|versiones/i.test(version)) continue;
    const blockEnd = index + 1 < markers.length ? markers[index + 1].index ?? text.length : text.length;
    const block = text.slice(marker.index ?? 0, blockEnd);
    const listPrice = price(marker[1]);
    const brandBonus = valueAfter(block, "Bono Marca") ?? 0;
    const onlineBonus = valueAfter(block, "Bono Online") ?? 0;
    const dealerBonus = valueAfter(block, "Bono exclusivo Rosselot") ?? 0;
    const cashPrice = valueAfter(block, "Precio Contado") ?? (listPrice ? Math.max(0, listPrice - brandBonus - onlineBonus - dealerBonus) : null);
    const financeBonus = valueAfter(block, "Bono Financiamiento") ?? 0;
    const finalPrice = cashPrice ? Math.max(0, cashPrice - financeBonus) : listPrice;
    const externalId = `${sourceKey}:${slug(path.slice(1).join("-"))}:${slug(version)}`;

    products.push({
      external_id: externalId,
      source_key: sourceKey,
      brand,
      model,
      version,
      name: `${brand} ${model} · ${version}`,
      body_type: type,
      url,
      image_url: images[0] ?? null,
      list_price: listPrice,
      cash_price: cashPrice,
      final_price: finalPrice,
      metadata: {
        parser: "rosselot",
        dealer: "Rosselot",
        source_type: "dealer",
        price_confidence: "explicit",
        brand_bonus: brandBonus,
        online_bonus: onlineBonus,
        dealer_bonus: dealerBonus,
        finance_bonus: financeBonus,
        financing_final_price: finalPrice,
        fuel_type: fuel,
        technical_sheet_url: sheet,
        images,
      },
    });
  }
  return products;
}

function parseSalazar(html: string, url: string, sourceKey: string): AutomotiveProduct[] {
  const text = htmlToText(html);
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const brand = titleCase(path[1] ?? "");
  const heading = clean(firstHeading(html)) || clean(metaContent(html, "og:title")) || titleCase(path[3] ?? "");
  const model = clean(heading.replace(new RegExp(`^${brand}\\s+`, "i"), ""), 160) || titleCase(path[3] ?? "");
  const advertised = price(text.match(/(?:Desde|Precio(?:\s+desde)?)\s*\$?\s*([0-9.]+)/i)?.[1]);
  const bonus = price(text.match(/Incluye\s+bono(?:\s+de)?\s*\$?\s*([0-9.]+)/i)?.[1]) ?? 0;
  const listPrice = advertised && bonus ? advertised + bonus : advertised;
  const images = imageUrls(html, url);
  const sheet = technicalSheetUrl(html, url);
  const type = bodyType(text);
  const fuel = fuelType(text);
  const version = "Precio desde";
  if (!brand || !model) return [];

  return [{
    external_id: `${sourceKey}:${slug(path.slice(1).join("-"))}`,
    source_key: sourceKey,
    brand,
    model,
    version,
    name: `${brand} ${model}`,
    body_type: type,
    url,
    image_url: images[0] ?? null,
    list_price: listPrice,
    cash_price: advertised,
    final_price: advertised,
    metadata: {
      parser: "salazar_israel",
      dealer: "Salazar Israel",
      source_type: "dealer",
      price_confidence: "advertised_from",
      list_price_derived: Boolean(advertised && bonus),
      advertised_bonus: bonus,
      brand_bonus: bonus,
      finance_bonus: 0,
      fuel_type: fuel,
      technical_sheet_url: sheet,
      images,
    },
  }];
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

async function processTask(task: Task) {
  const parser = clean(task.payload?.parser_key, 80);
  const sourceKey = clean(task.payload?.source_key, 100) || slug(task.supermarket);
  const url = clean(task.payload?.url, 800);
  const stage = clean(task.payload?.stage, 40) || "model";
  const delayMs = Number(task.payload?.crawl_delay_ms ?? 800);
  if (!url) throw new Error("automotive_url_missing");
  const html = await fetchHtml(url, Number.isFinite(delayMs) ? delayMs : 800);

  if (task.kind === "automotive_dealer_catalog") {
    const items = parser === "rosselot"
      ? rosselotDiscovery(html, url)
      : parser === "salazar_israel"
        ? salazarDiscovery(html, url, stage)
        : [];
    const enqueued = items.length
      ? await rpc<number>("enqueue_automotive_tasks_service", { p_parent_task_id: task.id, p_items: items })
      : 0;
    const state = await finish(task, true, 0, null);
    return { id: task.id, dealer: task.supermarket, kind: task.kind, stage, discovered: items.length, enqueued, state };
  }

  const products = parser === "rosselot"
    ? parseRosselot(html, url, sourceKey)
    : parser === "salazar_israel"
      ? parseSalazar(html, url, sourceKey)
      : [];
  const ingested = products.length
    ? await rpc<number>("ingest_automotive_products_service", {
        p_run_id: task.run_id,
        p_task_id: task.id,
        p_dealer: task.supermarket,
        p_products: products,
      })
    : 0;
  const state = await finish(task, true, Number(ingested || 0), null);
  return { id: task.id, dealer: task.supermarket, kind: task.kind, parsed: products.length, ingested, state };
}

async function safeTask(task: Task) {
  try { return await processTask(task); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await finish(task, false, 0, message); } catch { /* preserve original error */ }
    return { id: task.id, dealer: task.supermarket, kind: task.kind, error: message };
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
