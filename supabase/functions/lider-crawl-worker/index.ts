type RecordValue = Record<string, unknown>;

type LiderTask = {
  id: number;
  run_id: number;
  kind:
    | "lider_siteindex"
    | "lider_product_sitemap"
    | "lider_product_batch"
    | "lider_product_page";
  payload: RecordValue;
};

type QueueTask = {
  task_key: string;
  supermarket: "Lider";
  kind: LiderTask["kind"];
  payload: RecordValue;
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
  unit: null;
  unit_price: null;
  in_stock: boolean;
  observed_at: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const BATCH_SIZE = 8;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = Number(
    value.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."),
  );
  return Number.isFinite(parsed) ? parsed : undefined;
}

function liderUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "super.lider.cl") {
    throw new Error(`Blocked Lider URL: ${url.hostname}`);
  }
  return url;
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

async function fetchText(raw: string, xml = false): Promise<string> {
  const url = liderUrl(raw);
  const result = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: xml
        ? "application/xml,text/xml,text/plain,*/*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "es-CL,es;q=0.9,en;q=0.7",
      "cache-control": "no-cache",
      pragma: "no-cache",
      ...(xml
        ? {}
        : {
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "upgrade-insecure-requests": "1",
          }),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(40_000),
  });
  if (!result.ok) throw new Error(`HTTP ${result.status}: ${url}`);
  return result.text();
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

function locations(xml: string) {
  return Array.from(
    xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi),
    (match) => decodeXml(match[1]),
  );
}

function productNodes(value: unknown): RecordValue[] {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  const node = record(value);
  if (!node) return [];
  const result: RecordValue[] = [];
  const rawType = node["@type"];
  if (rawType === "Product" || (Array.isArray(rawType) && rawType.includes("Product"))) {
    result.push(node);
  }
  for (const [key, child] of Object.entries(node)) {
    if (key !== "@context" && child && typeof child === "object") {
      result.push(...productNodes(child));
    }
  }
  return result;
}

function categoryFromUrl(raw: string) {
  try {
    const parts = new URL(raw).pathname.split("/").filter(Boolean);
    const index = parts.indexOf("ip");
    return index >= 0 && parts[index + 1]
      ? decodeURIComponent(parts[index + 1]).replace(/-/g, " ")
      : null;
  } catch {
    return null;
  }
}

function mapProduct(fallbackUrl: string, node: RecordValue): Product | undefined {
  const name = stringValue(node.name);
  if (!name) return undefined;
  const rawOffers = node.offers;
  const offer = record(Array.isArray(rawOffers) ? rawOffers[0] : rawOffers) ?? {};
  const url = stringValue(offer.url) ?? stringValue(node.url) ?? fallbackUrl;
  const sku = String(
    node.sku ?? node.gtin13 ?? node.gtin ?? node.productID ??
      new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url,
  ).trim();
  if (!sku) return undefined;
  const brand = node.brand;
  const brandObject = record(brand);
  const image = Array.isArray(node.image) ? node.image[0] : node.image;
  const imageObject = record(image);
  const price = numeric(offer.price ?? offer.lowPrice) ?? 0;
  const highPrice = numeric(offer.highPrice);
  const availability = String(offer.availability ?? "");

  return {
    supermarket: "Lider",
    external_id: sku,
    name,
    brand: stringValue(brand) ?? stringValue(brandObject?.name) ?? null,
    category: categoryFromUrl(url),
    url,
    image_url: stringValue(image) ?? stringValue(imageObject?.url) ?? null,
    regular_price: highPrice && highPrice > price ? highPrice : null,
    offer_price: price,
    unit: null,
    unit_price: null,
    in_stock: availability ? !availability.includes("OutOfStock") : price > 0,
    observed_at: new Date().toISOString(),
  };
}

