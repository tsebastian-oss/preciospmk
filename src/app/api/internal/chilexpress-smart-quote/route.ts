import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;
export const preferredRegion = "gru1";

const TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";
const QUOTER_URL = "https://emprendedores.chilexpress.cl/cotizar";

type QuoteInput = {
  origin: string;
  destination: string;
  weightKg: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  declaredValue?: number;
};

type Alternative = {
  service: "Básico" | "Estándar" | "Prioritario";
  priceClp: number;
  etaText?: string | null;
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

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 500) return value;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 500 ? n : null;
}

function serviceName(value: unknown): Alternative["service"] | null {
  const n = normalize(String(value || ""));
  if (/\bbasico\b/.test(n)) return "Básico";
  if (/\bestandar\b|\bstandard\b|\bexpress\b/.test(n)) return "Estándar";
  if (/\bprioritario\b|\bprex\b/.test(n)) return "Prioritario";
  return null;
}

function extractAlternatives(payload: unknown) {
  const out: Alternative[] = [];
  const seen = new Set<string>();

  function walk(value: unknown, depth: number) {
    if (depth > 7 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 120)) walk(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;

    const obj = value as Record<string, unknown>;
    const service = serviceName(
      obj.servicio ?? obj.service ?? obj.nombreServicio ?? obj.nombre_servicio ??
      obj.tipoServicio ?? obj.tipo_servicio ?? obj.descripcionServicio ?? obj.descripcion
    );
    const price = numeric(
      obj.precio ?? obj.price ?? obj.tarifa ?? obj.valor ?? obj.valorFlete ??
      obj.valor_flete ?? obj.total ?? obj.monto ?? obj.amount
    );
    if (service && price) {
      const eta = String(
        obj.fechaEntrega ?? obj.fecha_entrega ?? obj.eta ?? obj.plazo ?? obj.descripcionPlazo ?? ""
      ).trim() || null;
      const key = service + "|" + Math.round(price);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ service, priceClp: Math.round(price), etaText: eta });
      }
    }

    for (const next of Object.values(obj)) {
      if (typeof next === "object" && next !== null) walk(next, depth + 1);
    }
  }

  walk(payload, 0);
  return out;
}

function parseBodyAlternatives(text: string) {
  const out: Alternative[] = [];
  const seen = new Set<string>();
  const compact = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
  for (const label of ["Basico", "Estandar", "Prioritario"]) {
    const service = serviceName(label);
    if (!service) continue;
    const regex = new RegExp(label + "[\\s\\S]{0,220}?\\$\\s*([0-9.]{3,})", "i");
    const match = compact.match(regex);
    const p = match ? numeric(match[1]) : null;
    if (p) {
      const key = service + "|" + Math.round(p);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ service, priceClp: Math.round(p), etaText: null });
      }
    }
  }
  return out;
}

function chileBrowserEndpoint(value: string) {
  const url = new URL(value);
  const username = decodeURIComponent(url.username);
  if (username && !/-country-[a-z]{2}(?:-|$)/i.test(username)) {
    url.username = username + "-country-cl";
  }
  return url.toString();
}

