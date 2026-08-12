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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
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
      headers: { "content-type": "application/json" },
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
  const body = await request.text();
  if (body && body !== "{}") return json({ error: "request_body_not_accepted" }, 400);

  const minute = new Date().getUTCMinutes();
  const targets: Target[] = [
    { slug: "catalog-crawl-worker", retailer: "Jumbo/Santa Isabel", timeoutMs: 55_000 },
    { slug: "lider-crawl-worker", retailer: "Lider", timeoutMs: 55_000 },
    { slug: "department-store-crawl-worker-v4", retailer: "Paris", timeoutMs: 125_000 },
    { slug: "department-store-crawl-worker-v4", retailer: "Paris", timeoutMs: 125_000 },
    { slug: "department-store-crawl-worker-v4", retailer: "Paris", timeoutMs: 125_000 },
    { slug: "falabella-listing-worker", retailer: "Falabella", timeoutMs: 125_000 },
    { slug: "falabella-listing-worker", retailer: "Falabella", timeoutMs: 125_000 },
    { slug: "falabella-listing-worker", retailer: "Falabella", timeoutMs: 125_000 },
    { slug: "pharmacy-crawl-worker", retailer: "Salcobrand/Cruz Verde/Ahumada", timeoutMs: 125_000 },
    { slug: "home-improvement-crawl-worker", retailer: "Easy/Sodimac", timeoutMs: 125_000 },
    { slug: "home-improvement-crawl-worker", retailer: "Easy/Sodimac", timeoutMs: 125_000 },
  ];

  if (minute % 5 === 0) {
    targets.push({ slug: "lider-discovery-worker", retailer: "Lider discovery", timeoutMs: 55_000 });
    targets.push({ slug: "jumbo-price-refresh-worker", retailer: "Jumbo price refresh", timeoutMs: 55_000 });
  }

  const started = Date.now();
  const results = await runPool(targets);
  const failures = results.filter((item) => !item.ok);
  return json({
    ok: failures.length === 0,
    dispatched: targets.length,
    succeeded: results.length - failures.length,
    failed: failures.length,
    durationMs: Date.now() - started,
    concurrency: MAX_CONCURRENCY,
    results,
  }, failures.length === results.length ? 502 : 200);
});