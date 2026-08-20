import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";

type Role = "brand" | "competitor";
type Spec = { key: string; name: string; aliases: string[]; category: string; marketCategory: string; units?: number; benchmark?: string; promoMechanic?: string };
type Source = { domain: string; retailer: string; url: string; brand: string; role: Role; specs: Spec[] };
type Parsed = Spec & { brand: string; role: Role; url: string; currentPrice: number; regularPrice: number | null; discountPct: number | null; promotion: boolean };

const KRISPY: Spec[] = [
  { key: "kk-og-3", name: "3 pack Original Glazed", aliases: ["3 pack Original Glazed"], category: "Original Glazed", marketCategory: "Packs · 3 unidades", units: 3 },
  { key: "kk-og-6", name: "6 Pack Original Glazed", aliases: ["6 Pack Original Glazed"], category: "Original Glazed", marketCategory: "Packs · 6 unidades", units: 6, benchmark: "pack-6" },
  { key: "kk-og-12", name: "Docena Original Glazed", aliases: ["Docena Original Glazed"], category: "Original Glazed", marketCategory: "Packs · 12 unidades", units: 12, benchmark: "pack-12" },
  { key: "kk-og-24", name: "Doble Docena Original Glazed", aliases: ["Doble Docena Original Glazed"], category: "Original Glazed", marketCategory: "Packs · 24 unidades", units: 24, benchmark: "pack-24" },
  { key: "kk-choice-3", name: "3 Pack a Eleccion", aliases: ["3 Pack a Eleccion", "3 Pack a Elección"], category: "Pack a Elección", marketCategory: "Packs · 3 unidades", units: 3 },
  { key: "kk-choice-6", name: "6 Pack a Eleccion", aliases: ["6 Pack a Eleccion", "6 Pack a Elección"], category: "Pack a Elección", marketCategory: "Packs · 6 unidades", units: 6 },
  { key: "kk-basic-12", name: "Escoge tu Docena Basic", aliases: ["Escoge tu Docena Basic"], category: "Pack a Elección", marketCategory: "Packs · 12 unidades", units: 12 },
  { key: "kk-select-12", name: "Escoge tu Docena Select", aliases: ["Escoge tu Docena Select"], category: "Pack a Elección", marketCategory: "Packs · 12 unidades", units: 12 },
  { key: "kk-premium-12", name: "Escoge tu Docena Premium", aliases: ["Escoge tu Docena Premium"], category: "Pack a Elección", marketCategory: "Packs · 12 unidades", units: 12 },
  { key: "kk-limited-dozen", name: "Biscoff Lovers Dozen", aliases: ["Biscoff Lovers Dozen"], category: "Edición limitada", marketCategory: "Edición limitada", units: 12 },
  { key: "kk-latte-2", name: "Latte + 2 Doughnuts", aliases: ["Latte + 2 Doughnuts"], category: "Combos", marketCategory: "Combos", promoMechanic: "Combo" },
  { key: "kk-frappe-2", name: "Frappe L + 2 Doughnuts", aliases: ["Frappe L + 2 Doughnuts"], category: "Combos", marketCategory: "Combos", promoMechanic: "Combo" },
  { key: "kk-americano-m", name: "Americano M", aliases: ["Americano M"], category: "Café caliente", marketCategory: "Café caliente", benchmark: "americano-m" },
  { key: "kk-latte-m", name: "Latte M", aliases: ["Latte M"], category: "Café caliente", marketCategory: "Café caliente", benchmark: "latte-m" },
  { key: "kk-cappuccino-m", name: "Capuccino M", aliases: ["Capuccino M", "Cappuccino M"], category: "Café caliente", marketCategory: "Café caliente", benchmark: "cappuccino-m" },
  { key: "kk-mocha-m", name: "Mocha M", aliases: ["Mocha M"], category: "Café caliente", marketCategory: "Café caliente" },
  { key: "kk-caramel-frappe-m", name: "Caramel Frappe M", aliases: ["Caramel Frappe M"], category: "Café frío", marketCategory: "Café frío" },
  { key: "kk-coffee-frappe-m", name: "Coffee Frappe M", aliases: ["Coffee Frappe M"], category: "Café frío", marketCategory: "Café frío" },
  { key: "kk-mocha-frappe-m", name: "Mocha Frappe M", aliases: ["Mocha Frappe M"], category: "Café frío", marketCategory: "Café frío" },
];

