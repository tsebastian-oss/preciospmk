type ValueRecord = Record<string, unknown>;

type DiscoveryTask = {
  id: number;
  run_id: number;
  kind: "lider_browse_sitemap" | "lider_listing";
  payload: ValueRecord;
};

type QueueTask = {
  task_key: string;
  supermarket: "Lider";
  kind: "lider_listing" | "lider_product_page";
  payload: ValueRecord;
};

type Product = {
  supermarket: "Lider";
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const PAGE_SIZE = 48;

function output(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function objectValue(value: unknown): ValueRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ValueRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? Math.floor(value) : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function priceValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return undefined;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function allowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "super.lider.cl") {
    throw new Error(`Blocked Lider URL: ${url.hostname}`);
  }
  return url;
}

function categoryFromUrl(raw: string): string | null {
  try {
    const parts = new URL(raw).pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part).replace(/[-_]+/g, " ").trim())
      .filter(Boolean);
    const browseIndex = parts.findIndex((part) => part.toLowerCase() === "browse");
    if (browseIndex >= 0 && parts[browseIndex + 1]) return parts[browseIndex + 1];
    return null;
  } catch {
    return null;
  }
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase credentials");
  const result = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!result.ok) throw new Error(`RPC ${name} ${result.status}: ${await result.text()}`);
  return result.json() as Promise<T>;
}

async function fetchText(raw: string, xml = false) {
  const url = allowedUrl(raw);
  const result = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      ...(xml ? { accept: "application/xml,text/xml,text/plain,*/*" } : {}),
      "accept-language": "es-CL,es;q=0.9,en;q=0.7",
      "cache-control": "no-cache",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(40_000),
  });
  if (!result.ok) throw new Error(`HTTP ${result.status}: ${url}`);
  return result.text();
}

function productUrls(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => productUrls(item, result));
    return result;
  }

  const node = objectValue(value);
  if (!node) return result;
  const rawType = node["@type"];
  const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType ?? "")];
  if (types.includes("ListItem") || types.includes("Product")) {
    const nested = objectValue(node.item);
    const rawUrl = stringValue(node.url) ?? stringValue(nested?.url) ?? stringValue(node["@id"]);
    if (rawUrl) {
      try {
        const url = allowedUrl(rawUrl);
        if (url.pathname.toLowerCase().includes("/ip/")) result.add(url.toString());
      } catch {
        // Ignore links outside Lider's public catalog.
      }
    }
  }

  for (const [key, child] of Object.entries(node)) {
    if (key !== "@context" && child && typeof child === "object") {
      productUrls(child, result);
    }
  }
  return result;
}

function embeddedProductRecords(html: string): ValueRecord[] {
  const marker = '{"__typename":"Product"';
  const products: ValueRecord[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const start = html.indexOf(marker, cursor);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let index = start; index < html.length; index += 1) {
      const character = html[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }

    if (end < 0) break;
    try {
      const parsed = JSON.parse(html.slice(start, end));
      const record = objectValue(parsed);
      if (record) products.push(record);
    } catch {
      // Continue after malformed framework payloads.
    }
    cursor = end;
  }

  return products;
}

function embeddedProduct(node: ValueRecord): Product | undefined {
  const name = stringValue(node.name);
  const externalId = String(node.usItemId ?? node.offerId ?? "").trim();
  const priceInfo = objectValue(node.priceInfo) ?? {};
  const price = priceValue(node.price) ?? priceValue(priceInfo.linePrice) ?? priceValue(priceInfo.itemPrice);
  if (!name || !externalId || !price) return undefined;

  const regularCandidates = [
    priceValue(priceInfo.wasPrice),
    priceValue(priceInfo.linePriceDisplay),
  ].filter((item): item is number => item !== undefined && item > price);
  const category = objectValue(node.category);
  const categoryPath = Array.isArray(category?.path)
    ? category.path
      .map(objectValue)
      .map((item) => stringValue(item?.name))
      .filter((item): item is string => Boolean(item))
    : [];
  const imageInfo = objectValue(node.imageInfo);
  const canonicalPath = stringValue(node.canonicalUrl);
  const productUrl = canonicalPath
    ? new URL(canonicalPath, "https://super.lider.cl").toString()
    : `https://super.lider.cl/ip/producto/${externalId}`;
  const unitPriceText = stringValue(priceInfo.unitPrice);
  const unitMatch = unitPriceText?.match(/x\s+(.+)$/i);
  const availability = String(objectValue(node.availabilityStatusV2)?.value ?? "").toUpperCase();

  return {
    supermarket: "Lider",
    external_id: externalId,
    name,
    brand: stringValue(node.brand) ?? null,
    category: categoryPath.length ? categoryPath.join(" > ") : categoryFromUrl(productUrl),
    url: productUrl,
    image_url: stringValue(imageInfo?.thumbnailUrl) ?? stringValue(node.image) ?? null,
    regular_price: regularCandidates.length ? Math.max(...regularCandidates) : null,
    offer_price: price,
    unit: unitMatch?.[1]?.trim() ?? null,
    unit_price: priceValue(unitPriceText) ?? null,
    in_stock: node.isOutOfStock !== true && availability !== "OUT_OF_STOCK",
    observed_at: new Date().toISOString(),
  };
}

function embeddedProducts(html: string): Product[] {
  const unique = new Map<string, Product>();
  for (const record of embeddedProductRecords(html)) {
    const product = embeddedProduct(record);
    if (product) unique.set(product.external_id, product);
  }
  return [...unique.values()];
}

