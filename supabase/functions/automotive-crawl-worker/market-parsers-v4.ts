import type { AutomotiveProduct, QueueItem } from "./parsers.ts";
import { discoverMarket as baseDiscoverMarket, parseMarketProducts as baseParseMarketProducts } from "./market-parsers-v3.ts";
import { parsePortilloFlightVersions } from "./portillo-flight.ts";

function clean(value: unknown, max = 260) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 160);
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, raw) => {
      const code = Number(raw);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function cellText(value: string) {
  return clean(decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")), 320);
}

function htmlLines(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|tr|td|th|h[1-6]|a|button|option|strong)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).split("\n").map((line) => clean(line, 500)).filter(Boolean);
}

function clp(value: string) {
  const normalized = value.replace(/[^0-9]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 1_000_000 ? parsed : 0;
}

function linePrice(value: string | undefined) {
  return value && /\$/.test(value) ? clp(value) : 0;
}

function nextPrice(rows: string[], start: number, distance = 3) {
  for (let index = start; index <= Math.min(rows.length - 1, start + distance); index++) {
    const found = linePrice(rows[index]);
    if (found) return found;
  }
  return 0;
}

function scenarioPrice(rows: string[], start: number, end: number, label: RegExp) {
  for (let index = start; index < Math.min(rows.length, end); index++) {
    if (!label.test(rows[index])) continue;
    return linePrice(rows[index]) || nextPrice(rows, index + 1, 3);
  }
  return 0;
}

function absoluteUrl(value: string, base: string) {
  try { return new URL(value, base).toString().split("#")[0]; } catch { return null; }
}

function hrefs(html: string, base: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = absoluteUrl(match[1], base);
    if (url) found.add(url);
  }
  return [...found];
}

function firstHeading(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
  return match?.[1] ? cellText(match[1]) : "";
}

function parseSubaruChile(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const products = new Map<string, AutomotiveProduct>();
  let currentModel = "";

  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cellText(match[1]));
    if (cells.length < 7) continue;

    const hasModelCell = cells.length >= 8;
    if (hasModelCell && cells[0]) currentModel = clean(cells[0], 180);
    if (!currentModel) continue;

    const offset = hasModelCell ? 1 : 0;
    const version = clean(cells[offset], 240);
    const listPrice = clp(cells[offset + 1] ?? "");
    const directBonus = clp(cells[offset + 2] ?? "");
    const cashPrice = clp(cells[offset + 3] ?? "") || Math.max(0, listPrice - directBonus);
    const financeBonus = clp(cells[offset + 4] ?? "");
    const finalPrice = clp(cells[offset + 5] ?? "") || Math.max(0, cashPrice - financeBonus);
    if (!version || !listPrice || !finalPrice) continue;

    const externalId = `${sourceKey}:${slug(`${currentModel}-${version}`)}`;
    products.set(externalId, {
      external_id: externalId,
      source_key: sourceKey,
      brand: "Subaru",
      model: currentModel,
      version,
      name: `Subaru ${currentModel} · ${version}`,
      body_type: "Vehículo",
      url,
      list_price: listPrice,
      cash_price: cashPrice || listPrice,
      final_price: finalPrice,
      metadata: {
        parser: sourceKey,
        dealer,
        source_type: "brand",
        capture_scope: "version_pricing",
        price_confidence: "official_structured_table",
        identity_source: "official_subaru_price_table",
        brand_bonus: directBonus,
        online_bonus: 0,
        dealer_bonus: 0,
        finance_bonus: financeBonus,
      },
    });
  }

  return [...products.values()];
}

