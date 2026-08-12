import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const UA = "MGP-AutomotiveBot/1.1 (+public-dealer-catalog-research; rate-limited)";
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
  list_price: number | null;
  cash_price: number | null;
  final_price: number | null;
  metadata: Record<string, unknown>;
};

type QueueItem = {
  kind: "automotive_dealer_catalog" | "automotive_model_page";
  stage: string;
  url: string;
  task_key: string;
};

const DERCO_BRANDS = ["Suzuki", "Mazda", "GWM", "Avatr", "Deepal", "Changan", "DFSK"];
const SALFA_BRANDS = ["Chevrolet", "Chery", "GAC", "Jaecoo", "JMC", "KGM", "Kia", "Mitsubishi", "Nissan", "Omoda", "Toyota"];
const POMPEYO_BRANDS = ["Nissan", "Peugeot", "MG", "Kia", "Subaru", "Geely", "Opel", "DFSK", "Landking", "Leapmotor", "Dongfeng", "Citroën", "Sinotruk"];

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
  return value.replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
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
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, raw) => {
      const code = Number(raw);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, raw) => {
      const code = Number.parseInt(raw, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6]|a|button)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function lines(html: string) {
  return htmlToText(html).split("\n").map((line) => clean(line, 500)).filter(Boolean);
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
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
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

function valueAfter(block: string, label: string) {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*\\$?\\s*([0-9.]+)`, "i");
  return price(block.match(pattern)?.[1]);
}

function nearestBrand(rows: string[], start: number, brands: string[], depth = 12) {
  for (let index = start; index >= Math.max(0, start - depth); index--) {
    const row = rows[index];
    const found = brands.find((brand) => row.localeCompare(brand, "es", { sensitivity: "base" }) === 0 || row.toLocaleLowerCase("es-CL").startsWith(`${brand.toLocaleLowerCase("es-CL")} `));
    if (found) return { brand: found, index };
  }
  return null;
}

function compactProduct(sourceKey: string, dealer: string, brand: string, model: string, version: string, url: string, listPrice: number | null, cashPrice: number | null, finalPrice: number | null, metadata: Record<string, unknown>): AutomotiveProduct | null {
  brand = clean(brand, 100);
  model = clean(model, 180);
  version = clean(version, 220) || "Precio desde";
  if (!brand || !model || !(finalPrice && finalPrice > 0)) return null;
  return {
    external_id: `${sourceKey}:${slug(`${brand}-${model}-${version}`)}`,
    source_key: sourceKey,
    brand,
    model,
    version,
    name: `${brand} ${model} · ${version}`,
    body_type: "Vehículo",
    url,
    list_price: listPrice ?? cashPrice ?? finalPrice,
    cash_price: cashPrice ?? finalPrice,
    final_price: finalPrice,
    metadata: {
      parser: sourceKey,
      dealer,
      source_type: "dealer",
      capture_scope: "pricing_only",
      ...metadata,
    },
  };
}

function rosselotDiscovery(html: string, base: string): QueueItem[] {
  return links(html, base)
    .filter((value) => {
      try {
        const url = new URL(value);
        const parts = url.pathname.split("/").filter(Boolean);
        return /(^|\.)rosselot\.cl$/i.test(url.hostname) && parts[0] === "nuevos" && parts.length >= 3;
      } catch { return false; }
    })
    .slice(0, 600)
    .map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function salazarDiscovery(html: string, base: string, stage: string): QueueItem[] {
  const all = links(html, base).filter((value) => {
    try { return /(^|\.)salazarisrael\.cl$/i.test(new URL(value).hostname); } catch { return false; }
  });
  if (stage === "root") {
    return all
      .filter((value) => /^\/marcas\/[^/]+\/nuevo\/?$/i.test(new URL(value).pathname))
      .slice(0, 160)
      .map((url) => ({ kind: "automotive_dealer_catalog", stage: "brand", url, task_key: `brand-${slug(new URL(url).pathname)}` }));
  }
  return all
    .filter((value) => /^\/marcas\/[^/]+\/nuevo\/[^/?#]+\/?$/i.test(new URL(value).pathname))
    .slice(0, 500)
    .map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function portilloDiscovery(html: string, base: string): QueueItem[] {
  return links(html, base)
    .filter((value) => {
      try {
        const url = new URL(value);
        return /(^|\.)portillo\.cl$/i.test(url.hostname) && /^\/marcas\/[^/]+\/nuevo\/[^/?#]+\/?$/i.test(url.pathname);
      } catch { return false; }
    })
    .slice(0, 400)
    .map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function pompeyoDiscovery(html: string, base: string): QueueItem[] {
  return links(html, base)
    .filter((value) => {
      try {
        const url = new URL(value);
        return /(^|\.)pompeyo\.cl$/i.test(url.hostname) && /^\/producto\/[^/?#]+\/?$/i.test(url.pathname);
      } catch { return false; }
    })
    .slice(0, 400)
    .map((url) => ({ kind: "automotive_model_page", stage: "model", url, task_key: slug(new URL(url).pathname) }));
}

function parseRosselot(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const text = htmlToText(html);
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const versionHeading = text.match(/Versiones\s+([^,\n]+),\s*([^\n]+)/i);
  const brand = clean(versionHeading?.[1]) || titleCase(path[1] ?? "");
  const model = clean(versionHeading?.[2]) || clean(firstHeading(html)) || titleCase(path[2] ?? "");
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
    const product = compactProduct(sourceKey, dealer, brand, model, version, url, listPrice, cashPrice, finalPrice, {
      price_confidence: "explicit",
      brand_bonus: brandBonus,
      online_bonus: onlineBonus,
      dealer_bonus: dealerBonus,
      finance_bonus: financeBonus,
    });
    if (product) products.push(product);
  }
  return products;
}

function parseSalazar(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const text = htmlToText(html);
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const brand = titleCase(path[1] ?? "");
  const heading = clean(firstHeading(html)) || clean(metaContent(html, "og:title")) || titleCase(path[3] ?? "");
  const model = clean(heading.replace(/^Nuevo\s+/i, "").replace(new RegExp(`^${brand}\\s+`, "i"), "").replace(/\s+Salazar Israel.*$/i, "").replace(/^Nueva?\s+/i, ""), 160) || titleCase(path[3] ?? "");
  const advertised = price(text.match(/(?:Desde|Precio(?:\s+desde)?)\s*\$?\s*([0-9.]+)/i)?.[1]);
  const bonus = price(text.match(/Incluye\s+bono(?:\s+de)?\s*\$?\s*([0-9.]+)/i)?.[1]) ?? 0;
  const listPrice = advertised && bonus ? advertised + bonus : advertised;
  const product = compactProduct(sourceKey, dealer, brand, model, "Precio desde", url, listPrice, advertised, advertised, {
    price_confidence: "advertised_from",
    list_price_derived: Boolean(advertised && bonus),
    brand_bonus: bonus,
    online_bonus: 0,
    dealer_bonus: 0,
    finance_bonus: 0,
  });
  return product ? [product] : [];
}

function parseDercocenter(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const rows = lines(html);
  const products: AutomotiveProduct[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!/^Precio Lista\s*:/i.test(rows[index])) continue;
    const listPrice = price(rows[index]);
    let finalIndex = index - 1;
    while (finalIndex >= Math.max(0, index - 8) && !price(rows[finalIndex])) finalIndex--;
    if (finalIndex < 0) continue;
    const finalPrice = price(rows[finalIndex]);
    const brandHit = nearestBrand(rows, finalIndex - 1, DERCO_BRANDS, 12);
    if (!brandHit || !finalPrice) continue;
    const candidates = rows.slice(brandHit.index + 1, finalIndex).filter((row) => !/^(SUV|Sed[aá]n|Hatchback|Pickup|Camioneta|El[eé]ctrico|H[ií]brido|Gasolina|Di[eé]sel|DCTO|Descuento|Destacado)/i.test(row) && !/%|\$/.test(row));
    const model = clean(candidates[0], 160);
    const version = clean(candidates[1] ?? "Precio desde", 220);
    if (!model) continue;

    const block = rows.slice(index, Math.min(rows.length, index + 8)).join("\n");
    const financeBonus = valueAfter(block, "Bono Financiamiento") ?? 0;
    const namedBrandBonus = valueAfter(block, "Bono Marca") ?? 0;
    const daysBonus = valueAfter(block, "Bono Días 0KM") ?? valueAfter(block, "Bono Días 0 Km") ?? 0;
    const dealerBonus = daysBonus;
    const brandBonus = namedBrandBonus;
    const derivedCash = listPrice ? Math.max(0, listPrice - brandBonus - dealerBonus) : finalPrice + financeBonus;
    const cashPrice = derivedCash > 0 ? derivedCash : finalPrice + financeBonus;
    const product = compactProduct(sourceKey, dealer, brandHit.brand, model, version, url, listPrice, cashPrice, finalPrice, {
      price_confidence: "explicit_listing",
      brand_bonus: brandBonus,
      online_bonus: 0,
      dealer_bonus: dealerBonus,
      finance_bonus: financeBonus || Math.max(0, cashPrice - finalPrice),
    });
    if (product) products.push(product);
  }
  return [...new Map(products.map((product) => [product.external_id, product])).values()];
}

function parseSalfa(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const rows = lines(html);
  const products: AutomotiveProduct[] = [];
  for (let index = 0; index < rows.length; index++) {
    if (!/^Con financiamiento desde$/i.test(rows[index])) continue;
    const finalPrice = price(rows[index + 1]);
    if (!finalPrice) continue;
    const brandHit = nearestBrand(rows, index - 1, SALFA_BRANDS, 8);
    if (!brandHit) continue;
    const candidates = rows.slice(brandHit.index + 1, index).filter((row) => !/^(Autos|Camionetas|SUV|Ver|Cotizar|Nuevo)/i.test(row) && !/\$|%/.test(row));
    const model = clean(candidates.at(-1), 180);
    if (!model) continue;
    let cashPrice: number | null = null;
    for (let cursor = index + 2; cursor <= Math.min(rows.length - 1, index + 6); cursor++) {
      if (/Precio contado/i.test(rows[cursor])) {
        cashPrice = price(rows[cursor + 1]);
        break;
      }
    }
    cashPrice = cashPrice ?? finalPrice;
    const financeBonus = Math.max(0, cashPrice - finalPrice);
    const product = compactProduct(sourceKey, dealer, brandHit.brand, model, "Precio desde", url, cashPrice, cashPrice, finalPrice, {
      price_confidence: "advertised_from",
      brand_bonus: 0,
      online_bonus: 0,
      dealer_bonus: 0,
      finance_bonus: financeBonus,
    });
    if (product) products.push(product);
  }
  return [...new Map(products.map((product) => [product.external_id, product])).values()];
}

function parsePortillo(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const brand = titleCase(path[1] ?? "");
  const heading = clean(firstHeading(html)) || clean(metaContent(html, "og:title")) || titleCase(path[3] ?? "");
  const model = clean(heading.replace(/^Nuevo\s+/i, "").replace(new RegExp(`^${brand}\\s+`, "i"), "").replace(/\s+Portillo.*$/i, ""), 180) || titleCase(path[3] ?? "");
  const text = htmlToText(html);
  const finalPrice = price(text.match(/(?:Desde|Precio(?:\s+desde)?)\s*\$?\s*([0-9.]+)/i)?.[1]);
  const advertisedBonus = price(text.match(/Incluye\s+bono(?:\s+de)?\s*\$?\s*([0-9.]+)/i)?.[1]) ?? 0;
  const listPrice = finalPrice && advertisedBonus ? finalPrice + advertisedBonus : finalPrice;
  const product = compactProduct(sourceKey, dealer, brand, model, "Precio desde", url, listPrice, finalPrice, finalPrice, {
    price_confidence: "advertised_from",
    list_price_derived: Boolean(finalPrice && advertisedBonus),
    brand_bonus: 0,
    online_bonus: 0,
    dealer_bonus: advertisedBonus,
    finance_bonus: 0,
  });
  return product ? [product] : [];
}

function detectPompeyoIdentity(rows: string[], priceIndex: number) {
  for (let index = priceIndex - 1; index >= Math.max(0, priceIndex - 6); index--) {
    const row = rows[index].replace(/^Nuevo\s+/i, "").trim();
    for (const brand of POMPEYO_BRANDS) {
      if (row.localeCompare(brand, "es", { sensitivity: "base" }) === 0) {
        const next = rows[index + 1] && index + 1 < priceIndex ? rows[index + 1].replace(/^Nuevo\s+/i, "").trim() : "";
        if (next) return { brand, model: next };
      }
      const lowered = row.toLocaleLowerCase("es-CL");
      const brandLower = brand.toLocaleLowerCase("es-CL");
      if (lowered.startsWith(brandLower) && row.length > brand.length) {
        const rest = row.slice(brand.length).replace(/^\s*[-|·:]?\s*/, "").replace(/^Nuevo\s+/i, "").trim();
        if (rest) return { brand, model: rest };
      }
    }
  }
  return null;
}

function parsePompeyo(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const rows = lines(html);
  const products: AutomotiveProduct[] = [];
  const heading = clean(firstHeading(html), 220);
  const singlePrice = rows.map((row, index) => ({ value: price(row), index })).find((item) => item.value && item.index > 0);
  if (heading && singlePrice?.value) {
    const identity = detectPompeyoIdentity([heading, ...rows], (singlePrice.index ?? 0) + 1);
    if (identity) {
      const product = compactProduct(sourceKey, dealer, identity.brand, identity.model, "Precio desde", url, singlePrice.value, singlePrice.value, singlePrice.value, {
        price_confidence: "advertised_from",
        brand_bonus: 0,
        online_bonus: 0,
        dealer_bonus: 0,
        finance_bonus: 0,
      });
      if (product) return [product];
    }
  }

  for (let index = 0; index < rows.length; index++) {
    const finalPrice = price(rows[index]);
    if (!finalPrice || !/^\$?\s*[0-9.$]+(?:\s|$)/.test(rows[index])) continue;
    const identity = detectPompeyoIdentity(rows, index);
    if (!identity) continue;
    const product = compactProduct(sourceKey, dealer, identity.brand, identity.model, "Precio desde", url, finalPrice, finalPrice, finalPrice, {
      price_confidence: "advertised_from",
      brand_bonus: 0,
      online_bonus: 0,
      dealer_bonus: 0,
      finance_bonus: 0,
    });
    if (product) products.push(product);
  }
  return [...new Map(products.map((product) => [product.external_id, product])).values()];
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

function discover(parser: string, html: string, url: string, stage: string): QueueItem[] {
  if (parser === "rosselot") return rosselotDiscovery(html, url);
  if (parser === "salazar_israel") return salazarDiscovery(html, url, stage);
  if (parser === "portillo") return portilloDiscovery(html, url);
  if (parser === "pompeyo") return pompeyoDiscovery(html, url);
  return [];
}

function parse(parser: string, html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  if (parser === "rosselot") return parseRosselot(html, url, sourceKey, dealer);
  if (parser === "salazar_israel") return parseSalazar(html, url, sourceKey, dealer);
  if (parser === "dercocenter") return parseDercocenter(html, url, sourceKey, dealer);
  if (parser === "salfa_automotriz") return parseSalfa(html, url, sourceKey, dealer);
  if (parser === "portillo") return parsePortillo(html, url, sourceKey, dealer);
  if (parser === "pompeyo") return parsePompeyo(html, url, sourceKey, dealer);
  return [];
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

  if (task.kind === "automotive_dealer_catalog") {
    const directProducts = ["dercocenter", "salfa_automotriz"].includes(parser)
      ? parse(parser, html, url, sourceKey, task.supermarket)
      : parser === "pompeyo"
        ? parsePompeyo(html, url, sourceKey, task.supermarket)
        : [];
    const ingested = await ingest(task, directProducts);
    const items = discover(parser, html, url, stage);
    const enqueued = items.length
      ? await rpc<number>("enqueue_automotive_tasks_service", { p_parent_task_id: task.id, p_items: items })
      : 0;
    const state = await finish(task, true, Number(ingested || 0), null);
    return { id: task.id, dealer: task.supermarket, kind: task.kind, stage, parsed: directProducts.length, ingested, discovered: items.length, enqueued, state };
  }

  const products = parse(parser, html, url, sourceKey, task.supermarket);
  const ingested = await ingest(task, products);
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
