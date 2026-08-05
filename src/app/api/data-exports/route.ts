import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

type ExportJob = {
  id: string;
  report_type: string;
  format: "xlsx" | "csv";
  status: string;
  parameters: Record<string, unknown>;
  result_url: string | null;
  result_metadata: Record<string, unknown> | null;
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
};

type Availability = {
  firstDate: string | null;
  lastDate: string | null;
  observations: number;
  products: number;
  industrySlug?: string | null;
  retailers: Array<{ supermarket: string; observations: number }>;
};

function noStore<T>(payload: T, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
      expires: "0",
      ...(init?.headers ?? {}),
    },
  });
}

function chileDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseDate(value: unknown) {
  return typeof value === "string" && DATE_PATTERN.test(value) ? value : null;
}

function daysBetween(start: string, end: string) {
  const startTime = new Date(`${start}T12:00:00Z`).getTime();
  const endTime = new Date(`${end}T12:00:00Z`).getTime();
  return Math.floor((endTime - startTime) / 86_400_000) + 1;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.access?.organizationId;
  if (!organizationId) return noStore({ error: "No fue posible resolver la organización." }, { status: 403 });

  const jobsResult = await enterpriseRest<ExportJob[]>(request, "report_jobs", {
    query: {
      select: "id,report_type,format,status,parameters,result_url,result_metadata,error_message,requested_at,completed_at",
      organization_id: `eq.${organizationId}`,
      report_type: "eq.pricing",
      order: "requested_at.desc",
      limit: "20",
    },
  });
  if (jobsResult.response) return jobsResult.response;

  const availabilityResult = await enterpriseRpc<Availability>(request, "enterprise_export_availability", {
    p_organization_id: organizationId,
  });
  if (availabilityResult.response) return availabilityResult.response;

  const exports = (jobsResult.data ?? []).filter((job) => job.parameters?.dataset === "historical_prices");
  return noStore({
    exports,
    availability: availabilityResult.data ?? null,
    industrySlug: authorization.access?.industrySlug ?? null,
    industryName: authorization.access?.industryName ?? null,
  });
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.access?.organizationId;
  if (!organizationId) return noStore({ error: "No fue posible resolver la organización." }, { status: 403 });
  if (!authorization.access?.industryConfigured) {
    return noStore({ error: "Selecciona primero la industria de tu organización." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({})) as {
    startDate?: unknown;
    endDate?: unknown;
    supermarket?: unknown;
    format?: unknown;
  };
  const startDate = parseDate(body.startDate);
  const endDate = parseDate(body.endDate);
  const format = body.format === "csv" ? "csv" : body.format === "xlsx" ? "xlsx" : null;
  const supermarket = typeof body.supermarket === "string" && body.supermarket.trim() ? body.supermarket.trim() : null;

  if (!startDate || !endDate || !format) {
    return noStore({ error: "Selecciona un período y un formato válido." }, { status: 400 });
  }
  if (startDate > endDate) {
    return noStore({ error: "La fecha inicial no puede ser posterior a la fecha final." }, { status: 400 });
  }
  if (endDate > chileDate()) {
    return noStore({ error: "La fecha final no puede estar en el futuro." }, { status: 400 });
  }
  const rangeDays = daysBetween(startDate, endDate);
  if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) {
    return noStore({ error: `El período máximo permitido es de ${MAX_RANGE_DAYS} días.` }, { status: 400 });
  }
  if (supermarket && authorization.access?.retailers?.length) {
    const allowed = authorization.access.retailers.some((item) => item.localeCompare(supermarket, "es", { sensitivity: "base" }) === 0);
    if (!allowed) return noStore({ error: "La cadena seleccionada no está autorizada para tu organización." }, { status: 403 });
  }

  const jobResult = await enterpriseRpc<ExportJob>(request, "enterprise_request_report", {
    p_organization_id: organizationId,
    p_report_type: "pricing",
    p_format: format,
    p_parameters: {
      dataset: "historical_prices",
      startDate,
      endDate,
      supermarket,
      industrySlug: authorization.access.industrySlug,
      industryName: authorization.access.industryName,
      requestedRangeDays: rangeDays,
    },
  });
  if (jobResult.response) return jobResult.response;
  const job = jobResult.data;
  if (!job?.id) return noStore({ error: "No fue posible crear la exportación." }, { status: 500 });

  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return noStore({ error: "Tu sesión expiró. Ingresa nuevamente." }, { status: 401 });

  const workerResponse = await fetch(`${SUPABASE_URL}/functions/v1/enterprise-data-export-worker`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobId: job.id }),
    cache: "no-store",
  });
  const workerText = await workerResponse.text();
  let workerPayload: { job?: ExportJob; error?: string; detail?: string } = {};
  try {
    workerPayload = workerText ? JSON.parse(workerText) as typeof workerPayload : {};
  } catch {
    workerPayload = { error: "La exportación no respondió correctamente." };
  }
  if (!workerResponse.ok || !workerPayload.job) {
    return noStore({
      error: workerPayload.detail || workerPayload.error || "No fue posible generar el archivo.",
      jobId: job.id,
    }, { status: workerResponse.status >= 400 ? workerResponse.status : 500 });
  }

  return noStore({ job: workerPayload.job });
}