function totalResults(html: string): number | undefined {
  const heading = html.match(
    /<h1[^>]*>[\s\S]*?<span[^>]*>\s*\(([0-9.]+)\)\s*<\/span>[\s\S]*?<\/h1>/i,
  );
  if (heading) return positiveInteger(heading[1]);
  const embedded = html.match(
    /(?:totalResults|totalCount|numberOfResults)["']?\s*[:=]\s*["']?([0-9.]+)/i,
  );
  return embedded ? positiveInteger(embedded[1]) : undefined;
}

function listingUrl(raw: string, page: number) {
  const url = allowedUrl(raw);
  url.searchParams.set("sortingorder", "ascending");
  url.searchParams.set("itemsperpage", String(PAGE_SIZE));
  url.searchParams.set("display", "grid");
  url.searchParams.set("pagenumber", String(page));
  return url.toString();
}

async function enqueue(runId: number, tasks: QueueTask[]) {
  let inserted = 0;
  for (let offset = 0; offset < tasks.length; offset += 250) {
    inserted += await rpc<number>("enqueue_catalog_tasks_service", {
      p_run_id: runId,
      p_tasks: tasks.slice(offset, offset + 250),
    });
  }
  return inserted;
}

async function discover(task: DiscoveryTask): Promise<{ products: Product[]; tasks: QueueTask[] }> {
  if (task.kind === "lider_browse_sitemap") {
    const raw = stringValue(task.payload.url);
    if (!raw) throw new Error("Invalid Lider browse sitemap task");
    const xml = await fetchText(raw, true);
    const unique = new Map<string, QueueTask>();
    for (const match of xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)) {
      const location = decodeXml(match[1]);
      try {
        const url = allowedUrl(location);
        if (!url.pathname.toLowerCase().startsWith("/browse/")) continue;
        const canonical = url.toString();
        unique.set(`lider-listing:${canonical}:1`, {
          task_key: `lider-listing:${canonical}:1`,
          supermarket: "Lider",
          kind: "lider_listing",
          payload: { url: canonical, page: 1 },
        });
      } catch {
        // Ignore invalid locations.
      }
    }
    if (!unique.size) throw new Error("No Lider shelves found");
    return { products: [], tasks: [...unique.values()] };
  }

  const raw = stringValue(task.payload.url);
  const page = Math.max(1, positiveInteger(task.payload.page) ?? 1);
  if (!raw) throw new Error("Invalid Lider listing task");
  const html = await fetchText(listingUrl(raw, page));
  const products = embeddedProducts(html);
  const urls = new Set<string>();
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      productUrls(JSON.parse(match[1]), urls);
    } catch {
      // Ignore malformed analytics blocks.
    }
  }

  const tasks = new Map<string, QueueTask>();

  // Some Lider shelves include complete product records, while others only
  // expose product links in JSON-LD. Keep the existing per-product worker as
  // a fallback so either server-rendered shape can complete the daily crawl.
  if (!products.length) {
    urls.forEach((url) => {
      tasks.set(`lider-product-page:${url}`, {
        task_key: `lider-product-page:${url}`,
        supermarket: "Lider",
        kind: "lider_product_page",
        payload: { url },
      });
    });
  }

  // A shelf can remain in Lider's sitemap after its assortment becomes empty.
  // Treat that as a successful zero-result page instead of poisoning the run.

  if (page === 1) {
    const total = totalResults(html);
    const pages = total
      ? Math.min(1000, Math.max(1, Math.ceil(total / PAGE_SIZE)))
      : Math.max(products.length, urls.size) >= PAGE_SIZE
        ? 2
        : 1;
    for (let next = 2; next <= pages; next += 1) {
      tasks.set(`lider-listing:${raw}:${next}`, {
        task_key: `lider-listing:${raw}:${next}`,
        supermarket: "Lider",
        kind: "lider_listing",
        payload: { url: raw, page: next },
      });
    }
  } else if (Math.max(products.length, urls.size) >= PAGE_SIZE && page < 1000) {
    const next = page + 1;
    tasks.set(`lider-listing:${raw}:${next}`, {
      task_key: `lider-listing:${raw}:${next}`,
      supermarket: "Lider",
      kind: "lider_listing",
      payload: { url: raw, page: next },
    });
  }
  return { products, tasks: [...tasks.values()] };
}

async function handle(task: DiscoveryTask) {
  try {
    const result = await discover(task);
    const tasksInserted = await enqueue(task.run_id, result.tasks);
    const completion = await rpc<ValueRecord>("complete_catalog_task_service", {
      p_task_id: task.id,
      p_products: result.products,
      p_error: null,
    });
    return {
      taskId: task.id,
      kind: task.kind,
      products: result.products.length,
      discovered: result.tasks.length,
      tasksInserted,
      completion,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completion = await rpc<ValueRecord>("complete_catalog_task_service", {
      p_task_id: task.id,
      p_products: [],
      p_error: message,
    });
    return { taskId: task.id, kind: task.kind, error: message, completion };
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return output({ error: "Method not allowed" }, 405);
  const body = await request.text();
  if (body && body !== "{}") return output({ error: "Request body is not accepted" }, 400);

  try {
    const tasks = await rpc<DiscoveryTask[]>("claim_lider_discovery_tasks_service", {
      p_limit: 2,
    });
    if (!tasks.length) {
      return output({
        ok: true,
        claimed: 0,
        status: await rpc("catalog_crawl_status_service", { p_run_id: null }),
      });
    }
    const results = await Promise.all(tasks.map(handle));
    return output({
      ok: true,
      claimed: tasks.length,
      results,
      status: await rpc("catalog_crawl_status_service", { p_run_id: tasks[0].run_id }),
    });
  } catch (error) {
    return output({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