function sinotrukDiscovery(html: string, base: string, stage: string): QueueItem[] {
  if (stage !== "root") return [];
  return hrefs(html, base)
    .filter((value) => {
      try {
        const parsed = new URL(value);
        return /(^|\.)sinotrukindumotora\.cl$/i.test(parsed.hostname) && /\/modelos\/[^/?#]+\.html$/i.test(parsed.pathname);
      } catch { return false; }
    })
    .slice(0, 80)
    .map((url) => ({ kind: "automotive_model_page" as const, stage: "model", url, task_key: `sinotruk-${slug(new URL(url).pathname)}` }));
}

function collectPrices(rows: string[], start: number, count: number) {
  const values: number[] = [];
  for (let index = start; index < rows.length && values.length < count; index++) {
    const value = linePrice(rows[index]);
    if (value) values.push(value);
  }
  return values;
}

function parseSinotrukIndumotora(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  const rows = htmlLines(html);
  const countLine = rows.findIndex((row) => /Tenemos\s+\d+\s+versiones disponibles/i.test(row));
  if (countLine < 0) return [];
  const count = Number(rows[countLine].match(/Tenemos\s+(\d+)\s+versiones disponibles/i)?.[1] ?? 0);
  if (!Number.isFinite(count) || count <= 0 || count > 30) return [];

  const listLabel = rows.findIndex((row, index) => index > countLine && /^Precio lista \(con IVA\)$/i.test(row));
  if (listLabel < 0) return [];
  const versions = rows.slice(countLine + 1, listLabel)
    .filter((row) => !/^(Comparar|Elige una categor[ií]a|Anterior|Siguiente|Versi[oó]n)$/i.test(row) && !linePrice(row))
    .slice(-count)
    .map((row) => clean(row, 220));
  if (versions.length !== count) return [];

  const brandBonusLabel = rows.findIndex((row, index) => index > listLabel && /^Bono marca$/i.test(row));
  const forumBonusLabel = rows.findIndex((row, index) => index > brandBonusLabel && /^Bono Forum$/i.test(row));
  const finalVatLabel = rows.findIndex((row, index) => index > forumBonusLabel && /^Precio final \(con IVA\)$/i.test(row));
  if (brandBonusLabel < 0 || forumBonusLabel < 0 || finalVatLabel < 0) return [];

  const listPrices = collectPrices(rows, listLabel + 1, count);
  const brandBonuses = collectPrices(rows, brandBonusLabel + 1, count);
  const financeBonuses = collectPrices(rows, forumBonusLabel + 1, count);
  const finalPrices = collectPrices(rows, finalVatLabel + 1, count);
  if ([listPrices, brandBonuses, financeBonuses, finalPrices].some((values) => values.length !== count)) return [];

  const heading = firstHeading(html);
  const pathModel = new URL(url).pathname.split("/").filter(Boolean).at(-1)?.replace(/\.html$/i, "").replace(/[-_]+/g, " ") ?? "Sinotruk";
  const model = clean(heading.replace(/^Sinotruk\s+/i, "").replace(/^Elige tu\s+Sinotruk\s+/i, ""), 180) || pathModel.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const products: AutomotiveProduct[] = [];

  for (let index = 0; index < count; index++) {
    const listPrice = listPrices[index];
    const brandBonus = brandBonuses[index];
    const financeBonus = financeBonuses[index];
    const finalPrice = finalPrices[index];
    const cashPrice = Math.max(finalPrice, listPrice - brandBonus);
    const version = versions[index];
    if (!version || !listPrice || !finalPrice) continue;
    products.push({
      external_id: `${sourceKey}:${slug(`${model}-${version}`)}`,
      source_key: sourceKey,
      brand: "Sinotruk",
      model,
      version,
      name: `Sinotruk ${model} · ${version}`,
      body_type: "Vehículo",
      url,
      list_price: listPrice,
      cash_price: cashPrice,
      final_price: finalPrice,
      metadata: {
        parser: sourceKey,
        dealer,
        source_type: "brand",
        capture_scope: "version_pricing",
        price_confidence: "official_indumotora_version_table",
        identity_source: "official_sinotruk_version_table",
        brand_bonus: brandBonus,
        online_bonus: 0,
        dealer_bonus: 0,
        finance_bonus: financeBonus,
      },
    });
  }
  return products;
}

function salazarBrand(raw: string) {
  const key = slug(raw);
  const aliases: Record<string, string> = { dfsk: "DFSK", mg: "MG", kgm: "KGM", jmc: "JMC", ram: "RAM", gac: "GAC", citroen: "Citroën" };
  return aliases[key] ?? raw.replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
}

function isSalazarDetail(url: string) {
  try { return /^\/marcas\/[^/]+\/nuevo\/[^/?#]+\/?$/i.test(new URL(url).pathname); } catch { return false; }
}

function parseSalazarVersions(html: string, url: string, sourceKey: string, dealer: string): AutomotiveProduct[] {
  if (!isSalazarDetail(url)) return [];
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const brand = salazarBrand(path[1] ?? "");
  const heading = firstHeading(html);
  const model = clean(
    heading
      .replace(/^Nuevo\s+/i, "")
      .replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), "")
      .replace(/\s+Salazar Israel.*$/i, ""),
    180,
  ) || (path[3] ?? "").replace(/^[^-]+-/, "").replace(/[-_]+/g, " ");
  const rows = htmlLines(html);
  const sectionStart = rows.findIndex((row) => /^Versiones disponibles$/i.test(row));
  if (sectionStart < 0) return [];

  const products = new Map<string, AutomotiveProduct>();
  const desdeIndexes: number[] = [];
  for (let index = sectionStart + 1; index < rows.length; index++) {
    if (/^Desde$/i.test(rows[index])) desdeIndexes.push(index);
  }

  for (let position = 0; position < desdeIndexes.length; position++) {
    const priceIndex = desdeIndexes[position];
    let version = "";
    for (let cursor = priceIndex - 1; cursor >= Math.max(sectionStart + 1, priceIndex - 7); cursor--) {
      const candidate = clean(rows[cursor], 240);
      if (!candidate || linePrice(candidate)) continue;
      if (/^(Versiones disponibles|Cotiza la versi[oó]n|que se acomode|AUTO NUEVO|SUV|SEDAN|CAMIONETA|COMERCIAL|HATCHBACK|VER VERSI[OÓ]N|COTIZAR|RESERVAR|Precios)$/i.test(candidate)) continue;
      if (/^(Automatica|Mecanica|Awd|4x2|4x4|Diesel|Gasolina|Hibrido|El[eé]ctrico|[0-9]+ Puertas)$/i.test(candidate)) continue;
      version = candidate;
      break;
    }
    if (!version) continue;

    const advertisedPrice = nextPrice(rows, priceIndex + 1, 4);
    if (!advertisedPrice) continue;
    const blockEnd = position + 1 < desdeIndexes.length ? desdeIndexes[position + 1] : Math.min(rows.length, priceIndex + 38);
    const smartCredit = scenarioPrice(rows, priceIndex + 1, blockEnd, /^Con Cr[eé]dito Inteligente$/i);
    const conventionalCredit = scenarioPrice(rows, priceIndex + 1, blockEnd, /^Con Cr[eé]dito Convencional$/i);
    const allPayment = scenarioPrice(rows, priceIndex + 1, blockEnd, /^Con todo medio de pago$/i);
    const financeCandidates = [advertisedPrice, smartCredit, conventionalCredit].filter((value) => value > 0);
    const finalPrice = financeCandidates.length ? Math.min(...financeCandidates) : advertisedPrice;
    const cashPrice = allPayment || advertisedPrice;
    const financeBonus = Math.max(0, cashPrice - finalPrice);
    const externalId = `${sourceKey}:${slug(`${brand}-${model}-${version}`)}`;

    products.set(externalId, {
      external_id: externalId,
      source_key: sourceKey,
      brand,
      model,
      version,
      name: `${brand} ${model} · ${version}`,
      body_type: "Vehículo",
      url,
      list_price: cashPrice,
      cash_price: cashPrice,
      final_price: finalPrice,
      metadata: {
        parser: sourceKey,
        dealer,
        source_type: "dealer",
        capture_scope: "version_pricing",
        price_confidence: "explicit_salazar_version",
        identity_source: "salazar_versions_section",
        brand_bonus: 0,
        online_bonus: 0,
        dealer_bonus: 0,
        finance_bonus: financeBonus,
        smart_credit_price: smartCredit || null,
        conventional_credit_price: conventionalCredit || null,
        other_payment_price: allPayment || null,
      },
    });
  }

  return [...products.values()];
}

function isSalazarBrandCatalog(url: string) {
  try {
    return /^\/marcas\/[^/]+\/nuevo\/?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function discoverMarket(parser: string, html: string, url: string, stage: string): QueueItem[] | null {
  if (parser === "subaru_chile") return [];
  if (parser === "indumotora_sinotruk") return sinotrukDiscovery(html, url, stage);
  return baseDiscoverMarket(parser, html, url, stage);
}

export function parseMarketProducts(
  parser: string,
  html: string,
  url: string,
  sourceKey: string,
  dealer: string,
): AutomotiveProduct[] | null {
  if (parser === "subaru_chile") return parseSubaruChile(html, url, sourceKey, dealer);
  if (parser === "indumotora_sinotruk") return parseSinotrukIndumotora(html, url, sourceKey, dealer);

  if (parser === "salazar_israel") {
    if (isSalazarBrandCatalog(url)) return [];
    const versions = parseSalazarVersions(html, url, sourceKey, dealer);
    if (versions.length) return versions;
  }

  const legacy = baseParseMarketProducts(parser, html, url, sourceKey, dealer);
  if (parser !== "portillo") return legacy;

  const structured = parsePortilloFlightVersions(html, url, sourceKey, dealer, legacy ?? []);
  return structured.length ? structured : legacy;
}