async function scrapeProduct(url: string): Promise<Product> {
  const html = await fetchText(url);
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    try {
      for (const node of productNodes(JSON.parse(block[1]))) {
        const product = mapProduct(url, node);
        if (product) return product;
      }
    } catch {
      // Ignore malformed analytics blocks.
    }
  }
  throw new Error(`No Product JSON-LD found at ${url}`);
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

async function processTask(task: LiderTask) {
  if (task.kind === "lider_siteindex") {
    const url = stringValue(task.payload.url);
    if (!url) throw new Error("Invalid Lider siteindex task");
    const tasks = locations(await fetchText(url, true))
      .filter((location) => location.toLowerCase().includes("productsitemap.xml"))
      .map((location): QueueTask => ({
        task_key: `lider-product-sitemap:${location}`,
        supermarket: "Lider",
        kind: "lider_product_sitemap",
        payload: { url: location },
      }));
    if (!tasks.length) throw new Error("No Lider product sitemap found");
    return { products: [] as Product[], tasks };
  }

  if (task.kind === "lider_product_sitemap") {
    const url = stringValue(task.payload.url);
    if (!url) throw new Error("Invalid Lider product sitemap task");
    const productUrls = locations(await fetchText(url, true)).filter((location) => {
      try {
        return liderUrl(location).pathname.toLowerCase().includes("/ip/");
      } catch {
        return false;
      }
    });
    const tasks: QueueTask[] = [];
    for (let offset = 0; offset < productUrls.length; offset += BATCH_SIZE) {
      tasks.push({
        task_key: `lider-product-batch:${url}:${Math.floor(offset / BATCH_SIZE)}`,
        supermarket: "Lider",
        kind: "lider_product_batch",
        payload: { urls: productUrls.slice(offset, offset + BATCH_SIZE) },
      });
    }
    return { products: [] as Product[], tasks };
  }

  if (task.kind === "lider_product_page") {
    const url = stringValue(task.payload.url);
    if (!url) throw new Error("Invalid Lider product task");
    return { products: [await scrapeProduct(url)], tasks: [] as QueueTask[] };
  }

  const urls = Array.isArray(task.payload.urls)
    ? task.payload.urls.map(stringValue).filter((url): url is string => Boolean(url))
    : [];
  if (!urls.length || urls.length > BATCH_SIZE) throw new Error("Invalid Lider batch");
  const settled = await Promise.allSettled(urls.map(scrapeProduct));
  const products: Product[] = [];
  const tasks: QueueTask[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") products.push(result.value);
    else {
      tasks.push({
        task_key: `lider-product-page:${urls[index]}`,
        supermarket: "Lider",
        kind: "lider_product_page",
        payload: { url: urls[index] },
      });
    }
  });
  return { products, tasks };
}

async function handle(task: LiderTask) {
  try {
    const result = await processTask(task);
    const tasksInserted = await enqueue(task.run_id, result.tasks);
    const completion = await rpc<RecordValue>("complete_catalog_task_service", {
      p_task_id: task.id,
      p_products: result.products,
      p_error: null,
    });
    return { taskId: task.id, kind: task.kind, products: result.products.length, tasksInserted, completion };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completion = await rpc<RecordValue>("complete_catalog_task_service", {
      p_task_id: task.id,
      p_products: [],
      p_error: message,
    });
    return { taskId: task.id, kind: task.kind, error: message, completion };
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const body = await request.text();
  if (body && body !== "{}") return response({ error: "Request body is not accepted" }, 400);

  try {
    const tasks = await rpc<LiderTask[]>("claim_lider_catalog_tasks_service", {
      p_limit: 2,
    });
    if (!tasks.length) {
      return response({
        ok: true,
        claimed: 0,
        status: await rpc("catalog_crawl_status_service", { p_run_id: null }),
      });
    }
    const results = await Promise.all(tasks.map(handle));
    return response({
      ok: true,
      claimed: tasks.length,
      results,
      status: await rpc("catalog_crawl_status_service", { p_run_id: tasks[0].run_id }),
    });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
