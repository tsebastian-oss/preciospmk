import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Target = { slug: string; retailer: string; timeoutMs: number };
type Result = { slug: string; retailer: string; status: number; ok: boolean; durationMs: number; body: unknown };
type DispatchRequest = { only?: "automotive" | "lider" | "falabella" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DB_PROBE_TIMEOUT_MS = 3500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function databaseHealthy() {
  if (!SUPABASE_URL || !SERVICE_ROLE) return { ok: false, reason: "missing_supabase_credentials", durationMs: 0 };
  const started = Date.now();
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/catalog_crawl_runs?select=id&order=id.desc&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
        signal: AbortSignal.timeout(DB_PROBE_TIMEOUT_MS),
      },
    );
    return {
      ok: response.ok,
      reason: response.ok ? "healthy" : `db_probe_http_${response.status}`,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
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
    const raw = await response.text();
    let body: unknown = raw;
    try { body = JSON.parse(raw); } catch {}
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

  const health = await databaseHealthy();
  if (!health.ok) {
    return json({
      ok: true,
      skipped: true,
      reason: "database_backpressure",
      health,
      dispatched: 0,
    });
  }

  const automotive: Target = { slug: "automotive-crawl-worker", retailer: "Automotriz", timeoutMs: 70_000 };
  const liderDiscovery: Target = { slug: "lider-discovery-worker", retailer: "Lider discovery", timeoutMs: 50_000 };
  const liderProduct: Target = { slug: "lider-crawl-worker", retailer: "Lider", timeoutMs: 50_000 };
  const falabella: Target = { slug: "falabella-listing-worker", retailer: "Falabella", timeoutMs: 70_000 };

  let target: Target;
  if (input.only === "automotive") target = automotive;
  else if (input.only === "lider") target = liderDiscovery;
  else if (input.only === "falabella") target = falabella;
  else {
    const rotation: Target[] = [
      { slug: "catalog-crawl-worker", retailer: "Jumbo/Santa Isabel", timeoutMs: 50_000 },
      liderDiscovery,
      liderProduct,
      { slug: "department-store-crawl-worker-v4", retailer: "Paris", timeoutMs: 70_000 },
      falabella,
      { slug: "pharmacy-crawl-worker", retailer: "Salcobrand/Cruz Verde/Ahumada", timeoutMs: 70_000 },
      { slug: "home-improvement-crawl-worker", retailer: "Easy/Sodimac", timeoutMs: 70_000 },
      automotive,
      { slug: "jumbo-price-refresh-worker", retailer: "Jumbo price refresh", timeoutMs: 50_000 },
    ];
    const slot = Math.floor(Date.now() / 60_000) % rotation.length;
    target = rotation[slot];
  }

  const started = Date.now();
  const result = await invoke(target);
  return json({
    ok: result.ok,
    skipped: false,
    dispatched: 1,
    concurrency: 1,
    durationMs: Date.now() - started,
    result,
    health,
  }, result.ok ? 200 : 502);
});