async function runBrowser(input: QuoteInput, browserWs: string) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(chileBrowserEndpoint(browserWs), { timeout: 20_000 });

  try {
    const context = browser.contexts()[0] || await browser.newContext({
      locale: "es-CL",
      timezoneId: "America/Santiago",
    });
    const page = context.pages()[0] || await context.newPage();

    const captured: unknown[] = [];
    const urls: string[] = [];
    const quoteRequests: Array<{ url: string; headers: Record<string, string> }> = [];
    const onResponse = async (response: any) => {
      try {
        const url = response.url();
        const request = response.request();
        if (/GetCotizadorNacional/i.test(url)) {
          const requestHeaders = await request.allHeaders().catch(() => ({} as Record<string, string>));
          quoteRequests.push({ url, headers: requestHeaders });
        }
        if (!/(cotiz|tarif|precio|servic|shipping|quote|flete)/i.test(url)) return;
        if (!["GET", "POST"].includes(request.method())) return;
        const contentType = String(response.headers()?.["content-type"] || "");
        if (!contentType.includes("json")) return;
        const text = await response.text();
        if (!text || text.length > 500_000) return;
        let payload: unknown;
        try { payload = JSON.parse(text); } catch { return; }
        captured.push(payload);
        urls.push(url);
      } catch {}
    };
    page.on("response", onResponse);

    async function clickFirstVisibleText(text: string) {
      const matches = page.getByText(text, { exact: true });
      const count = await matches.count();
      for (let i = 0; i < count; i += 1) {
        const item = matches.nth(i);
        if (await item.isVisible().catch(() => false)) {
          await item.click({ force: true, timeout: 4_000 }).catch(() => undefined);
          return true;
        }
      }
      return false;
    }

    await page.goto(QUOTER_URL, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForTimeout(1_500);

    const inputs = page.locator("input");
    const inputCount = await inputs.count();

    async function inputByContext(pattern: RegExp, fallback: number) {
      for (let i = 0; i < inputCount; i += 1) {
        const locator = inputs.nth(i);
        const meta = await locator.evaluate((el) => ({
          placeholder: String((el as HTMLInputElement).placeholder || ""),
          name: String((el as HTMLInputElement).name || ""),
          id: String((el as HTMLInputElement).id || ""),
          context: String(el.parentElement?.parentElement?.innerText || el.parentElement?.innerText || "").slice(0, 220),
        })).catch(() => ({ placeholder: "", name: "", id: "", context: "" }));
        if (
          pattern.test([meta.placeholder, meta.name, meta.id, meta.context].join(" ")) &&
          await locator.isVisible().catch(() => false) &&
          await locator.isEditable().catch(() => false)
        ) return locator;
      }
      if (fallback >= 0 && fallback < inputCount) {
        const candidate = inputs.nth(fallback);
        if (await candidate.isVisible().catch(() => false) && await candidate.isEditable().catch(() => false)) return candidate;
      }
      return null;
    }

    async function chooseCity(kind: "origin" | "destination", value: string) {
      const pattern = kind === "origin" ? /origen|desde/i : /destino|hacia|donde envias/i;
      const fallback = kind === "origin" ? 1 : 2;
      const locator = await inputByContext(pattern, fallback);
      if (!locator) throw new Error(kind + "_input_missing");
      await locator.click({ force: true });
      await locator.fill(kind === "origin" && normalize(value).startsWith("santiago") ? "Santiago" : value);
      await page.waitForTimeout(600);

      const target = kind === "origin" && normalize(value).startsWith("santiago") ? "Santiago" : value;
      const roleOption = page.getByRole("option", { name: target, exact: false }).first();
      if ((await roleOption.count()) && await roleOption.isVisible().catch(() => false)) {
        await roleOption.click({ force: true });
        return;
      }
      const visibleText = page.getByText(target, { exact: false }).last();
      if ((await visibleText.count()) && await visibleText.isVisible().catch(() => false)) {
        await visibleText.click({ force: true });
        return;
      }
      await locator.press("ArrowDown").catch(() => undefined);
      await locator.press("Enter").catch(() => undefined);
    }

    await chooseCity("origin", input.origin);
    await page.waitForTimeout(250);
    await chooseCity("destination", input.destination);
    await page.waitForTimeout(250);

    // Make the form explicit instead of relying on text/fallback matching.
    await clickFirstVisibleText("Encomienda");
    await clickFirstVisibleText("Nacional");

    const articleSelect = page.locator('select[formcontrolname="typeProtectedShipping"]:visible').first();
    if (await articleSelect.count().catch(() => 0)) {
      await articleSelect.selectOption("5").catch(async () => {
        await articleSelect.selectOption({ label: "OTROS" }).catch(() => undefined);
      });
      await page.waitForTimeout(180);
    }

    const declared = page.locator("#amount:visible").first();
    if (await declared.count().catch(() => 0) && await declared.isEditable().catch(() => false)) {
      await declared.fill(String(input.declaredValue || 20_000), { timeout: 5_000 });
    }

    if (await clickFirstVisibleText("Medidas personalizadas")) {
      await page.waitForTimeout(250);
    }

    const height = page.locator("#caja-alto:visible").first();
    const width = page.locator("#caja-ancho:visible").first();
    const length = page.locator("#caja-largo:visible").first();
    const weight = page.locator('input[formcontrolname="weight"]:visible').first();
    for (const [locator, value] of [
      [height, input.heightCm],
      [width, input.widthCm],
      [length, input.lengthCm],
      [weight, input.weightKg],
    ] as const) {
      if (locator && await locator.count().catch(() => 0) && await locator.isVisible().catch(() => false) && await locator.isEditable().catch(() => false)) {
        await locator.fill(String(value), { timeout: 5_000 });
      }
    }

    const actionCandidates = [
      page.getByRole("button", { name: /cotizar|continuar|calcular|buscar/i }).first(),
      page.getByText("Cotizar", { exact: true }).first(),
      page.getByText("Continuar", { exact: true }).first(),
    ];
    for (const action of actionCandidates) {
      if ((await action.count().catch(() => 0)) && await action.isVisible().catch(() => false)) {
        await action.click({ force: true, timeout: 5_000 }).catch(() => undefined);
        break;
      }
    }

    await page.waitForTimeout(5_000);

    let alternatives = captured.flatMap(extractAlternatives);

    // Once the UI resolves Chilexpress city codes, replay the official quote call with
    // the exact requested parcel values. This avoids Angular timing races that can
    // briefly emit PESO/ALTO/ANCHO/LARGO=0 or the generic-dimensions flag.
    const lastQuoteRequest = quoteRequests.at(-1);
    let directQuotePayload: unknown = null;
    let directQuoteUrl: string | null = null;
    if (lastQuoteRequest) {
      try {
        const directUrl = new URL(lastQuoteRequest.url);
        directUrl.searchParams.set("PESO", String(input.weightKg));
        directUrl.searchParams.set("ALTO", String(input.heightCm));
        directUrl.searchParams.set("ANCHO", String(input.widthCm));
        directUrl.searchParams.set("LARGO", String(input.lengthCm));
        directUrl.searchParams.set("VALOR_DECLARADO", String(input.declaredValue || 20_000));
        directUrl.searchParams.set("iNDTARIFAGENERICA", "0");

        const sourceHeaders = lastQuoteRequest.headers;
        const directHeaders: Record<string, string> = {};
        for (const key of [
          "ocp-apim-subscription-key",
          "x-api-key",
          "authorization",
          "accept",
          "origin",
          "referer",
          "user-agent",
        ]) {
          const value = sourceHeaders[key];
          if (value) directHeaders[key] = value;
        }

        const directResponse = await fetch(directUrl.toString(), {
          method: "GET",
          headers: directHeaders,
          signal: AbortSignal.timeout(10_000),
        });
        if (directResponse.ok) {
          directQuotePayload = await directResponse.json().catch(() => null);
          directQuoteUrl = directUrl.toString();
          if (directQuotePayload) {
            captured.push(directQuotePayload);
            alternatives.push(...extractAlternatives(directQuotePayload));
          }
        }
      } catch {}
    }

    const body = await page.locator("body").innerText().catch(() => "");
    alternatives.push(...parseBodyAlternatives(body));

    const unique = new Map<string, Alternative>();
    for (const alt of alternatives) {
      const key = alt.service + "|" + alt.priceClp;
      if (!unique.has(key)) unique.set(key, alt);
    }
    alternatives = [...unique.values()].sort((a, b) => a.priceClp - b.priceClp);

    const formDiagnostics = await page.locator("select, ng-select, .ng-select, [role=combobox], input").evaluateAll((nodes) =>
      nodes.slice(0, 30).map((el: any) => ({
        tag: el.tagName,
        id: el.id || "",
        cls: el.className || "",
        role: el.getAttribute?.("role") || "",
        value: el.value ?? "",
        text: String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180),
        html: String(el.outerHTML || "").replace(/\s+/g, " ").slice(0, 450),
      })),
    ).catch(() => []);

    const otherMatches = await page.getByText("OTROS", { exact: true }).evaluateAll((nodes) =>
      nodes.slice(0, 10).map((el: any) => ({
        tag: el.tagName,
        cls: el.className || "",
        text: String(el.innerText || el.textContent || "").trim(),
        html: String(el.outerHTML || "").replace(/\s+/g, " ").slice(0, 450),
      })),
    ).catch(() => []);

    return {
      backend: "brightdata_browser_ui_chilexpress",
      url: page.url(),
      alternatives,
      diagnostics: {
        capturedResponses: captured.length,
        responseUrls: [...new Set(urls)].slice(0, 12),
        quoteRequestCount: quoteRequests.length,
        directQuoteUrl: directQuoteUrl ? directQuoteUrl.replace(/COD_TCC_CLIENTE=[^&]+/i, "COD_TCC_CLIENTE=***") : null,
        directQuotePreview: directQuotePayload ? JSON.stringify(directQuotePayload).slice(0, 2500) : null,
        inputCount,
        formDiagnostics,
        otherMatches,
        bodyPreview: body.replace(/\s+/g, " ").slice(0, 1200),
      },
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
  const input = body?.quote as QuoteInput | undefined;
  if (!input || !input.origin || !input.destination || !Number(input.weightKg)) {
    return NextResponse.json({ error: "quote_required" }, { status: 400 });
  }
  const runtimeEndpoint = typeof body?.connectorEndpoint === "string" ? body.connectorEndpoint.trim() : "";
  const browserWs = process.env.BRIGHTDATA_BROWSER_WS?.trim() || runtimeEndpoint;
  if (!browserWs) {
    return NextResponse.json({ error: "brightdata_browser_not_configured" }, { status: 503 });
  }
  try {
    const result = await runBrowser(input, browserWs);
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "chilexpress_quote_failed",
    }, { status: 502, headers: { "cache-control": "private, no-store" } });
  }
}