const DUNKIN: Spec[] = [
  { key: "dunkin-unit", name: "Donut (Unidad)", aliases: ["Donut (Unidad)"], category: "Donuts", marketCategory: "Donut individual", units: 1 },
  { key: "dunkin-6", name: "6 Donuts Classic (Paga 5)", aliases: ["6 Donuts Classic (Paga 5)"], category: "Packs", marketCategory: "Packs · 6 unidades", units: 6, benchmark: "pack-6", promoMechanic: "Paga 5" },
  { key: "dunkin-12", name: "12 Donuts Classic (paga 9)", aliases: ["12 Donuts Classic (paga 9)", "12 Donuts Classic (Paga 9)"], category: "Packs", marketCategory: "Packs · 12 unidades", units: 12, benchmark: "pack-12", promoMechanic: "Paga 9" },
  { key: "dunkin-24-best", name: "24 Donuts Classic Eleccion", aliases: ["24 Donuts Classic Eleccion", "24 Donuts Classic Elección"], category: "Packs", marketCategory: "Packs · 24 unidades", units: 24, promoMechanic: "Paga 12" },
  { key: "dunkin-24-p16", name: "24 Donuts Classic (Paga 16)", aliases: ["24 Donuts Classic (Paga 16)"], category: "Packs", marketCategory: "Packs · 24 unidades", units: 24, benchmark: "pack-24", promoMechanic: "Paga 16" },
  { key: "dunkin-6-beverage", name: "6 Donuts Classic + Bebida 1.5 Lt", aliases: ["6 Donuts Classic + Bebida 1.5 Lt"], category: "Combos", marketCategory: "Combos", promoMechanic: "Combo" },
  { key: "dunkin-12-beverage", name: "12 Donuts Classic + Bebida 1.5 Lt", aliases: ["12 Donuts Classic + Bebida 1.5 Lt"], category: "Combos", marketCategory: "Combos", promoMechanic: "Combo" },
  { key: "dunkin-24-beverage", name: "24 Donuts Classic + Bebida 1.5 Lt", aliases: ["24 Donuts Classic + Bebida 1.5 Lt"], category: "Combos", marketCategory: "Combos", promoMechanic: "Combo" },
  { key: "dunkin-2-beverage", name: "2 Donuts + Bebida M", aliases: ["2 Donuts + Bebida M"], category: "Combos", marketCategory: "Combos", promoMechanic: "Combo" },
  { key: "dunkin-americano-m", name: "Americano M", aliases: ["Americano M"], category: "Café caliente", marketCategory: "Café caliente", benchmark: "americano-m" },
  { key: "dunkin-latte-m", name: "Latte M", aliases: ["Latte M"], category: "Café caliente", marketCategory: "Café caliente", benchmark: "latte-m" },
  { key: "dunkin-cappuccino-m", name: "Cappuccino M", aliases: ["Cappuccino M"], category: "Café caliente", marketCategory: "Café caliente", benchmark: "cappuccino-m" },
  { key: "dunkin-iced-americano-m", name: "Iced Americano M", aliases: ["Iced Americano M"], category: "Café frío", marketCategory: "Café frío" },
  { key: "dunkin-iced-latte-m", name: "Iced Latte M", aliases: ["Iced Latte M"], category: "Café frío", marketCategory: "Café frío" },
  { key: "dunkin-frozen-latte-m", name: "Frozen Latte M", aliases: ["Frozen Latte M"], category: "Café frío", marketCategory: "Café frío" },
];

const SOURCES: Source[] = [
  { domain: "krispy-kreme.reorder.io", retailer: "Krispy Kreme Chile · Pedido oficial", url: "https://krispy-kreme.reorder.io/", brand: "Krispy Kreme", role: "brand", specs: KRISPY },
  { domain: "pide.dunkin.cl", retailer: "Dunkin Chile · Pedido oficial", url: "https://pide.dunkin.cl/pedir", brand: "Dunkin", role: "competitor", specs: DUNKIN },
];

