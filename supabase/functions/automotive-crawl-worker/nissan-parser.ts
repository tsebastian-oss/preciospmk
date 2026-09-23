import type { AutomotiveProduct, QueueItem } from "./parsers.ts";

const ROOT = "https://guillermomorales.cl/autos-nuevos/nissan";
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const money = (s: string): number | null => {
  const match = text(s).match(/\$\s*([\d.]+)/);
  return match ? Number(match[1].replace(/\./g, "")) : null;
};

export function discoverNissanGuillermoMorales(html: string, url: string, stage: string): QueueItem[] {
  if (stage === "model") return [];
  const found = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const target = new URL(m[1], url);
      if (/^(www\.)?guillermomorales\.cl$/i.test(target.hostname) && /^\/autos-nuevos\/nissan\/[^/]+\/?$/.test(target.pathname)) {
        found.add(`${target.origin}${target.pathname.replace(/\/$/, "")}`);
      }
    } catch { /* Ignore malformed navigation links. */ }
  }
  return [...found].map((target) => ({ kind: "automotive_model_page", stage: "model", url: target, task_key: `nissan-gm-${slug(new URL(target).pathname)}` }));
}

/** Parse the version price table, never the duplicated model-level "desde" cards. */
export function parseNissanGuillermoMorales(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const path = new URL(url).pathname;
  if (!/^\/autos-nuevos\/nissan\/[^/]+\/?$/.test(path)) return [];
  const modelSlug = path.split("/").filter(Boolean).at(-1)!;
  const model = ({ "xtrail-epower": "XTRAIL e-POWER", xtrail: "XTRAIL", versa: "VERSA", kicks: "KICKS", kait: "KAIT", pathfinder: "PATHFINDER" } as Record<string, string>)[modelSlug] ?? modelSlug.replace(/-/g, " ").toUpperCase();
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]).find((body) => /data-tipo=["']precio["']/i.test(body));
  if (!table) return [];
  const versions = [...table.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)].map((m) => {
    const options = [...m[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    const selected = options.find((o) => /\bselected\b/i.test(o[1])) ?? options[0];
    return selected ? { name: text(selected[2]), id: selected[1].match(/value=["']([^"']+)["']/i)?.[1] ?? "" } : null;
  });
  const rows = new Map<string, (number | null)[]>();
  for (const m of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length) rows.set(slug(text(cells[0])), cells.slice(1).map(money));
  }
  const result: AutomotiveProduct[] = [];
  versions.forEach((version, i) => {
    const list = rows.get("precio-lista")?.[i];
    const final = rows.get("precio-desde")?.[i];
    const finance = rows.get("bono-financiamiento")?.[i] ?? 0;
    const direct = rows.get("bono-todo-medio-pago")?.[i] ?? 0;
    const dealerBonus = rows.get("bonogm")?.[i] ?? rows.get("bono-gm")?.[i] ?? 0;
    if (!version?.name || !list || !final || list < 1_000_000 || final < 1_000_000 || final > list) return;
    // An unspecified dealer bonus must not silently become an unconditional cash discount.
    const cash = dealerBonus > 0 ? null : list - direct;
    result.push({
      external_id: `${sourceKey}:nissan-${slug(model)}-${slug(version.name)}`,
      source_key: sourceKey, brand: "Nissan", model, version: version.name,
      name: `Nissan ${model} · ${version.name}`, body_type: modelSlug === "versa" ? "Sedán" : "SUV", url,
      list_price: list, cash_price: cash, final_price: final,
      metadata: {
        parser: "nissan_guillermo_morales", dealer, source_type: "dealer", capture_scope: "version_pricing",
        price_confidence: "explicit_guillermo_morales_version_table", identity_source: "selected_version_option",
        source_version_id: version.id, brand_bonus: direct, finance_bonus: finance, dealer_bonus: dealerBonus, online_bonus: 0,
        final_price_condition: finance > 0 ? "financing_required" : "all_payment_methods",
        cash_price_method: cash === null ? "unverified_dealer_bonus_conditions" : "list_minus_explicit_all_payment_bonus",
        advertised_price_reconciled: Math.abs(list - direct - finance - dealerBonus - final) <= 1,
        catalog_url: ROOT,
      },
    });
  });
  return result;
}
