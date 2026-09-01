import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = "gru1";

// Redeploy marker: Bright Data Browser API configured for production runtime.

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const OFFICIAL_BASE = "https://gateway.starken.cl/externo/integracion";
const LEGACY_CITY_URL = "https://gateway.starken.cl/agency/city";
const LEGACY_QUOTE_URL = "https://gateway.starken.cl/quote/cotizador";
const STARKEN_QUOTER_URL = "https://www.starken.cl/cotizador";

type City = Record<string, unknown>;
type QuoteInput = {
  origin: string;
  destination: string;
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  deliveryType?: "DOMICILIO" | "AGENCIA";
  packageType?: "PAQUETE" | "DOCUMENTO";
  service?: string;
  profileLabel?: string;
};

type QuoteResult = {
  ok: boolean;
  status?: number;
  input: QuoteInput;
  origin?: string;
  destination?: string;
  originCode?: unknown;
  destinationCode?: unknown;
  priceClp?: number | null;
  deliveryType?: string;
  serviceType?: string;
  eta?: string | null;
  error?: string;
};

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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

function unwrapCities(payload: unknown): City[] {
  if (Array.isArray(payload)) return payload as City[];
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "response", "cities", "result"]) {
    if (Array.isArray(obj[key])) return obj[key] as City[];
  }
  return [];
}

