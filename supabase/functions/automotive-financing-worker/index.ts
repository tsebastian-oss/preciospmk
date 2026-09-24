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
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;|&#160;/gi, " ")
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
function bancoChileAuto(source: Source, text: string): Observation[] {
  const scoped = text.match(/tasa preferencial[\s\S]{0,1800}/i)?.[0] || text;
  const rate = pct(match(scoped, /([0-9]+(?:[,.][0-9]+)?)%\s*mensual/i));
  const annual = pct(match(scoped, /\(([0-9]+(?:[,.][0-9]+)?)%\s*anual\)/i));
  const cae = pct(match(scoped, /CAE\s*:?\s*([0-9]+(?:[,.][0-9]+)?)%/i));
  const amount = money(match(scoped, /compra referencial de\s*\$?\s*([0-9.]+)/i));
  const count = Number(match(scoped, /en\s*([0-9]{1,2})\s*cuotas/i) || 0) || null;
  const installment = money(match(scoped, /[0-9]{1,2}\s*cuotas de\s*\$?\s*([0-9.]+)/i));
  const ctc = money(match(scoped, /Costo total\s*:?\s*\$?\s*([0-9.]+)/i));
  if (rate === null) return [];
  return [{
    ...base(source),
    monthly_rate_pct: rate,
    annual_rate_pct: annual,
    cae_pct: cae,
    loan_amount: amount,
    term_months: count,
    installments_count: count,
    installment_amount: installment,
    credit_total_cost: ctc,
    confidence: "published",
    raw_payload: { category: "automotriz", termRange: "13-36", merchantEligibility: true },
  }];
}

