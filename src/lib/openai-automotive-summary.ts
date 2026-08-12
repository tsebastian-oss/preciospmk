const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const AUTOMOTIVE_MODEL = (process.env.OPENAI_AUTOMOTIVE_MODEL ?? "gpt-5.6").trim();
const GENERAL_MODEL = (process.env.OPENAI_MODEL ?? "").trim();

export type AutomotiveBrandSummaryInput = {
  comparison: "previous_week" | "previous_month";
  rows: Array<{
    brand: string;
    dealer: string;
    currentAverage: number;
    previousAverage: number;
    absoluteChange: number;
    percentageChange: number | null;
    versions: number;
    comparableVersions: number;
    increasedVersions: number;
    decreasedVersions: number;
    unchangedVersions: number;
  }>;
};

type OpenAIResponse = {
  model?: string;
  output?: Array<Record<string, any>>;
  error?: { message?: string; code?: string; type?: string } | null;
};

function outputText(response: OpenAIResponse) {
  return (response.output ?? [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" && typeof item?.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function modelCandidates() {
  return [...new Set([
    AUTOMOTIVE_MODEL,
    GENERAL_MODEL,
    "gpt-5.6",
    "gpt-5.1",
    "gpt-5-mini",
  ].map((item) => item.trim()).filter(Boolean))].slice(0, 5);
}

function isRetryableModelError(status: number) {
  return status === 400 || status === 403 || status === 404;
}

export function openAiAutomotiveSummaryConfigured() {
  return OPENAI_API_KEY.length > 20;
}

export async function generateAutomotiveBrandSummary(input: AutomotiveBrandSummaryInput) {
  if (!openAiAutomotiveSummaryConfigured()) throw new Error("OpenAI automotive summary is not configured");

  const comparable = input.rows.filter((row) => row.percentageChange !== null);
  if (!comparable.length) {
    return {
      answer: input.comparison === "previous_month"
        ? "Todavía no existe suficiente histórico comparable de aproximadamente un mes para construir una lectura de mercado confiable."
        : "Todavía no existe suficiente histórico semanal comparable para construir una lectura de mercado confiable.",
      model: AUTOMOTIVE_MODEL,
      ai: true as const,
    };
  }

  const period = input.comparison === "previous_month" ? "mes pasado" : "semana pasada";
  const evidence = comparable.slice(0, 80).map((row) => ({
    marca: row.brand,
    fuente: row.dealer,
    precio_promedio_actual_clp: Math.round(row.currentAverage),
    precio_promedio_anterior_clp: Math.round(row.previousAverage),
    variacion_clp: Math.round(row.absoluteChange),
    variacion_pct: Number((row.percentageChange ?? 0).toFixed(2)),
    versiones_comparables: row.comparableVersions,
    versiones_suben: row.increasedVersions,
    versiones_bajan: row.decreasedVersions,
    versiones_estables: row.unchangedVersions,
  }));

  const instructions = `Eres un analista senior del mercado automotriz chileno para MGP Pricing Intelligence.
Redacta un resumen ejecutivo breve, natural y accionable sobre movimientos de precios por marca.
Trabaja exclusivamente con los datos entregados. No inventes causas comerciales, campañas, lanzamientos ni explicaciones externas que no estén en la evidencia.
La comparación es contra ${period} y usa las mismas versiones y la misma fuente por marca.
Prioriza: dirección general del mercado, mayores alzas, mayores caídas, marcas estables y si el movimiento parece amplio o concentrado.
Cuando sea útil, menciona cuántas versiones comparables sostienen una conclusión para evitar sobreinterpretar muestras pequeñas.
Formato: un párrafo ejecutivo inicial de 2 a 4 frases y luego entre 3 y 6 bullets cortos. Español de Chile, tono profesional. No uses tablas.`;

  const inputText = `Datos de variación por marca:\n${JSON.stringify(evidence)}`;
  let lastError: unknown = null;

  for (const model of modelCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions,
          input: inputText,
          store: false,
          reasoning: { effort: "low" },
          max_output_tokens: 1_200,
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as OpenAIResponse;
      if (!response.ok) {
        const error = new Error(body?.error?.message || `OpenAI Responses API failed (${response.status})`);
        (error as Error & { status?: number }).status = response.status;
        lastError = error;
        if (isRetryableModelError(response.status)) continue;
        throw error;
      }
      const answer = outputText(body);
      if (!answer) throw new Error("OpenAI returned no automotive summary");
      return { answer, model: body.model || model, ai: true as const };
    } catch (error) {
      lastError = error;
      if ((error as Error)?.name === "AbortError") break;
      const status = Number((error as { status?: number })?.status || 0);
      if (!isRetryableModelError(status)) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenAI automotive summary failed");
}
