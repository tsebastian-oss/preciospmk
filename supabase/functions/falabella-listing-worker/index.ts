import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Json = Record<string, unknown>;
type Task = { id: number; run_id: number; supermarket: string; kind: string; payload: Json; attempts: number };
type QueueTask = { task_key: string; supermarket: string; kind: string; payload: Json };
type Product = {
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
  unit: null;
  unit_price: null;
  in_stock: boolean;
  observed_at: string;
  source_metadata: Json;
};
type PriceLevel = { external_id: string; price_type: string; price: number; currency: string; observed_at: string; metadata: Json };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
function record(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : null;
}
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^0-9,-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
function integer(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}
function slug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "Categoria";
}
function hash(value: string) {
  let output = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 16777619);
  }
  return (output >>> 0).toString(36);
}
function allowedUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "www.falabella.com" || !url.pathname.startsWith("/falabella-cl/")) {
    throw new Error(`Blocked Falabella URL: ${url.toString()}`);
  }
  url.hash = "";
  for (const key of ["mkid", "sid", "utm_source", "utm_medium", "utm_campaign", "pid", "pgid"]) url.searchParams.delete(key);
  return url;
}
async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase service credentials unavailable");
  const request = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  if (!request.ok) throw new Error(`RPC ${name} ${request.status}: ${await request.text()}`);
  return request.json() as Promise<T>;
}
async function fetchPage(rawUrl: string, page: number) {
  const url = allowedUrl(rawUrl);
  if (page > 1) url.searchParams.set("page", String(page));
  const request = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "es-CL,es;q=0.9", "cache-control": "no-cache" },
    redirect: "follow", signal: AbortSignal.timeout(55_000),
  });
  if (!request.ok) throw new Error(`HTTP ${request.status} for ${url.toString()}`);
  return { html: await request.text(), url: url.toString() };
}
function nextData(html: string): Json {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("Falabella __NEXT_DATA__ not found");
  const end = html.indexOf("</script>", start + marker.length);
  if (end < 0) throw new Error("Falabella __NEXT_DATA__ is incomplete");
  return JSON.parse(html.slice(start + marker.length, end)) as Json;
}
function pageProps(data: Json) {
  const props = record(data.props);
  const page = record(props?.pageProps);
  if (!page) throw new Error("Falabella pageProps not found");
  return page;
}
function prices(raw: unknown) {
  if (!Array.isArray(raw)) return [] as Array<{ type: string; price: number; crossed: boolean }>;
  return raw.flatMap((entry, index) => {
    const item = record(entry);
    const values = Array.isArray(item?.price) ? item?.price : [item?.price];
    const price = numberValue(values[0]);
    if (price === null || price <= 0) return [];
    return [{ type: stringValue(item?.type) ?? `price_${index + 1}`, price, crossed: Boolean(item?.crossed) }];
  });
}
function effective(levels: Array<{ type: string; price: number; crossed: boolean }>) {
  const internet = levels.find((item) => item.type.toLowerCase().includes("internet"));
  const nonCrossed = levels.filter((item) => !item.crossed);
  const selected = internet ?? nonCrossed.sort((a, b) => a.price - b.price)[0] ?? levels.sort((a, b) => a.price - b.price)[0];
  const normal = levels.find((item) => item.type.toLowerCase().includes("normal"))
    ?? levels.filter((item) => item.crossed).sort((a, b) => b.price - a.price)[0]
    ?? levels.sort((a, b) => b.price - a.price)[0];
  return { offer: selected?.price ?? 0, regular: normal && normal.price > (selected?.price ?? 0) ? normal.price : null };
}
function firstImage(value: unknown): string | null {
  return Array.isArray(value) ? stringValue(value[0]) : stringValue(value);
}
function productsFromResult(raw: unknown, categoryName: string, sourceUrl: string, observedAt: string) {
  const item = record(raw);
  if (!item) return { products: [] as Product[], priceLevels: [] as PriceLevel[] };
  const productId = String(item.productId ?? item.skuId ?? "").trim();
  const baseSku = String(item.skuId ?? item.productId ?? "").trim();
  const name = stringValue(item.displayName);
  const url = stringValue(item.url);
  if (!productId || !baseSku || !name || !url) return { products: [] as Product[], priceLevels: [] as PriceLevel[] };
  const brand = stringValue(item.brand);
  const seller = stringValue(item.sellerName);
  const sellerId = stringValue(item.sellerId);
  const image = firstImage(item.mediaUrls);
  const baseLevels = prices(item.prices);
  const output = new Map<string, Product>();
  const levelRows: PriceLevel[] = [];

  function add(externalId: string, variant: string | null, variantUrl: string, variantImage: string | null, rawLevels: unknown, inStock: boolean, metadata: Json) {
    const detected = prices(rawLevels);
    const levels = detected.length ? detected : baseLevels;
    const chosen = effective(levels);
    if (!externalId || chosen.offer <= 0) return;
    output.set(externalId, {
      supermarket: "Falabella", external_id: externalId, parent_external_id: externalId === baseSku ? null : productId,
      name: variant ? `${name} · ${variant}` : name, brand, category: categoryName || null, seller, seller_id: sellerId,
      variant, url: variantUrl, image_url: variantImage ?? image, regular_price: chosen.regular, offer_price: chosen.offer,
      unit: null, unit_price: null, in_stock: inStock, observed_at: observedAt,
      source_metadata: {
        parser: "falabella_next_data", productId, baseSku, merchantCategoryId: item.merchantCategoryId,
        GSCCategoryId: item.GSCCategoryId, offeringId: item.offeringId, sourceListing: sourceUrl,
        detectedPrices: levels, ...metadata,
      },
    });
    for (const level of levels) levelRows.push({
      external_id: externalId, price_type: level.type, price: level.price, currency: "CLP", observed_at: observedAt,
      metadata: { crossed: level.crossed, sellerId, productId, variant },
    });
  }

  add(baseSku, null, url, image, item.prices, true, { level: "base" });
  const variants = Array.isArray(item.variants) ? item.variants : [];
  for (const rawVariant of variants) {
    const group = record(rawVariant);
    if (!group || !Array.isArray(group.options)) continue;
    for (const rawOption of group.options) {
      const option = record(rawOption);
      if (!option) continue;
      const optionLabel = stringValue(option.label) ?? stringValue(option.value);
      const optionUrl = stringValue(option.url) ?? url;
      const optionImage = firstImage(option.mediaUrls) ?? image;
      const sizes = Array.isArray(option.sizes) ? option.sizes : [];
      if (sizes.length) {
        for (const rawSize of sizes) {
          const size = record(rawSize);
          if (!size) continue;
          const sizeLabel = stringValue(size.value);
          const externalId = String(size.variant ?? size.offeringId ?? "").trim();
          add(externalId, [optionLabel, sizeLabel].filter(Boolean).join(" / ") || null, optionUrl, firstImage(size.mediaUrls) ?? optionImage,
            size.prices, size.available !== false, { color: optionLabel, size: sizeLabel, offeringId: size.offeringId });
        }
      } else {
        const externalId = String(option.extraInfo ?? option.mediaId ?? "").trim();
        if (externalId && externalId !== baseSku) add(externalId, optionLabel, optionUrl, optionImage, option.prices ?? item.prices, true, { optionType: group.type });
      }
    }
  }
  return { products: [...output.values()], priceLevels: levelRows };
}
function categoryTasks(props: Json, depth: number) {
  if (depth >= 3 || !Array.isArray(props.facets)) return [] as QueueTask[];
  const tasks = new Map<string, QueueTask>();
  for (const rawFacet of props.facets) {
    const facet = record(rawFacet);
    if (!facet || !String(facet.name ?? "").toLowerCase().includes("categor") || !Array.isArray(facet.values)) continue;
    for (const rawValue of facet.values) {
      const value = record(rawValue);
      const id = stringValue(value?.id);
      const title = stringValue(value?.title);
      const count = integer(value?.count, 0);
      if (!id || !title || count <= 0) continue;
      const url = `https://www.falabella.com/falabella-cl/category/${encodeURIComponent(id)}/${slug(title)}`;
      tasks.set(`falabella-listing:${id}:1`, {
        task_key: `falabella-listing:${id}:1`, supermarket: "Falabella", kind: "falabella_listing_page",
        payload: { url, page: 1, depth: depth + 1, category_name: title, discover_categories: true },
      });
    }
  }
  return [...tasks.values()];
}
function paginationTasks(props: Json, canonicalUrl: string, categoryName: string, depth: number, currentPage: number) {
  if (currentPage !== 1) return [] as QueueTask[];
  const pagination = record(props.pagination);
  const count = integer(pagination?.count, 0);
  const perPage = Math.max(1, integer(pagination?.perPage, 48));
  const total = Math.min(200, Math.ceil(count / perPage));
  const base = allowedUrl(canonicalUrl);
  base.searchParams.delete("page");
  const keyBase = hash(base.toString());
  const tasks: QueueTask[] = [];
  for (let page = 2; page <= total; page += 1) tasks.push({
    task_key: `falabella-page:${keyBase}:${page}`, supermarket: "Falabella", kind: "falabella_listing_page",
    payload: { url: base.toString(), page, depth, category_name: categoryName, discover_categories: false },
  });
  return tasks;
}
async function enqueue(runId: number, tasks: QueueTask[]) {
  let inserted = 0;
  for (let index = 0; index < tasks.length; index += 200) {
    inserted += await rpc<number>("enqueue_department_store_tasks_service", { p_run_id: runId, p_tasks: tasks.slice(index, index + 200) });
  }
  return inserted;
}
async function handle(task: Task) {
  try {
    const page = Math.max(1, integer(task.payload.page, 1));
    const depth = Math.max(0, integer(task.payload.depth, 0));
    const categoryName = stringValue(task.payload.category_name) ?? "Catálogo Falabella";
    const rawUrl = stringValue(task.payload.url);
    if (!rawUrl) throw new Error("Falabella listing URL is missing");
    const fetched = await fetchPage(rawUrl, page);
    const props = pageProps(nextData(fetched.html));
    const observedAt = new Date().toISOString();
    const products: Product[] = [];
    const priceLevels: PriceLevel[] = [];
    for (const rawResult of Array.isArray(props.results) ? props.results : []) {
      const parsed = productsFromResult(rawResult, categoryName, fetched.url, observedAt);
      products.push(...parsed.products);
      priceLevels.push(...parsed.priceLevels);
    }
    if (!products.length) throw new Error(`Falabella listing returned no priced products: ${fetched.url}`);
    const canonical = stringValue(props.canonicalUrl) ?? rawUrl;
    const tasks = [
      ...paginationTasks(props, canonical, categoryName, depth, page),
      ...(page === 1 && task.payload.discover_categories !== false ? categoryTasks(props, depth) : []),
    ];
    const tasksInserted = await enqueue(task.run_id, tasks);
    const completion = await rpc<Json>("complete_department_store_task_service", { p_task_id: task.id, p_products: products, p_error: null });
    const pricesInserted = await rpc<number>("record_retail_price_levels_service", { p_run_id: task.run_id, p_retailer: "Falabella", p_rows: priceLevels });
    return { taskId: task.id, page, products: products.length, pricesInserted, tasksInserted, completion };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completion = await rpc<Json>("complete_department_store_task_service", { p_task_id: task.id, p_products: [], p_error: message });
    return { taskId: task.id, error: message, completion };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  if (!SERVICE_ROLE_KEY || request.headers.get("authorization") !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return reply({ error: "unauthorized" }, 401);
  }
  const body = await request.text();
  if (body && body !== "{}") return reply({ error: "request_body_not_accepted" }, 400);
  try {
    const tasks = await rpc<Task[]>("claim_falabella_listing_tasks_service", { p_limit: 2 });
    if (!tasks.length) return reply({ ok: true, claimed: 0 });
    const results = await Promise.all(tasks.map(handle));
    return reply({ ok: true, claimed: tasks.length, results });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