function bancoChile(source: Source, text: string): Observation[] {
  const scoped = text.match(/compra referencial[\s\S]{0,600}/i)?.[0] || text;
  const cae = pct(match(scoped, /CAE\s*:?\s*([0-9]+(?:[,.][0-9]+)?)%/i));
  const amount = money(match(scoped, /compra referencial de\s*\$?\s*([0-9.]+)/i));
  const ctc = money(match(scoped, /Costo Total\s*:?\s*\$?\s*([0-9.]+)/i));
  if (!/3 cuotas sin interés/i.test(text)) return [];
  return [{ ...base(source), monthly_rate_pct: 0, cae_pct: cae, loan_amount: amount, credit_total_cost: ctc, term_months: 3, installments_count: 3, confidence: "published", raw_payload: { category: "compras nacionales", taxesApply: true } }];
}
function forumDate(text: string | undefined): string | null {
  if (!text) return null;
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  const numeric = value.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (numeric) {
    const d = Number(numeric[1]), m = Number(numeric[2]), y = Number(numeric[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return null;
  }
  const months: Record<string, number> = { enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12 };
  const named = value.match(/(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]+)\s+(\d{4})/i);
  if (!named) return null;
  const d = Number(named[1]), m = months[named[2].normalize("NFD").replace(/[\u0300-\u036f]/g,"")] || 0, y = Number(named[3]);
  if (!m) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
function forumBrandFromVehicle(vehicle: string, source: Source): string | null {
  const metaBrand = typeof source.metadata?.brand === "string" ? String(source.metadata.brand) : "";
  if (metaBrand) return metaBrand;
  const v = vehicle.trim();
  const known = ["OMODA","JAECOO","Dongfeng","Foton","BAIC","BYD","Kia","Ford","Geely","Peugeot","Chery","JAC","Suzuki","Mazda","Subaru","Mitsubishi"];
  return known.find(b => v.toLowerCase().startsWith(b.toLowerCase())) || v.split(/\s+/)[0] || null;
}
function forumPromo(source: Source, text: string): Observation[] {
  const normalized = text.replace(/\(1\)\s*/g, "(1) ");
  const blocks = normalized.split(/(?=\(1\)\s*Simulación corresponde a producto)/i).slice(1);
  const rows: Observation[] = [];
  for (const block of blocks.slice(0, 120)) {
    const scoped = block.slice(0, 6500);
    const product = match(scoped, /Simulación corresponde a producto\s+(.+?)\s+operado por Forum Servicios Financieros/i)?.trim() || "Financiamiento Forum";
    const vehicle = match(scoped, /Válido para\s+(.+?)\.\s*Precio lista corresponde/i)?.trim() || null;
    const listPrice = money(match(scoped, /Precio lista corresponde a\s*\$?\s*([0-9.]+)/i));
    const financedPrice = money(match(scoped, /Precio con bono\s*\$?\s*([0-9.]+)/i));
    const totalBonus = money(match(scoped, /incluye bono de\s*\$?\s*([0-9.]+)/i));
    const financingMentions = [...scoped.matchAll(/\$\s*([0-9.]+)\s+con financiamiento Forum/gi)].map(m=>money(m[1])).filter((v): v is number => v!==null);
    const intelligentMentions = [...scoped.matchAll(/\$\s*([0-9.]+)\s+con (?:bono compra|crédito) inteligente/gi)].map(m=>money(m[1])).filter((v): v is number => v!==null);
    const explicitFinanceBonus = [...financingMentions, ...intelligentMentions].reduce((a,b)=>a+b,0);
    const headlinePiePct = pct(match(scoped, /con un\s+([0-9]+(?:[,.][0-9]+)?)%\s+de pie/i));
    const actualPiePct = pct(match(scoped, /y un pie de\s*([0-9]+(?:[,.][0-9]+)?)%\s*\(/i));
    const piePct = actualPiePct ?? headlinePiePct;
    const installmentCount = Number(match(scoped, /([0-9]{1,2})\s+cuotas?\s*(?:y cuotón|de\s*\$)/i) || 0) || null;
    const installment = money(match(scoped, /[0-9]{1,2}\s+cuotas? de\s*\$?\s*([0-9.]+)/i));
    const balloon = money(match(scoped, /(?:más\s+)?cuota n[°ºo]?\s*[0-9]+(?:VFMG)?\s+de\s*\$\s*([0-9.]+)/i));
    const pieAmount = money(match(scoped, /pie de\s*(?:[0-9]+(?:[,.][0-9]+)?%\s*)?\(\$\s*([0-9.]+)\)/i));
    const cae = pct(match(scoped, /CAE\s*([0-9]+(?:[,.][0-9]+)?)%/i));
    const ctc = money(match(scoped, /Costo Total del Crédito\s*\$?\s*([0-9.]+)/i));
    const loanAmount = money(match(scoped, /Monto Total del Crédito\s*\$?\s*([0-9.]+)/i));
    const vehicleTotal = money(match(scoped, /Costo Total del Vehículo\s*\$?\s*([0-9.]+)/i));
    const validText = match(scoped, /Vigencia\s*promoción\s*hasta\s+([^\.]+?)(?:\.|Stock|$)/i);
    const validUntil = forumDate(validText);
    if (!vehicle || (!cae && !ctc && !installment)) continue;
    const brand = forumBrandFromVehicle(vehicle, source);
    const financingBonus = explicitFinanceBonus || (totalBonus && /con financiamiento Forum/i.test(scoped) ? totalBonus : null);
    rows.push({
      ...base(source),
      product_name: `${product} · ${vehicle}`,
      brand,
      model: vehicle,
      vehicle_price: listPrice,
      financed_price: financedPrice,
      finance_bonus: financingBonus,
      down_payment_pct: piePct,
      down_payment_amount: pieAmount,
      term_months: installmentCount,
      installments_count: installmentCount,
      installment_amount: installment,
      balloon_amount: balloon,
      cae_pct: cae,
      loan_amount: loanAmount,
      credit_total_cost: ctc,
      vehicle_total_cost: vehicleTotal || (ctc && pieAmount ? ctc + pieAmount : null),
      valid_until: validUntil,
      confidence: "published",
      raw_payload: {
        parser: source.parser_key,
        provider: "Forum",
        totalPublishedBonus: totalBonus,
        financingBonusBasis: explicitFinanceBonus ? "explicit_financing_components" : financingBonus ? "published_total_bonus" : "not_isolated",
        validityText: validText || null,
        invalidValidityDate: Boolean(validText && !validUntil),
        headlinePiePct,
        actualPiePct,
        pieMismatch: headlinePiePct !== null && actualPiePct !== null && headlinePiePct !== actualPiePct,
        capture: "forum_legal_promotion",
      },
    });
  }
  return rows;
}

function forumFord(source: Source, text: string): Observation[] {
  const starts = [...text.matchAll(/Imagen corresponde a\s+(.+?)\.\s*Precio de Lista/gi)];
  const rows: Observation[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index ?? 0;
    const end = i + 1 < starts.length ? (starts[i + 1].index ?? text.length) : Math.min(text.length, start + 7000);
    const scoped = text.slice(start, end);
    const vehicle = starts[i][1]?.trim() || null;
    const listPrice = money(match(scoped, /Precio de Lista\s*\$?\s*([0-9.]+)/i));
    const financedPrice = money(match(scoped, /Precio final exclusivo con financiamiento Forum\s*\$?\s*([0-9.]+)/i));
    const product = match(scoped, /A modo de ejemplo producto con\s+([^:]+):?/i)?.trim() || "Financiamiento Forum";
    const installmentsCount = Number(match(scoped, /([0-9]{1,2})\s+cuotas? de\s*\$?\s*[0-9.]+/i) || 0) || null;
    const installment = money(match(scoped, /[0-9]{1,2}\s+cuotas? de\s*\$?\s*([0-9.]+)/i));
    const balloon = money(match(scoped, /(?:más\s+)?cuota n[°ºo]?\s*[0-9]+\s+de\s*\$\s*([0-9.]+)/i));
    const piePct = pct(match(scoped, /pie de\s*([0-9]+(?:[,.][0-9]+)?)%/i));
    const pieAmount = money(match(scoped, /pie de\s*[0-9]+(?:[,.][0-9]+)?%\s*\(\$\s*([0-9.]+)\)/i));
    const cae = pct(match(scoped, /CAE\s*([0-9]+(?:[,.][0-9]+)?)%/i));
    const ctc = money(match(scoped, /Costo Total del Crédito\s*\$?\s*([0-9.]+)/i));
    const loanAmount = money(match(scoped, /Monto Total del Crédito\s*\$?\s*([0-9.]+)/i));
    const vehicleTotal = money(match(scoped, /Costo Total del Vehículo\s*\$?\s*([0-9.]+)/i));
    const validText = match(scoped, /Vigencia promoción hasta\s+([^\.]+?)(?:\.|Stock|$)/i);
    const validUntil = forumDate(validText);
    if (!vehicle || (!cae && !ctc && !installment)) continue;
    rows.push({
      ...base(source),
      product_name: `${product} · ${vehicle}`,
      brand: "Ford",
      model: vehicle,
      vehicle_price: listPrice,
      financed_price: financedPrice,
      finance_bonus: listPrice && financedPrice ? Math.max(0, listPrice - financedPrice) : null,
      down_payment_pct: piePct,
      down_payment_amount: pieAmount,
      term_months: installmentsCount,
      installments_count: installmentsCount,
      installment_amount: installment,
      balloon_amount: balloon,
      cae_pct: cae,
      loan_amount: loanAmount,
      credit_total_cost: ctc,
      vehicle_total_cost: vehicleTotal || (ctc && pieAmount ? ctc + pieAmount : null),
      valid_until: validUntil,
      confidence: "published",
      raw_payload: {
        parser: source.parser_key,
        provider: "Forum",
        capture: "partner_brand_legal",
        validityText: validText || null,
      },
    });
  }
  return rows;
}

function mafToyota(source: Source, text: string): Observation[] {
  const blocks = text.split(/Precio publicado de\s*:/i).slice(1);
  const rows: Observation[] = [];
  for (const block of blocks.slice(0, 60)) {
    const scoped = block.slice(0, 3200);
    const vehiclePrice = money(match(scoped, /^\s*\$?\s*([0-9.]+)/i));
    const model = match(scoped, /modelo\s+([^,]+),\s*versi[oó]n/i)?.trim() || null;
    const version = match(scoped, /versi[oó]n\s+(.+?),\s*incluye IVA/i)?.trim() || null;
    const financeBonus = money(match(scoped, /bono de financiamiento(?:\s+de)?\s*:?\s*\$?\s*([0-9.]+)/i));
    const piePct = pct(match(scoped, /Ejemplo representativo\s+([0-9]+(?:[,.][0-9]+)?)%\s+de pie/i));
    const pieAmount = money(match(scoped, /de pie de\s*:?\s*\$?\s*([0-9.]+)/i));
    const installmentsCount = Number(match(scoped, /([0-9]{1,2})\s+cuotas? de\s*:?\s*\$?\s*[0-9.]+/i) || 0) || null;
    const installmentAmount = money(match(scoped, /[0-9]{1,2}\s+cuotas? de\s*:?\s*\$?\s*([0-9.]+)/i));
    const balloonAmount = money(match(scoped, /cuota final N[°ºo]?\s*[0-9]+\s+de\s*:?\s*\$?\s*([0-9.]+)/i));
    const monthlyRatePct = pct(match(scoped, /Tasa de Inter[eé]s referencial de\s*:?\s*([0-9]+(?:[,.][0-9]+)?)%\s+mensual/i));
    const creditTotalCost = money(match(scoped, /Costo Total del Cr[eé]dito\s*:?\s*\$?\s*([0-9.]+)/i));
    const caePct = pct(match(scoped, /CAE\s*:?\s*([0-9]+(?:[,.][0-9]+)?)%/i));
    if (!model || monthlyRatePct === null) continue;
    rows.push({
      ...base(source),
      product_name: `Plan Renueve · ${model}`,
      brand: "Toyota",
      model,
      vehicle_price: vehiclePrice,
      finance_bonus: financeBonus,
      down_payment_pct: piePct,
      down_payment_amount: pieAmount,
      term_months: installmentsCount,
      installments_count: installmentsCount,
      installment_amount: installmentAmount,
      balloon_amount: balloonAmount,
      monthly_rate_pct: monthlyRatePct,
      cae_pct: caePct,
      credit_total_cost: creditTotalCost,
      vehicle_total_cost: creditTotalCost && pieAmount ? creditTotalCost + pieAmount : null,
      confidence: "published",
      raw_payload: { parser: source.parser_key, version, termRange: "25-60", rateMayVaryAtContract: true },
    });
  }
  return rows;
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
    case "global_conditions":
      pie = pct(match(text, /Pie m[ií]nimo\s*([0-9]+(?:[,.][0-9]+)?)\s*%/i)) ?? 20;
      term = Number(match(text, /Plazo de\s*[0-9]+\s*a\s*([0-9]{2})\s*meses/i) || 48);
      note = "Crédito convencional público; tasa depende de evaluación.";
      break;
    case "bk_conditions":
      note = "Compra inteligente, cuotas lineales y flexibles; cotización individual según evaluación.";
      break;
    case "autofin_conditions":
      note = "Financiera automotriz activa; condiciones y tasa se obtienen por cotización/evaluación.";
      break;
    case "eurocapital_conditions":
      note = "Cobertura de financiamiento automotriz; condiciones específicas se cotizan con ejecutivo.";
      break;
    default:
      return [];
  }
  return [{ ...base(source), down_payment_pct: pie, term_months: term, confidence: "conditions_only", raw_payload: { note } }];
}
function parse(source: Source, text: string) {
  if (source.parser_key === "forum_promo") return forumPromo(source, text);
  if (source.parser_key === "forum_ford") return forumFord(source, text);
  if (source.parser_key === "maf_toyota") return mafToyota(source, text);
  if (source.parser_key === "santander_promo") return santander(source, text);
  if (source.parser_key === "scotia_card_auto") return scotia(source, text);
  if (source.parser_key === "bch_card_auto") return bancoChileAuto(source, text);
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
  async function processSource(source: Source) {
    try {
      const response = await fetch(source.source_url, { headers: { "user-agent": UA, accept: "text/html,*/*", "accept-language": "es-CL,es;q=0.9" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`source_${response.status}`);
      const text = cleanHtml(await response.text()).slice(0, 250000);
      const parsed = parse(source, text);
      const unique = new Map<string, Observation>();
      for (const row of parsed) {
        const key = [row.provider,row.product_name,row.brand,row.model,row.term_months,row.cae_pct,row.vehicle_price,row.valid_until].join("|");
        const existing = unique.get(key);
        if (!existing || (!existing.credit_total_cost && row.credit_total_cost)) unique.set(key,row);
      }
      const rows = [...unique.values()];
      await save(rows);
      await status(source, rows.length ? "ok" : "no_structured_offer", null);
      return { source: source.source_key, ok: true, observations: rows.length };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (["forum_conditions","tanner_conditions","amicar_conditions","gm_conditions","bci_card_auto","bancoestado_card","global_conditions","bk_conditions","autofin_conditions","eurocapital_conditions"].includes(source.parser_key)) {
        const fallback = conditions(source, "");
        await save(fallback);
        await status(source, "fallback_conditions", message.slice(0, 800));
        return { source: source.source_key, ok: true, fallback: true, observations: fallback.length };
      }
      await status(source, message === "source_403" ? "blocked_403" : "error", message.slice(0, 800));
      return { source: source.source_key, ok: false, error: message };
    }
  }
  for (let i = 0; i < list.length; i += 4) {
    const batch = list.slice(i, i + 4);
    results.push(...await Promise.all(batch.map(processSource)));
    if (i + 4 < list.length) await new Promise(resolve => setTimeout(resolve, 250));
  }
  return json({ ok: true, sources: list.length, results, completedAt: new Date().toISOString() });
});
