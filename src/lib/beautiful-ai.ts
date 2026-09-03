type BeautifulSlideType =
  | "title"
  | "conclusion"
  | "text-with-image"
  | "bullet-list"
  | "timeline-diagram"
  | "team-members"
  | "table"
  | "process-diagram"
  | "numbered-list"
  | "basic-company-info"
  | "images-with-text"
  | "photo-collage"
  | "quote"
  | "chart"
  | "company-logos"
  | "biography"
  | "venn-diagram"
  | "comparison-diagram"
  | "agenda"
  | "boxes-with-text"
  | "arrow-bars"
  | "thermometer"
  | "x-y-plot"
  | "funnel"
  | "wordcloud"
  | "swot-diagram"
  | "arrow-cycles"
  | "cycle"
  | "hub-and-spoke"
  | "target"
  | "journey"
  | "gantt-chart";

export type BeautifulSlide = {
  title: string;
  summary: string;
  type: BeautifulSlideType;
};

export type BeautifulCreateInput = {
  title: string;
  slides: BeautifulSlide[];
  themeId?: string;
  language?: string;
  preserveExactText?: boolean;
  imageSource?: "ai" | "web" | "stock" | "none";
  imageStyle?: string;
  themeOptions?: {
    preferredShapes?: "none" | "circle" | "square" | "rounded";
    typography?: "bold" | "modern" | "simple" | "serif" | "editorial" | "playful" | "technical" | "classic";
    headerPosition?: "left" | "center";
    fillStyle?: "outline" | "muted" | "filled";
    backgroundColor?: "light" | "dark";
    colors?: string[];
  };
};

export type BeautifulPresentationResult = {
  presentationId: string;
  title?: string;
  editorUrl?: string;
  playerUrl?: string;
  raw: Record<string, unknown>;
};

const API_BASE = "https://www.beautiful.ai/api/v1";

function apiKey() {
  return process.env.BEAUTIFUL_AI_API_KEY || process.env.BEAUTIFUL_API_KEY || "";
}

function extractObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function beautifulRequest(path: string, body: Record<string, unknown>) {
  const key = apiKey();
  if (!key) {
    const error = new Error("Beautiful.ai API no configurada. Falta BEAUTIFUL_AI_API_KEY en Vercel.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }

  const response = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": key,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const data = extractObject(payload);
    const message = firstString(data.message, data.error, data.detail) || `Beautiful.ai respondió ${response.status}`;
    const error = new Error(message);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return extractObject(payload);
}

export async function createBeautifulPresentation(input: BeautifulCreateInput): Promise<BeautifulPresentationResult> {
  const raw = await beautifulRequest("createPresentation", {
    title: input.title,
    slides: input.slides,
    themeId: input.themeId ?? "dark",
    themeOptions: input.themeOptions ?? {
      typography: "modern",
      headerPosition: "left",
      fillStyle: "muted",
      backgroundColor: "dark",
      preferredShapes: "rounded",
      colors: ["#77D9A8", "#447CFF", "#FFD166"],
    },
    imageSource: input.imageSource ?? "none",
    imageStyle: input.imageStyle,
    language: input.language ?? "es",
    preserveExactText: input.preserveExactText ?? true,
  });

  const data = extractObject(raw.data);
  const presentation = extractObject(raw.presentation);
  const presentationId = firstString(
    raw.presentationId,
    raw.id,
    data.presentationId,
    data.id,
    presentation.presentationId,
    presentation.id,
  );

  if (!presentationId) throw new Error("Beautiful.ai creó la presentación pero no devolvió presentationId.");

  return {
    presentationId,
    title: firstString(raw.title, data.title, presentation.title),
    editorUrl: firstString(raw.editorUrl, raw.editUrl, data.editorUrl, data.editUrl, presentation.editorUrl, presentation.editUrl),
    playerUrl: firstString(raw.playerUrl, raw.viewUrl, data.playerUrl, data.viewUrl, presentation.playerUrl, presentation.viewUrl),
    raw,
  };
}

export async function exportBeautifulPresentation(presentationId: string, format: "pptx" | "pdf") {
  const raw = await beautifulRequest("exportPresentation", {
    presentationId,
    format,
    includeSkippedSlides: false,
    ...(format === "pdf" ? { pdfCompressionType: "MEDIUM" } : {}),
  });

  const data = extractObject(raw.data);
  const result = extractObject(raw.result);
  const url = firstString(
    raw.downloadUrl,
    raw.signedUrl,
    raw.url,
    raw.exportUrl,
    data.downloadUrl,
    data.signedUrl,
    data.url,
    data.exportUrl,
    result.downloadUrl,
    result.signedUrl,
    result.url,
    result.exportUrl,
  );

  return { url, raw };
}

export function beautifulAiConfigured() {
  return Boolean(apiKey());
}
