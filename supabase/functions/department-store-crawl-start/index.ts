import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type StartPayload = {
  mode?: "pilot" | "full";
  retailers?: string[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ALLOWED_RETAILERS = new Set(["Paris", "Falabella", "Ripley"]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase service credentials are unavailable");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Supabase RPC ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

function normalizeRetailers(input: unknown): string[] | null {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) throw new Error("retailers must be an array");
  const retailers = [...new Set(input.map((item) => String(item).trim()).filter(Boolean))];
  if (retailers.some((item) => !ALLOWED_RETAILERS.has(item))) {
    throw new Error("retailers contains an unsupported department store");
  }
  return retailers.length ? retailers : null;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const payload = await request.json().catch(() => ({})) as StartPayload;
    const mode = payload.mode === "full" ? "full" : "pilot";
    const retailers = normalizeRetailers(payload.retailers);
    const runId = await rpc<number>("start_department_store_crawl_service", {
      p_mode: mode,
      p_retailers: retailers,
    });
    const status = await rpc<Record<string, unknown>>("department_store_crawl_status_service", {
      p_run_id: runId,
    });
    return json({ ok: true, runId, mode, retailers, status });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
