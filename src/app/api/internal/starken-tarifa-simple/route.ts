import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;
export const preferredRegion = "gru1";

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const STARKEN_URL = "https://www.starken.cl/tarifa-simple";
const PARTNER_URL = "https://www.starken.cl/somos-partner";
const SIZES = ["XS", "S", "M", "L"] as const;
type Size = typeof SIZES[number];
type DeliveryType = "AGENCIA" | "DOMICILIO";
type BaseRate = { zone: string; size: Size; deliveryType: DeliveryType; priceClp: number };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(request: NextRequest) {
  const supplied = request.headers.get("x-chilexpress-worker-token") || "";
  if (!supplied) return false;
  const actual = await sha256(supplied);
  if (actual.length !== TOKEN_SHA256.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual.charCodeAt(i) ^ TOKEN_SHA256.charCodeAt(i);
  return diff === 0;
}

function browserEndpoint(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.username && !/-country-[a-z]{2}(?:-|$)/i.test(url.username)) {
      url.username = url.username + "-country-cl";
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeZone(value: string) {
  const n = normalize(value);
  if (n.includes("misma ciudad")) return "Misma ciudad";
  if (n.includes("extremo norte")) return "Extremo Norte";
  if (n.includes("centro") && n.includes("sur")) return "Centro / Sur";
  if (n.includes("extremo austral")) return "Extremo Austral";
  return "";
}

function money(value: string) {
  const raw = String(value || "").replace(/\s/g, "");
  const explicit = raw.match(/\$\s*([0-9][0-9.]*)/);
  if (!explicit) return null;
  const amount = Number(explicit[1].replace(/\./g, ""));
  return Number.isFinite(amount) && amount >= 500 && amount <= 500_000 ? amount : null;
}

function moneyTokens(value: string) {
  return [...String(value || "").matchAll(/\$\s*[0-9][0-9.]{2,12}/g)]
    .map((match) => money(match[0]))
    .filter((value): value is number => value !== null);
}

function parseVisibleText(text: string, deliveryType: DeliveryType) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rates: BaseRate[] = [];
  const zones = ["Misma ciudad", "Extremo Norte", "Centro / Sur", "Extremo Austral"];
  for (let i = 0; i < lines.length; i += 1) {
    const zone = normalizeZone(lines[i]);
    if (!zone || !zones.includes(zone)) continue;
    const chunk: string[] = [lines[i]];
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
      if (normalizeZone(lines[j])) break;
      chunk.push(lines[j]);
    }
    const prices = moneyTokens(chunk.join(" "));
    if (prices.length < 4) continue;
    SIZES.forEach((size, index) => {
      const priceClp = prices[index];
      if (priceClp) rates.push({ zone, size, deliveryType, priceClp });
    });
  }
  return rates;
}

function dedupe(rates: BaseRate[]) {
  const out = new Map<string, BaseRate>();
  for (const rate of rates) {
    if (!rate.zone || !rate.priceClp) continue;
    const key = [rate.deliveryType, rate.zone, rate.size].join("|");
    if (!out.has(key)) out.set(key, rate);
  }
  return [...out.values()];
}

