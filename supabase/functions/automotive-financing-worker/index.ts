import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = "MGP-AutomotiveFinanceBot/1.0 (+public-pricing-research; rate-limited)";

type Source = {
  id: string;
  source_key: string;
  provider: string;
  source_type: "auto_finance" | "credit_card" | "consumer_credit" | "benchmark";
  product_name: string;
  source_url: string;
  parser_key: string;
  metadata: Record<string, unknown>;
};

type Observation = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function apiHeaders() {
  return { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "content-type": "application/json" };
}
function cleanHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}
function money(text: string | undefined) {
  if (!text) return null;
  const n = Number(text.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function pct(text: string | undefined) {
  if (!text) return null;
  const n = Number(text.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function match(text: string, re: RegExp) { return text.match(re)?.[1]; }
function base(source: Source): Observation {
  return {
    source_id: source.id,
    observed_at: new Date().toISOString(),
    provider: source.provider,
    source_type: source.source_type,
    product_name: source.product_name,
    source_url: source.source_url,
    raw_payload: {},
  };
}
function santander(source: Source, text: string): Observation[] {
  const withoutBonus = money(match(text, /Precio sin bono\s*:?\s*\$?\s*([0-9.]+)/i));
  const financed = money(match(text, /Precio\s*\$?\s*([0-9.]+)\s*incluye bono/i));
  const bonus = money(match(text, /bono(?: con)? financiamiento[^$]{0,120}\$\s*([0-9.]+)/i));
  const pieAmount = money(match(text, /Pie\s*\$\s*([0-9.]+)/i));
  const piePct = pct(match(text, /Pie (?:del )?([0-9]+(?:[,.][0-9]+)?)\s*%/i));
  const cae = pct(match(text, /CAE\s*([0-9]+(?:[,.][0-9]+)?)\s*%/i));
  const ctc = money(match(text, /CTC(?: de)?\s*\$\s*([0-9.]+)/i));
  const installmentCount = Number(match(text, /([0-9]{1,2})\s+cuotas? de\s*\$\s*[0-9.]+/i) || 0) || null;
  const installment = money(match(text, /[0-9]{1,2}\s+cuotas? de\s*\$\s*([0-9.]+)/i));
  const balloon = money(match(text, /VFMG[^$]{0,100}\$\s*([0-9.]+)/i));
  if (!cae && !ctc && !installment) return [];
  const meta = source.metadata || {};
  return [{
    ...base(source),
    brand: typeof meta.brand === "string" ? meta.brand : null,
    model: typeof meta.model === "string" ? meta.model : null,
    vehicle_price: withoutBonus,
    financed_price: financed,
    finance_bonus: bonus,
    down_payment_pct: piePct,
    down_payment_amount: pieAmount,
    term_months: installmentCount ? installmentCount + (balloon ? 1 : 0) : null,
    installments_count: installmentCount,
    installment_amount: installment,
    balloon_amount: balloon,
    cae_pct: cae,
    loan_amount: pieAmount,
    credit_total_cost: ctc,
    vehicle_total_cost: ctc && pieAmount ? ctc + pieAmount : null,
    confidence: "published",
    raw_payload: { parser: source.parser_key, capture: "public promotion" },
  }];
}
function scotia(source: Source, text: string): Observation[] {
  const scoped = text.match(/12 a 36 Cuotas al[\s\S]{0,1800}/i)?.[0] || text;
  const rate = pct(match(scoped, /12 a 36 Cuotas al\s*([0-9]+(?:[,.][0-9]+)?)% mensual/i));
  const cae = pct(match(scoped, /CAE\s*:?\s*([0-9]+(?:[,.][0-9]+)?)%/i));
  const ctc = money(match(scoped, /Costo Total del Crédito\s*:?\s*\$?\s*([0-9.]+)/i));
  const amount = money(match(scoped, /monto de\s*\$?\s*([0-9.]+)\s*en 36 cuotas/i));
  if (rate === null) return [];
  return [{ ...base(source), monthly_rate_pct: rate, cae_pct: cae, loan_amount: amount, credit_total_cost: ctc, term_months: 36, installments_count: 36, confidence: "published", raw_payload: { termRange: "12-36", category: "automotoras" } }];
}
function bancoChile(source: Source, text: string): Observation[] {
  const scoped = text.match(/compra referencial[\s\S]{0,600}/i)?.[0] || text;
  const cae = pct(match(scoped, /CAE\s*:?\s*([0-9]+(?:[,.][0-9]+)?)%/i));
  const amount = money(match(scoped, /compra referencial de\s*\$?\s*([0-9.]+)/i));
  const ctc = money(match(scoped, /Costo Total\s*:?\s*\$?\s*([0-9.]+)/i));
  if (!/3 cuotas sin interés/i.test(text)) return [];
  return [{ ...base(source), monthly_rate_pct: 0, cae_pct: cae, loan_amount: amount, credit_total_cost: ctc, term_months: 3, installments_count: 3, confidence: "published", raw_payload: { category: "compras nacionales", taxesApply: true } }];
}
function conditions(source: Source, text: string): Observation[] {
  let pie: number | null = null;
  let term: number | null = null;
  let note = "";
  switch (source.parser_key) {
    case "forum_conditions":
      pie = pct(match(text, /pie desde\s*([0-9]+(?:[,.][0-9]+)?)\s*%/i)) ?? 20;
      term = Number(match(text, /hasta\s*([0-9]{2})\s*cuotas/i) || 72);
      note = "Condiciones generales publicadas; la tasa depende de simulación/evaluación.";
      break;
    case "tanner_conditions":
      pie = pct(match(text, /(?:pie|desde)\D{0,30}([0-9]{2})\s*%/i)) ?? 20;
      term = Number(match(text, /(?:hasta|12 a)\D{0,20}([0-9]{2})\s*(?:meses|cuotas)/i) || 60);
      note = "Crédito automotriz convencional; sujeto a evaluación.";
      break;
    case "amicar_conditions":
      pie = pct(match(text, /pie\D{0,30}([0-9]{2})\s*%/i)) ?? 10;
      term = Number(match(text, /(?:hasta|12 a)\D{0,20}([0-9]{2})\s*(?:meses|cuotas)/i) || 60);
      note = "Condiciones generales Amicar; tasa no publicada de forma homogénea.";
      break;
    case "gm_conditions":
      pie = 0; term = 72; note = "Plan tradicional: pie y plazo sujetos a producto/evaluación.";
      break;
    case "bci_card_auto":
      term = 24; note = "Beneficio automotriz publicado para comercios/segmentos elegibles; validar condiciones vigentes.";
      break;
    case "bancoestado_card":
      term = 12; note = "Beneficio de bienvenida para tarjetas elegibles; no universal.";
      break;
    default:
      return [];
  }
  return [{ ...base(source), down_payment_pct: pie, term_months: term, confidence: "conditions_only", raw_payload: { note } }];
}
function parse(source: Source, text: string) {
  if (source.parser_key === "santander_promo") return santander(source, text);
  if (source.parser_key === "scotia_card_auto") return scotia(source, text);
  if (source.parser_key === "bch_card_general") return bancoChile(source, text);
  return conditions(source, text);
}
async function verifyToken(token: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_automotive_financing_worker_token`, {
    method: "POST", headers: apiHeaders(), body: JSON.stringify({ p_token: token }),
  });
  return response.ok && (await response.json()) === true;
}
async function sources(): Promise<Source[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/automotive_financing_sources?active=eq.true&select=id,source_key,provider,source_type,product_name,source_url,parser_key,metadata&order=priority.desc`, { headers: apiHeaders() });
  if (!response.ok) throw new Error(`sources_${response.status}_${(await response.text()).slice(0,200)}`);
  return await response.json();
}
async function save(rows: Observation[]) {
  if (!rows.length) return;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/automotive_financing_observations`, {
    method: "POST", headers: { ...apiHeaders(), Prefer: "return=minimal" }, body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`insert_${response.status}_${(await response.text()).slice(0,300)}`);
}
async function status(source: Source, state: string, error: string | null) {
  await fetch(`${SUPABASE_URL}/rest/v1/automotive_financing_sources?id=eq.${source.id}`, {
    method: "PATCH", headers: { ...apiHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ last_scraped_at: new Date().toISOString(), last_status: state, last_error: error, updated_at: new Date().toISOString() }),
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "server_not_configured" }, 500);
  const token = request.headers.get("x-automotive-financing-token") || "";
  if (!token || !(await verifyToken(token))) return json({ error: "unauthorized" }, 401);

  const list = await sources();
  const results: unknown[] = [];
  for (const source of list) {
    try {
      const response = await fetch(source.source_url, { headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "es-CL,es;q=0.9" }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`source_${response.status}`);
      const text = cleanHtml(await response.text()).slice(0, 250000);
      const rows = parse(source, text);
      await save(rows);
      await status(source, rows.length ? "ok" : "no_structured_offer", null);
      results.push({ source: source.source_key, ok: true, observations: rows.length });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (["forum_conditions","tanner_conditions","amicar_conditions","gm_conditions","bci_card_auto","bancoestado_card"].includes(source.parser_key)) {
        const fallback = conditions(source, "");
        await save(fallback);
        await status(source, "fallback_conditions", message.slice(0, 800));
        results.push({ source: source.source_key, ok: true, fallback: true, observations: fallback.length });
      } else {
        await status(source, "error", message.slice(0, 800));
        results.push({ source: source.source_key, ok: false, error: message });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return json({ ok: true, sources: list.length, results, completedAt: new Date().toISOString() });
});
