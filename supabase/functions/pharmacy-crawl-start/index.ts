import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Payload = {
  mode?: "pilot" | "full";
  retailers?: string[];
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ALLOWED = new Set(["Salcobrand", "Cruz Verde", "Farmacias Ahumada"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase service credentials unavailable");
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
  if (!response.ok) throw new Error(`RPC ${name} ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function normalizeRetailers(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error("retailers must be an array");
  const result = [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  if (result.some((item) => !ALLOWED.has(item))) throw new Error("Unsupported pharmacy retailer");
  return result.length ? result : null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const payload = await request.json().catch(() => ({})) as Payload;
    const mode = payload.mode === "full" ? "full" : "pilot";
    const retailers = normalizeRetailers(payload.retailers);
    const runId = await rpc<number>("start_pharmacy_crawl_service", {
      p_mode: mode,
      p_retailers: retailers,
    });
    const status = await rpc<Record<string, unknown>>("pharmacy_crawl_status_service", {
      p_run_id: runId,
    });
    return json({ ok: true, runId, mode, retailers, status });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});