function parsePartnerTiers(text: string) {
  const normalized = String(text || "").replace(/\r/g, " ").replace(/\s+/g, " ");
  const defs = [
    { name: "Colina", fallbackMin: 3, fallbackPct: 10 },
    { name: "Montaña", fallbackMin: 50, fallbackPct: 15 },
    { name: "Cordillera", fallbackMin: 150, fallbackPct: 20 },
  ];
  return defs.map((tier) => {
    const escaped = tier.name.replace(/[.*+?^$()|[\]{}]/g, "\\function dedupe(rates: BaseRate[]) {
  const out = new Map<string, BaseRate>();
  for (const rate of rates) {
    if (!rate.zone || !rate.priceClp) continue;
    const key = [rate.deliveryType, rate.zone, rate.size].join("|");
    if (!out.has(key)) out.set(key, rate);
  }
  return [...out.values()];
}
");
    const re = new RegExp(escaped + "[\\s\\S]{0,180}?\\+?([0-9]{1,4})\\s*Envíos? mensuales[\\s\\S]{0,120}?([0-9]{1,2})%\\s*de descuentos?", "i");
    const match = normalized.match(re);
    return {
      name: tier.name,
      minMonthlyShipments: match ? Number(match[1]) : tier.fallbackMin,
      discountPct: match ? Number(match[2]) : tier.fallbackPct,
      verifiedInPage: Boolean(match),
    };
  });
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const connectorEndpoint = typeof body?.connectorEndpoint === "string" ? body.connectorEndpoint.trim() : "";
  if (!connectorEndpoint) return NextResponse.json({ error: "browser_connector_missing" }, { status: 503 });

  const { chromium } = await import("playwright-core");
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;

  try {
    browser = await chromium.connectOverCDP(browserEndpoint(connectorEndpoint), { timeout: 25_000 });
    const context = browser.contexts()[0] || await browser.newContext({
      locale: "es-CL",
      timezoneId: "America/Santiago",
    });
    const page = context.pages()[0] || await context.newPage();

    await page.goto(STARKEN_URL, { waitUntil: "commit", timeout: 20_000 }).catch(async (error) => {
      if (!page.url().includes("starken.cl")) throw error;
    });

    await page.getByText(/Para Pymes y Emprendedores/i).first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForFunction(() => /\$\s*[0-9]/.test(document.body?.innerText || ""), undefined, { timeout: 25_000 }).catch(() => undefined);
    await page.waitForTimeout(500);

    const rates: BaseRate[] = [];
    const tables = page.locator("table:visible");
    const tableCount = await tables.count();

    for (let i = 0; i < tableCount; i += 1) {
      const table = tables.nth(i);
      const contextText = await table.evaluate((element) => {
        let node: HTMLElement | null = element as HTMLElement;
        for (let j = 0; j < 4 && node?.parentElement; j += 1) node = node.parentElement;
        return String(node?.innerText || (element as HTMLElement).innerText || "");
      }).catch(() => "");
      const normalizedContext = normalize(contextText);
      const deliveryType: DeliveryType | null = normalizedContext.includes("domicilio")
        ? "DOMICILIO"
        : normalizedContext.includes("sucursal")
          ? "AGENCIA"
          : null;
      if (!deliveryType) continue;

      const rows = table.locator("tr");
      const rowCount = await rows.count();
      for (let r = 0; r < rowCount; r += 1) {
        const cells = await rows.nth(r).locator("th,td").allInnerTexts().catch(() => []);
        if (cells.length < 5) continue;
        const zone = normalizeZone(cells[0]);
        if (!zone) continue;
        for (let s = 0; s < 4; s += 1) {
          const priceClp = money(cells[s + 1] || "");
          if (priceClp) rates.push({ zone, size: SIZES[s], deliveryType, priceClp });
        }
      }
    }

    if (rates.length < 16) {
      const bodyText = await page.locator("body").innerText();
      const lower = normalize(bodyText);
      const sucursalStart = lower.indexOf("tarifas retiro en sucursal");
      const domicilioStart = lower.indexOf("tarifas retiro en domicilio");
      const dimensionesStart = lower.indexOf("dimensiones y peso");

      if (sucursalStart >= 0 && domicilioStart > sucursalStart) {
        rates.push(...parseVisibleText(bodyText.slice(sucursalStart, domicilioStart), "AGENCIA"));
      }
      if (domicilioStart >= 0) {
        rates.push(...parseVisibleText(bodyText.slice(domicilioStart, dimensionesStart > domicilioStart ? dimensionesStart : undefined), "DOMICILIO"));
      }
    }

    const unique = dedupe(rates);
    const diagnostics = {
      tableCount,
      parsedRates: unique.length,
      deliveryTypes: [...new Set(unique.map((rate) => rate.deliveryType))],
      zones: [...new Set(unique.map((rate) => rate.zone))],
      sizes: [...new Set(unique.map((rate) => rate.size))],
      url: page.url(),
    };

    if (!unique.length) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      return NextResponse.json({
        ok: false,
        error: "starken_tarifa_simple_no_prices",
        diagnostics,
        bodyPreview: bodyText.replace(/\s+/g, " ").slice(0, 1200),
      }, { status: 502 });
    }

    let partnerTiers = [
      { name: "Colina", minMonthlyShipments: 3, discountPct: 10, verifiedInPage: false },
      { name: "Montaña", minMonthlyShipments: 50, discountPct: 15, verifiedInPage: false },
      { name: "Cordillera", minMonthlyShipments: 150, discountPct: 20, verifiedInPage: false },
    ];
    try {
      await page.goto(PARTNER_URL, { waitUntil: "commit", timeout: 20_000 }).catch(async (error) => {
        if (!page.url().includes("starken.cl")) throw error;
      });
      await page.getByText(/CATEGORÍAS DE BENEFICIOS/i).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      const partnerText = await page.locator("body").innerText().catch(() => "");
      partnerTiers = parsePartnerTiers(partnerText);
    } catch {}

    return NextResponse.json({
      ok: true,
      sourceUrl: STARKEN_URL,
      partnerSourceUrl: PARTNER_URL,
      observedAt: new Date().toISOString(),
      baseRates: unique,
      partnerTiers,
      diagnostics: {
        ...diagnostics,
        partnerTiersVerified: partnerTiers.filter((tier) => tier.verifiedInPage).length,
      },
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "starken_tarifa_simple_failed",
    }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
