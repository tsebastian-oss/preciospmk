import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Target = {
  slug: string;
  retailer: string;
  timeoutMs: number;
};

type Result = {
  slug: string;
  retailer: string;
  status: number;
  ok: boolean;
  durationMs: number;
  body: unknown;
};

type DispatchRequest = {
  only?: "automotive" | "lider" | "falabella";
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// Keep the global pool conservative to avoid connection storms. High-volume
// queues get several small passes at the front instead of higher concurrency.
const MAX_CONCURRENCY = 2;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function invoke(target: Target): Promise<Result> {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL unavailable");
  const started = Date.now();
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${target.slug}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(SERVICE_ROLE ? { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } : {}),
      },
      body: "{}",
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep plain-text error responses for observability.
    }
    return {
      slug: target.slug,
      retailer: target.retailer,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - started,
      body,
    };
  } catch (error) {
    return {
      slug: target.slug,
      retailer: target.retailer,
      status: 599,
      ok: false,
      durationMs: Date.now() - started,
      body: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function runPool(targets: Target[]): Promise<Result[]> {
  const results: Result[] = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= targets.length) return;
      results[index] = await invoke(targets[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, targets.length) }, () => worker()));
  return results;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let input: DispatchRequest = {};
  try {
    const raw = await request.text();
    if (raw.trim()) input = JSON.parse(raw) as DispatchRequest;
  } catch {
    return json({ error: "invalid_request_body" }, 400);
  }
  if (input.only && !["automotive", "lider", "falabella"].includes(input.only)) {
    return json({ error: "unsupported_dispatch_target" }, 400);
  }

  const automotiveTarget: Target = { slug: "automotive-crawl-worker", retailer: "Automotriz", timeoutMs: 125_000 };
  const liderDiscoveryTarget: Target = { slug: "lider-discovery-worker", retailer: "Lider discovery", timeoutMs: 55_000 };
  const liderProductTarget: Target = { slug: "lider-crawl-worker", retailer: "Lider product fallback", timeoutMs: 55_000 };
  const falabellaTarget: Target = { slug: "falabella-listing-worker", retailer: "Falabella", timeoutMs: 125_000 };
  const minute = new Date().getUTCMinutes();

  let targets: Target[];
  if (input.only === "automotive") {
    targets = [automotiveTarget];
  } else if (input.only === "lider") {
    targets = [
      liderDiscoveryTarget,
      liderDiscoveryTarget,
      liderDiscoveryTarget,
      liderProductTarget,
      liderProductTarget,
    ];
  } else if (input.only === "falabella") {
    targets = [falabellaTarget, falabellaTarget, falabellaTarget];
  } else {
    targets = [
      { slug: "catalog-crawl-worker", retailer: "Jumbo/Santa Isabel", timeoutMs: 55_000 },
      liderDiscoveryTarget,
      liderDiscoveryTarget,
      liderDiscoveryTarget,
      liderProductTarget,
      liderProductTarget,
      { slug: "department-store-crawl-worker-v4", retailer: "Paris", timeoutMs: 125_000 },
      { slug: "department-store-crawl-worker-v4", retailer: "Paris", timeoutMs: 125_000 },
      { slug: "department-store-crawl-worker-v4", retailer: "Paris", timeoutMs: 125_000 },
      falabellaTarget,
      falabellaTarget,
      falabellaTarget,
      { slug: "pharmacy-crawl-worker", retailer: "Salcobrand/Cruz Verde/Ahumada", timeoutMs: 125_000 },
      { slug: "home-improvement-crawl-worker", retailer: "Easy/Sodimac", timeoutMs: 125_000 },
      { slug: "home-improvement-crawl-worker", retailer: "Easy/Sodimac", timeoutMs: 125_000 },
      automotiveTarget,
    ];
  }

  if (!input.only && minute % 5 === 0) {
    targets.push({ slug: "jumbo-price-refresh-worker", retailer: "Jumbo price refresh", timeoutMs: 55_000 });
  }

  const started = Date.now();
  const results = await runPool(targets);
  const failures = results.filter((item) => !item.ok);
  return json({
    ok: failures.length === 0,
    scope: input.only ?? "all",
    dispatched: targets.length,
    succeeded: results.length - failures.length,
    failed: failures.length,
    durationMs: Date.now() - started,
    concurrency: MAX_CONCURRENCY,
    results,
  }, failures.length === results.length ? 502 : 200);
});
