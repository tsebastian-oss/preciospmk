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

async function discover(task: DiscoveryTask): Promise<QueueTask[]> {
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
    return [...unique.values()];
  }

  const raw = stringValue(task.payload.url);
  const page = Math.max(1, positiveInteger(task.payload.page) ?? 1);
  if (!raw) throw new Error("Invalid Lider listing task");
  const html = await fetchText(listingUrl(raw, page));
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
  urls.forEach((url) => {
    tasks.set(`lider-product-page:${url}`, {
      task_key: `lider-product-page:${url}`,
      supermarket: "Lider",
      kind: "lider_product_page",
      payload: { url },
    });
  });

  if (page === 1) {
    const total = totalResults(html);
    const pages = total
      ? Math.min(1000, Math.max(1, Math.ceil(total / PAGE_SIZE)))
      : urls.size >= PAGE_SIZE
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
  } else if (urls.size >= PAGE_SIZE && page < 1000) {
    const next = page + 1;
    tasks.set(`lider-listing:${raw}:${next}`, {
      task_key: `lider-listing:${raw}:${next}`,
      supermarket: "Lider",
      kind: "lider_listing",
      payload: { url: raw, page: next },
    });
  }
  return [...tasks.values()];
}

async function handle(task: DiscoveryTask) {
  try {
    const tasks = await discover(task);
    const tasksInserted = await enqueue(task.run_id, tasks);
    const completion = await rpc<ValueRecord>("complete_catalog_task_service", {
      p_task_id: task.id,
      p_products: [],
      p_error: null,
    });
    return { taskId: task.id, kind: task.kind, discovered: tasks.length, tasksInserted, completion };
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