function cityName(city: City) {
  for (const key of ["city", "ciudad", "name", "nombre", "label"]) {
    const value = city[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function cityCode(city: City) {
  for (const key of ["code_dls", "codigo_dls", "codigo", "id", "code", "value"]) {
    const value = city[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

function findCity(cities: City[], requested: string) {
  const target = normalize(requested);
  const exact = cities.find((city) => normalize(cityName(city)) === target);
  if (exact) return exact;
  const starts = cities.find((city) => {
    const current = normalize(cityName(city));
    return current.startsWith(target) || target.startsWith(current);
  });
  if (starts) return starts;
  return cities.find((city) => normalize(JSON.stringify(city)).includes(target)) ?? null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPrice(payload: unknown): number | null {
  const candidates: Array<{ key: string; value: number }> = [];
  function walk(value: unknown, path: string, depth: number) {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 20); i += 1) {
        walk(value[i], path + "[" + i + "]", depth + 1);
      }
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? path + "." + key : key;
      if (/(valor.*flete|flete|tarifa|precio|total)/i.test(key)) {
        const n = numeric(next);
        if (n) candidates.push({ key: p, value: n });
      }
      if (typeof next === "object" && next !== null) walk(next, p, depth + 1);
    }
  }
  walk(payload, "", 0);
  const priority = candidates.sort((a, b) => {
    const score = (x: string) =>
      /valor.*flete/i.test(x) ? 0 : /flete/i.test(x) ? 1 : /tarifa|precio/i.test(x) ? 2 : 3;
    return score(a.key) - score(b.key) || a.value - b.value;
  });
  return priority[0]?.value ?? null;
}

function providerDelivery(raw: unknown): "DOMICILIO" | "AGENCIA" | null {
  const value = String(raw || "").trim().toUpperCase();
  if (value.includes("DOMICILIO")) return "DOMICILIO";
  if (value.includes("AGENCIA") || value.includes("SUCURSAL")) return "AGENCIA";
  return null;
}

function quoteInputValid(input: QuoteInput) {
  const positive = [input.weightKg, input.heightCm, input.widthCm, input.lengthCm]
    .every((n) => Number.isFinite(Number(n)) && Number(n) > 0);
  return positive && String(input.origin || "").trim() && String(input.destination || "").trim();
}

function officialHeaders(token: string, hasBody = false) {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    ...(hasBody ? { "content-type": "application/json", "cache-control": "no-cache" } : {}),
  };
}

async function officialJson(path: string, token: string, init?: RequestInit) {
  const response = await fetch(OFFICIAL_BASE + path, {
    ...init,
    headers: {
      ...officialHeaders(token, Boolean(init?.body)),
      ...(init?.headers || {}),
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok) {
    const error = new Error(`official_http_${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  if (payload == null) throw new Error("official_invalid_json");
  return payload;
}

async function quoteOfficialOne(cities: City[], token: string, input: QuoteInput): Promise<QuoteResult> {
  const originCity = findCity(cities, input.origin);
  const destinationCity = findCity(cities, input.destination);
  const originCode = cityCode(originCity ?? {});
  const destinationCode = cityCode(destinationCity ?? {});
  if (!originCity || !destinationCity || originCode == null || destinationCode == null) {
    return { ok: false, input, error: "city_not_resolved" };
  }

  const payload = await officialJson("/quote/cotizador-multiple", token, {
    method: "POST",
    body: JSON.stringify({
      origen: Number(originCode),
      destino: Number(destinationCode),
      bulto: input.packageType === "DOCUMENTO" ? "DOCUMENTO" : "BULTO",
      alto: Number(input.heightCm),
      ancho: Number(input.widthCm),
      largo: Number(input.lengthCm),
      kilos: Number(input.weightKg),
      todas_alternativas: true,
    }),
  });

  const alternatives = payload && typeof payload === "object" && Array.isArray((payload as any).alternativas)
    ? (payload as any).alternativas
    : [];

  const candidates = alternatives
    .map((raw: any) => ({
      raw,
      price: numeric(raw?.precio),
      delivery: providerDelivery(raw?.entrega),
      service: String(raw?.servicio || input.service || "NORMAL").trim() || "NORMAL",
    }))
    .filter((x: any) => x.price && (!input.deliveryType || x.delivery === input.deliveryType))
    .sort((a: any, b: any) => Number(a.price) - Number(b.price));

  const selected = candidates[0];
  if (!selected) {
    return {
      ok: false,
      input,
      origin: cityName(originCity),
      destination: cityName(destinationCity),
      originCode,
      destinationCode,
      error: "no_compatible_alternative",
    };
  }

  return {
    ok: true,
    status: 201,
    input,
    origin: cityName(originCity),
    destination: cityName(destinationCity),
    originCode,
    destinationCode,
    priceClp: Number(selected.price),
    deliveryType: selected.delivery || input.deliveryType || "DOMICILIO",
    serviceType: selected.service,
    eta: null,
  };
}

async function runOfficial(quotes: QuoteInput[], token: string) {
  const cityPayload = await officialJson("/agency/city", token);
  const cities = unwrapCities(cityPayload);
  if (!cities.length) throw new Error("official_city_catalog_empty");

  const results: QuoteResult[] = [];
  for (let i = 0; i < quotes.length; i += 2) {
    const batch = quotes.slice(i, i + 2);
    const settled = await Promise.all(batch.map(async (item) => {
      try {
        return await quoteOfficialOne(cities, token, item);
      } catch (error) {
        return {
          ok: false,
          input: item,
          error: error instanceof Error ? error.message : "official_quote_failed",
        } as QuoteResult;
      }
    }));
    results.push(...settled);
    if (i + 2 < quotes.length) await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return { backend: "starken_official_api", cityCount: cities.length, results };
}

function chileBrowserEndpoint(value: string) {
  const url = new URL(value);
  const username = decodeURIComponent(url.username);
  if (username && !/-country-[a-z]{2}(?:-|$)/i.test(username)) {
    url.username = username + "-country-cl";
  }
  return url.toString();
}

async function runResidentialBrowser(quotes: QuoteInput[], browserWs: string) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(chileBrowserEndpoint(browserWs), { timeout: 20_000 });

  function quoteOptions(payload: unknown) {
    const options: Array<{ price: number; delivery: "DOMICILIO" | "AGENCIA" | null; service: string }> = [];
    const seen = new Set<string>();

    function walk(value: unknown, depth: number) {
      if (depth > 6 || value == null) return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 80)) walk(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;

      const obj = value as Record<string, unknown>;
      const price = numeric(
        obj.precio ??
        obj.valorFlete ??
        obj.valor_flete ??
        obj.flete ??
        obj.tarifa ??
        obj.total
      );
      if (price) {
        const delivery = providerDelivery(
          obj.entrega ??
          obj.tipoEntrega ??
          obj.tipo_entrega ??
          obj.delivery ??
          obj.modalidad
        );
        const service = String(obj.servicio ?? obj.service ?? obj.tipoServicio ?? "NORMAL").trim() || "NORMAL";
        const key = [price, delivery || "", service].join("|");
        if (!seen.has(key)) {
          seen.add(key);
          options.push({ price, delivery, service });
        }
      }

      for (const next of Object.values(obj)) {
        if (typeof next === "object" && next !== null) walk(next, depth + 1);
      }
    }

    walk(payload, 0);
    return options;
  }

  function priceFromText(text: string) {
    const match = text.match(/(?:valor\s*(?:del\s*)?flete|total\s*(?:a\s*pagar)?|tarifa)[^$\d]{0,40}\$?\s*([\d.]{3,})/i);
    if (!match) return null;
    return numeric(match[1]);
  }

  try {
    const context = browser.contexts()[0] || await browser.newContext({
      locale: "es-CL",
      timezoneId: "America/Santiago",
    });
    const page = context.pages()[0] || await context.newPage();

    await page.goto(STARKEN_QUOTER_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByText(/Cotiza con Starken/i).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);

    const selects = page.locator("select");
    const inputs = page.locator("input");
    const selectCount = await selects.count();
    const inputCount = await inputs.count();

    const selectMeta: Array<{ index: number; context: string; options: Array<{ label: string; value: string }> }> = [];
    for (let i = 0; i < selectCount; i += 1) {
      const locator = selects.nth(i);
      const contextText = await locator.evaluate((element) =>
        String(element.parentElement?.parentElement?.innerText || element.parentElement?.innerText || "").slice(0, 300)
      ).catch(() => "");
      const options = await locator.locator("option").evaluateAll((nodes) =>
        nodes.map((node) => ({
          label: String((node as HTMLOptionElement).textContent || "").trim(),
          value: String((node as HTMLOptionElement).value || ""),
        }))
      ).catch(() => []);
      selectMeta.push({ index: i, context: contextText, options });
    }

    const inputMeta: Array<{ index: number; context: string; type: string; placeholder: string }> = [];
    for (let i = 0; i < inputCount; i += 1) {
      const locator = inputs.nth(i);
      const data = await locator.evaluate((element) => ({
        context: String(element.parentElement?.parentElement?.innerText || element.parentElement?.innerText || "").slice(0, 240),
        type: String((element as HTMLInputElement).type || ""),
        placeholder: String((element as HTMLInputElement).placeholder || ""),
      })).catch(() => ({ context: "", type: "", placeholder: "" }));
      inputMeta.push({ index: i, ...data });
    }

    const norm = (value: string) => normalize(value);
    const originSelect = selectMeta.find((item) => /origen/i.test(item.context))?.index ?? 0;
    const destinationSelect = selectMeta.find((item) => /destino/i.test(item.context))?.index ?? 1;

    const comboboxes = page.locator('[role="combobox"]');
    const comboboxCount = await comboboxes.count();

    if (selectCount < 2 && comboboxCount < 2) {
      const title = await page.title().catch(() => "");
      const body = await page.locator("body").innerText().catch(() => "");
      throw new Error(
        `ui_origin_destination_controls_missing:selects=${selectCount}:comboboxes=${comboboxCount}:inputs=${inputCount}:url=${page.url()}:title=${title.slice(0,120)}:body=${body.replace(/\\s+/g," ").slice(0,500)}`
      );
    }

    const findInputIndex = (label: RegExp, fallback: number) =>
      inputMeta.find((item) => label.test(item.context) || label.test(item.placeholder))?.index ?? fallback;

    const heightInput = findInputIndex(/alto/i, 0);
    const lengthInput = findInputIndex(/largo/i, 1);
    const widthInput = findInputIndex(/ancho/i, 2);
    const weightInput = findInputIndex(/peso|kilo/i, 3);
    const declaredInput = findInputIndex(/valor\s*declarado|declarado/i, 4);

    async function choose(kind: "origin" | "destination", requested: string) {
      const requestedLabel = requested === "Santiago Centro" ? "Santiago" : requested;
      const target = norm(requestedLabel);

      if (selectCount >= 2) {
        const selectIndex = kind === "origin" ? originSelect : destinationSelect;
        const locator = selects.nth(selectIndex);
        const options = await locator.locator("option").evaluateAll((nodes) =>
          nodes.map((node) => ({
            label: String((node as HTMLOptionElement).textContent || "").trim(),
            value: String((node as HTMLOptionElement).value || ""),
          }))
        );
        const match = options.find((option) => norm(option.label) === target)
          || options.find((option) => norm(option.label).includes(target))
          || options.find((option) => target.includes(norm(option.label)) && norm(option.label).length > 3);
        if (!match) throw new Error(`ui_city_not_found:${requested}`);
        await locator.selectOption(match.value);
        return;
      }

      const comboIndex = kind === "origin" ? 0 : 1;
      const combo = comboboxes.nth(comboIndex);
      await combo.click({ timeout: 8_000 });
      await page.waitForTimeout(250);

      const editable = await combo.isEditable().catch(() => false);
      if (editable) {
        await combo.fill(requestedLabel).catch(() => undefined);
        await page.waitForTimeout(350);
      }

      const roleOption = page.getByRole("option", { name: new RegExp(requestedLabel, "i") }).first();
      if (await roleOption.count()) {
        await roleOption.click({ timeout: 8_000 });
        return;
      }

      const exactText = page.getByText(new RegExp(`^${requestedLabel.replace(/[.*+?^$()|[\\]{}]/g, "\\    async function choose(selectIndex: number, requested: string) {
      const locator = selects.nth(selectIndex);
      const options = await locator.locator("option").evaluateAll((nodes) =>
        nodes.map((node) => ({
          label: String((node as HTMLOptionElement).textContent || "").trim(),
          value: String((node as HTMLOptionElement).value || ""),
        }))
      );
      const target = norm(requested === "Santiago Centro" ? "Santiago" : requested);
      const match = options.find((option) => norm(option.label) === target)
        || options.find((option) => norm(option.label).includes(target))
        || options.find((option) => target.includes(norm(option.label)) && norm(option.label).length > 3);
      if (!match) throw new Error(`ui_city_not_found:${requested}`);
      await locator.selectOption(match.value);
    }")}import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = "gru1";

// Redeploy marker: Bright Data Browser API configured for production runtime.

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const OFFICIAL_BASE = "https://gateway.starken.cl/externo/integracion";
const LEGACY_CITY_URL = "https://gateway.starken.cl/agency/city";
const LEGACY_QUOTE_URL = "https://gateway.starken.cl/quote/cotizador";
const STARKEN_QUOTER_URL = "https://www.starken.cl/cotizador";

type City = Record<string, unknown>;
type QuoteInput = {
  origin: string;
  destination: string;
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  deliveryType?: "DOMICILIO" | "AGENCIA";
  packageType?: "PAQUETE" | "DOCUMENTO";
  service?: string;
  profileLabel?: string;
};

type QuoteResult = {
  ok: boolean;
  status?: number;
  input: QuoteInput;
  origin?: string;
  destination?: string;
  originCode?: unknown;
  destinationCode?: unknown;
  priceClp?: number | null;
  deliveryType?: string;
  serviceType?: string;
  eta?: string | null;
  error?: string;
};

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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

function unwrapCities(payload: unknown): City[] {
  if (Array.isArray(payload)) return payload as City[];
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ["data", "response", "cities", "result"]) {
    if (Array.isArray(obj[key])) return obj[key] as City[];
  }
  return [];
}

function cityName(city: City) {
  for (const key of ["city", "ciudad", "name", "nombre", "label"]) {
    const value = city[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function cityCode(city: City) {
  for (const key of ["code_dls", "codigo_dls", "codigo", "id", "code", "value"]) {
    const value = city[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

function findCity(cities: City[], requested: string) {
  const target = normalize(requested);
  const exact = cities.find((city) => normalize(cityName(city)) === target);
  if (exact) return exact;
  const starts = cities.find((city) => {
    const current = normalize(cityName(city));
    return current.startsWith(target) || target.startsWith(current);
  });
  if (starts) return starts;
  return cities.find((city) => normalize(JSON.stringify(city)).includes(target)) ?? null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPrice(payload: unknown): number | null {
  const candidates: Array<{ key: string; value: number }> = [];
  function walk(value: unknown, path: string, depth: number) {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 20); i += 1) {
        walk(value[i], path + "[" + i + "]", depth + 1);
      }
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? path + "." + key : key;
      if (/(valor.*flete|flete|tarifa|precio|total)/i.test(key)) {
        const n = numeric(next);
        if (n) candidates.push({ key: p, value: n });
      }
      if (typeof next === "object" && next !== null) walk(next, p, depth + 1);
    }
  }
  walk(payload, "", 0);
  const priority = candidates.sort((a, b) => {
    const score = (x: string) =>
      /valor.*flete/i.test(x) ? 0 : /flete/i.test(x) ? 1 : /tarifa|precio/i.test(x) ? 2 : 3;
    return score(a.key) - score(b.key) || a.value - b.value;
  });
  return priority[0]?.value ?? null;
}

function providerDelivery(raw: unknown): "DOMICILIO" | "AGENCIA" | null {
  const value = String(raw || "").trim().toUpperCase();
  if (value.includes("DOMICILIO")) return "DOMICILIO";
  if (value.includes("AGENCIA") || value.includes("SUCURSAL")) return "AGENCIA";
  return null;
}

function quoteInputValid(input: QuoteInput) {
  const positive = [input.weightKg, input.heightCm, input.widthCm, input.lengthCm]
    .every((n) => Number.isFinite(Number(n)) && Number(n) > 0);
  return positive && String(input.origin || "").trim() && String(input.destination || "").trim();
}

function officialHeaders(token: string, hasBody = false) {
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    ...(hasBody ? { "content-type": "application/json", "cache-control": "no-cache" } : {}),
  };
}

async function officialJson(path: string, token: string, init?: RequestInit) {
  const response = await fetch(OFFICIAL_BASE + path, {
    ...init,
    headers: {
      ...officialHeaders(token, Boolean(init?.body)),
      ...(init?.headers || {}),
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok) {
    const error = new Error(`official_http_${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  if (payload == null) throw new Error("official_invalid_json");
  return payload;
}

async function quoteOfficialOne(cities: City[], token: string, input: QuoteInput): Promise<QuoteResult> {
  const originCity = findCity(cities, input.origin);
  const destinationCity = findCity(cities, input.destination);
  const originCode = cityCode(originCity ?? {});
  const destinationCode = cityCode(destinationCity ?? {});
  if (!originCity || !destinationCity || originCode == null || destinationCode == null) {
    return { ok: false, input, error: "city_not_resolved" };
  }

  const payload = await officialJson("/quote/cotizador-multiple", token, {
    method: "POST",
    body: JSON.stringify({
      origen: Number(originCode),
      destino: Number(destinationCode),
      bulto: input.packageType === "DOCUMENTO" ? "DOCUMENTO" : "BULTO",
      alto: Number(input.heightCm),
      ancho: Number(input.widthCm),
      largo: Number(input.lengthCm),
      kilos: Number(input.weightKg),
      todas_alternativas: true,
    }),
  });

  const alternatives = payload && typeof payload === "object" && Array.isArray((payload as any).alternativas)
    ? (payload as any).alternativas
    : [];

  const candidates = alternatives
    .map((raw: any) => ({
      raw,
      price: numeric(raw?.precio),
      delivery: providerDelivery(raw?.entrega),
      service: String(raw?.servicio || input.service || "NORMAL").trim() || "NORMAL",
    }))
    .filter((x: any) => x.price && (!input.deliveryType || x.delivery === input.deliveryType))
    .sort((a: any, b: any) => Number(a.price) - Number(b.price));

  const selected = candidates[0];
  if (!selected) {
    return {
      ok: false,
      input,
      origin: cityName(originCity),
      destination: cityName(destinationCity),
      originCode,
      destinationCode,
      error: "no_compatible_alternative",
    };
  }

  return {
    ok: true,
    status: 201,
    input,
    origin: cityName(originCity),
    destination: cityName(destinationCity),
    originCode,
    destinationCode,
    priceClp: Number(selected.price),
    deliveryType: selected.delivery || input.deliveryType || "DOMICILIO",
    serviceType: selected.service,
    eta: null,
  };
}

async function runOfficial(quotes: QuoteInput[], token: string) {
  const cityPayload = await officialJson("/agency/city", token);
  const cities = unwrapCities(cityPayload);
  if (!cities.length) throw new Error("official_city_catalog_empty");

  const results: QuoteResult[] = [];
  for (let i = 0; i < quotes.length; i += 2) {
    const batch = quotes.slice(i, i + 2);
    const settled = await Promise.all(batch.map(async (item) => {
      try {
        return await quoteOfficialOne(cities, token, item);
      } catch (error) {
        return {
          ok: false,
          input: item,
          error: error instanceof Error ? error.message : "official_quote_failed",
        } as QuoteResult;
      }
    }));
    results.push(...settled);
    if (i + 2 < quotes.length) await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return { backend: "starken_official_api", cityCount: cities.length, results };
}

function chileBrowserEndpoint(value: string) {
  const url = new URL(value);
  const username = decodeURIComponent(url.username);
  if (username && !/-country-[a-z]{2}(?:-|$)/i.test(username)) {
    url.username = username + "-country-cl";
  }
  return url.toString();
}

async function runResidentialBrowser(quotes: QuoteInput[], browserWs: string) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(chileBrowserEndpoint(browserWs), { timeout: 20_000 });

  function quoteOptions(payload: unknown) {
    const options: Array<{ price: number; delivery: "DOMICILIO" | "AGENCIA" | null; service: string }> = [];
    const seen = new Set<string>();

    function walk(value: unknown, depth: number) {
      if (depth > 6 || value == null) return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 80)) walk(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;

      const obj = value as Record<string, unknown>;
      const price = numeric(
        obj.precio ??
        obj.valorFlete ??
        obj.valor_flete ??
        obj.flete ??
        obj.tarifa ??
        obj.total
      );
      if (price) {
        const delivery = providerDelivery(
          obj.entrega ??
          obj.tipoEntrega ??
          obj.tipo_entrega ??
          obj.delivery ??
          obj.modalidad
        );
        const service = String(obj.servicio ?? obj.service ?? obj.tipoServicio ?? "NORMAL").trim() || "NORMAL";
        const key = [price, delivery || "", service].join("|");
        if (!seen.has(key)) {
          seen.add(key);
          options.push({ price, delivery, service });
        }
      }

      for (const next of Object.values(obj)) {
        if (typeof next === "object" && next !== null) walk(next, depth + 1);
      }
    }

    walk(payload, 0);
    return options;
  }

  function priceFromText(text: string) {
    const match = text.match(/(?:valor\s*(?:del\s*)?flete|total\s*(?:a\s*pagar)?|tarifa)[^$\d]{0,40}\$?\s*([\d.]{3,})/i);
    if (!match) return null;
    return numeric(match[1]);
  }

  try {
    const context = browser.contexts()[0] || await browser.newContext({
      locale: "es-CL",
      timezoneId: "America/Santiago",
    });
    const page = context.pages()[0] || await context.newPage();

    await page.goto(STARKEN_QUOTER_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.getByText(/Cotiza con Starken/i).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);

    const selects = page.locator("select");
    const inputs = page.locator("input");
    const selectCount = await selects.count();
    const inputCount = await inputs.count();

    const selectMeta: Array<{ index: number; context: string; options: Array<{ label: string; value: string }> }> = [];
    for (let i = 0; i < selectCount; i += 1) {
      const locator = selects.nth(i);
      const contextText = await locator.evaluate((element) =>
        String(element.parentElement?.parentElement?.innerText || element.parentElement?.innerText || "").slice(0, 300)
      ).catch(() => "");
      const options = await locator.locator("option").evaluateAll((nodes) =>
        nodes.map((node) => ({
          label: String((node as HTMLOptionElement).textContent || "").trim(),
          value: String((node as HTMLOptionElement).value || ""),
        }))
      ).catch(() => []);
      selectMeta.push({ index: i, context: contextText, options });
    }

    const inputMeta: Array<{ index: number; context: string; type: string; placeholder: string }> = [];
    for (let i = 0; i < inputCount; i += 1) {
      const locator = inputs.nth(i);
      const data = await locator.evaluate((element) => ({
        context: String(element.parentElement?.parentElement?.innerText || element.parentElement?.innerText || "").slice(0, 240),
        type: String((element as HTMLInputElement).type || ""),
        placeholder: String((element as HTMLInputElement).placeholder || ""),
      })).catch(() => ({ context: "", type: "", placeholder: "" }));
      inputMeta.push({ index: i, ...data });
    }

    const norm = (value: string) => normalize(value);
    const originSelect = selectMeta.find((item) => /origen/i.test(item.context))?.index ?? 0;
    const destinationSelect = selectMeta.find((item) => /destino/i.test(item.context))?.index ?? 1;

    const comboboxes = page.locator('[role="combobox"]');
    const comboboxCount = await comboboxes.count();

    if (selectCount < 2 && comboboxCount < 2) {
      const title = await page.title().catch(() => "");
      const body = await page.locator("body").innerText().catch(() => "");
      throw new Error(
        `ui_origin_destination_controls_missing:selects=${selectCount}:comboboxes=${comboboxCount}:inputs=${inputCount}:url=${page.url()}:title=${title.slice(0,120)}:body=${body.replace(/\\s+/g," ").slice(0,500)}`
      );
    }

    const findInputIndex = (label: RegExp, fallback: number) =>
      inputMeta.find((item) => label.test(item.context) || label.test(item.placeholder))?.index ?? fallback;

    const heightInput = findInputIndex(/alto/i, 0);
    const lengthInput = findInputIndex(/largo/i, 1);
    const widthInput = findInputIndex(/ancho/i, 2);
    const weightInput = findInputIndex(/peso|kilo/i, 3);
    const declaredInput = findInputIndex(/valor\s*declarado|declarado/i, 4);

, "i")).last();
      if (await exactText.count()) {
        await exactText.click({ timeout: 8_000 });
        return;
      }

      const fuzzyText = page.getByText(new RegExp(requestedLabel, "i")).last();
      if (await fuzzyText.count()) {
        await fuzzyText.click({ timeout: 8_000 });
        return;
      }

      throw new Error(`ui_city_option_not_found:${requested}`);
    }

    async function fill(index: number, value: number) {
      if (index < 0 || index >= inputCount) return;
      const locator = inputs.nth(index);
      if (!(await locator.isEditable().catch(() => false))) return;
      await locator.fill(String(value));
    }

    const button = page.getByRole("button", { name: /cotizar/i }).first();
    if (!(await button.count())) throw new Error("ui_quote_button_missing");

    const results: QuoteResult[] = [];

    for (const input of quotes) {
      try {
        await choose("origin", input.origin);
        await page.waitForTimeout(250);
        await choose("destination", input.destination);
        await fill(heightInput, input.heightCm);
        await fill(lengthInput, input.lengthCm);
        await fill(widthInput, input.widthCm);
        await fill(weightInput, input.weightKg);
        await fill(declaredInput, 10_000);

        const captured: unknown[] = [];
        const onResponse = async (response: any) => {
          try {
            const request = response.request();
            if (request.method() !== "POST") return;
            const url = response.url();
            if (!/(quote|cotiz|tarif|flete|precio)/i.test(url)) return;
            const text = await response.text();
            let payload: unknown = text.slice(0, 20_000);
            try { payload = JSON.parse(text); } catch {}
            captured.push(payload);
          } catch {}
        };

        page.on("response", onResponse);
        await button.click({ timeout: 10_000 });
        await page.waitForTimeout(1_250);
        page.off("response", onResponse);

        const options = captured.flatMap((payload) => quoteOptions(payload));
        const exact = options
          .filter((option) => !input.deliveryType || option.delivery === input.deliveryType)
          .sort((a, b) => a.price - b.price)[0];
        const anyOption = options.sort((a, b) => a.price - b.price)[0];

        let selected = exact || anyOption;
        if (!selected) {
          const bodyText = await page.locator("body").innerText().catch(() => "");
          const visiblePrice = priceFromText(bodyText);
          if (visiblePrice) {
            selected = {
              price: visiblePrice,
              delivery: input.deliveryType || "DOMICILIO",
              service: input.service || "NORMAL",
            };
          }
        }

        if (!selected) {
          results.push({
            ok: false,
            input,
            error: `ui_price_not_found:responses=${captured.length}:selects=${selectCount}:inputs=${inputCount}`,
          });
          continue;
        }

        results.push({
          ok: true,
          status: 200,
          input,
          origin: input.origin,
          destination: input.destination,
          priceClp: selected.price,
          deliveryType: selected.delivery || input.deliveryType || "DOMICILIO",
          serviceType: selected.service || input.service || "NORMAL",
          eta: null,
        });
      } catch (error) {
        results.push({
          ok: false,
          input,
          error: error instanceof Error ? error.message : "ui_quote_failed",
        });
      }
    }

    return {
      backend: "brightdata_browser_ui_chile",
      cityCount: Math.max(
        selectMeta[originSelect]?.options?.length || 0,
        selectMeta[destinationSelect]?.options?.length || 0,
      ),
      results,
    };
  } finally {
    await browser.close();
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const quotes: QuoteInput[] = Array.isArray(body?.quotes)
    ? body.quotes.slice(0, 30).filter(quoteInputValid)
    : [];
  if (!quotes.length) {
    return NextResponse.json({ error: "quotes_required" }, { status: 400 });
  }

  const officialToken = process.env.STARKEN_INTEGRATION_TOKEN?.trim() || "";
  const runtimeEndpoint = typeof body?.connectorEndpoint === "string" ? body.connectorEndpoint.trim() : "";
  const browserWs = process.env.BRIGHTDATA_BROWSER_WS?.trim() || runtimeEndpoint;
  const attempts: string[] = [];

  if (officialToken) {
    try {
      const run = await runOfficial(quotes, officialToken);
      const accepted = run.results.filter((item) => item.ok && Number(item.priceClp) > 0).length;
      return NextResponse.json({
        ok: true,
        backend: run.backend,
        cityCount: run.cityCount,
        requested: quotes.length,
        accepted,
        results: run.results,
      }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      attempts.push("official:" + (error instanceof Error ? error.message : "failed"));
    }
  }

  if (browserWs) {
    try {
      const run = await runResidentialBrowser(quotes, browserWs);
      const accepted = run.results.filter((item) => item.ok && Number(item.priceClp) > 0).length;
      return NextResponse.json({
        ok: true,
        backend: run.backend,
        cityCount: run.cityCount,
        requested: quotes.length,
        accepted,
        results: run.results,
      }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      attempts.push("residential:" + (error instanceof Error ? error.message : "failed"));
    }
  }

  if (!officialToken && !browserWs) {
    return NextResponse.json({
      error: "starken_connector_not_configured",
      configured: false,
      accepted: 0,
      requested: quotes.length,
      requiredAny: ["STARKEN_INTEGRATION_TOKEN", "BRIGHTDATA_BROWSER_WS"],
    }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }

  return NextResponse.json({
    error: "starken_connector_unavailable",
    configured: true,
    accepted: 0,
    requested: quotes.length,
    attempts,
  }, { status: 502, headers: { "cache-control": "private, no-store" } });
}