function escapeRx(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function clp(raw: string) { const value = Number(raw.replace(/[^0-9]/g, "")); return Number.isFinite(value) && value >= 500 && value <= 300000 ? value : null; }
function exactCardPrice(raw: string, aliases: string[]) {
  for (const alias of aliases) {
    const name = escapeRx(alias);
    const patterns = [
      new RegExp(`<h3[^>]*>\\s*(?:<!--\\s*-->)?\\s*${name}\\s*</h3>[\\s\\S]{0,1400}?\\$\\s*([0-9]{1,3}(?:[.\\s][0-9]{3})+|[0-9]{3,6})`, "i"),
      new RegExp(`alt=["']${name}["'][\\s\\S]{0,2200}?<h3[^>]*>\\s*(?:<!--\\s*-->)?\\s*${name}\\s*</h3>[\\s\\S]{0,1200}?\\$\\s*([0-9]{1,3}(?:[.\\s][0-9]{3})+|[0-9]{3,6})`, "i"),
    ];
    for (const regex of patterns) {
      const match = raw.match(regex);
      if (match) { const price = clp(match[1]); if (price) return price; }
    }
  }
  return null;
}
function parseSource(raw: string, source: Source): Parsed[] {
  const rows: Parsed[] = [];
  for (const spec of source.specs) {
    const currentPrice = exactCardPrice(raw, spec.aliases);
    if (!currentPrice) continue;
    rows.push({ ...spec, brand: source.brand, role: source.role, url: source.url, currentPrice, regularPrice: null, discountPct: null, promotion: Boolean(spec.promoMechanic) });
  }
  return rows;
}
async function fetchRaw(url: string) {
  const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "es-CL,es;q=0.9", "cache-control": "no-cache" }, redirect: "follow", signal: AbortSignal.timeout(22000) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (raw.length < 800) throw new Error(`short_html:${raw.length}`);
  return raw;
}
async function ensureSource(brandId: string, source: Source) {
  const { data: existing } = await supabase.from("brands_vertical_sources").select("id").eq("brand_id", brandId).eq("domain", source.domain).maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from("brands_vertical_sources").update({ retailer_name: source.retailer, source_type: "official", priority: 120, active: true }).eq("id", existing.id);
    if (error) throw error;
    return existing.id as string;
  }
  const { data, error } = await supabase.from("brands_vertical_sources").insert({ brand_id: brandId, retailer_name: source.retailer, domain: source.domain, source_type: "official", priority: 120, active: true }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function ensureProduct(brandId: string, item: Parsed) {
  const canonical = `${item.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${item.key}`;
  const { data, error } = await supabase.from("brands_vertical_products").upsert({ brand_id: brandId, external_sku: canonical, name: item.name, category: item.category, product_url: item.url, canonical_key: canonical, active: true, last_seen_at: new Date().toISOString(), attributes: { actualBrand: item.brand, role: item.role, units: item.units ?? null, benchmark: item.benchmark ?? null, marketCategory: item.marketCategory, sourcePolicy: "official-only" } }, { onConflict: "brand_id,canonical_key" }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
async function persist(brandId: string, sourceId: string, item: Parsed) {
  const productId = await ensureProduct(brandId, item);
  const unitPrice = item.units ? Math.round(item.currentPrice / item.units) : null;
  const canonical = `${item.brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${item.key}`;
  const { error } = await supabase.from("brands_vertical_listings").insert({ brand_id: brandId, source_id: sourceId, product_id: productId, source_product_key: canonical, title: item.name, brand_name: item.brand, seller_name: item.brand, category: item.category, product_url: item.url, regular_price: null, current_price: item.currentPrice, currency: "CLP", in_stock: true, attributes: { actualBrand: item.brand, role: item.role, units: item.units ?? null, unitPrice, benchmark: item.benchmark ?? null, marketCategory: item.marketCategory, promotion: item.promotion, promoMechanic: item.promoMechanic ?? null, discountPct: null, pricingSource: "official", sourcePolicy: "official-only", verification: "official_product_card" }, raw: { collector: "krispy-official-pricing-worker-v3", sourceUrl: item.url }, observed_at: new Date().toISOString() });
  if (error) throw error;
}
async function collect() {
  const { data: brand, error: brandError } = await supabase.from("brands_vertical_brands").select("id").eq("slug", "krispy-kreme").single();
  if (brandError || !brand) throw new Error("brand_not_found:krispy-kreme");
  const { data: run } = await supabase.from("brands_vertical_discovery_runs").insert({ brand_id: brand.id, status: "running", started_at: new Date().toISOString(), sources_attempted: SOURCES.length, notes: JSON.stringify({ policy: "official-only", collector: "v3" }) }).select("id").single();
  let succeeded = 0; let listings = 0;
  const products = new Set<string>(); const details: Record<string, unknown>[] = [];
  for (const source of SOURCES) {
    const sourceId = await ensureSource(brand.id, source);
    try {
      const items = parseSource(await fetchRaw(source.url), source);
      if (!items.length) throw new Error("no_prices_parsed");
      for (const item of items) { await persist(brand.id, sourceId, item); listings++; products.add(`${item.brand}:${item.key}`); }
      succeeded++;
      await supabase.from("brands_vertical_sources").update({ last_crawled_at: new Date().toISOString(), last_status: `ok:${items.length}`, last_error: null }).eq("id", sourceId);
      details.push({ domain: source.domain, brand: source.brand, status: "ok", found: items.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("brands_vertical_sources").update({ last_crawled_at: new Date().toISOString(), last_status: "degraded:last-valid-retained", last_error: message.slice(0, 600) }).eq("id", sourceId);
      details.push({ domain: source.domain, brand: source.brand, status: "error", error: message });
    }
  }
  await supabase.from("brands_vertical_sources").update({ active: false }).eq("brand_id", brand.id).in("domain", ["rappi.cl", "ubereats.com", "krispykreme.cl"]);
  const status = succeeded === SOURCES.length ? "completed" : succeeded > 0 ? "partial" : "failed";
  if (run?.id) await supabase.from("brands_vertical_discovery_runs").update({ status, sources_succeeded: succeeded, listings_found: listings, products_found: products.size, finished_at: new Date().toISOString(), notes: JSON.stringify({ policy: "official-only", collector: "v3", details }) }).eq("id", run.id);
  return { slug: "krispy-kreme", status, sourcesAttempted: SOURCES.length, sourcesSucceeded: succeeded, listingsFound: listings, productsFound: products.size, details };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const token = req.headers.get("x-qsr-worker-token");
  const { data: config } = await supabase.from("qsr_worker_config").select("token").eq("id", 1).single();
  if (!token || !config?.token || token !== config.token) return Response.json({ error: "unauthorized" }, { status: 401 });
  try { return Response.json({ ok: true, observedAt: new Date().toISOString(), result: await collect() }); }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
});
