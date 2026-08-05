import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

type RpcResult<T> = { data?: T; response?: NextResponse };
type RestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
  prefer?: string;
};

type ContextOrganization = {
  id: string;
  status: string;
  role: string;
};
type EnterpriseContext = {
  user?: { lastOrganizationId?: string | null };
  organizations?: ContextOrganization[];
};

export type EnterpriseAccessContext = {
  organizationId: string;
  organizationName: string;
  organizationType: "platform" | "retailer" | "brand";
  status: string;
  plan: string;
  role: string;
  module: string | null;
  moduleAllowed: boolean;
  retailers: string[];
  brands: string[];
  competitors: string[];
  categories: string[];
  modules: string[];
  limits: Record<string, number>;
  settings: Record<string, unknown> | null;
  isSaasAdmin: boolean;
};

function accessToken(request: NextRequest) {
  return request.cookies.get("mgp_access_token")?.value ?? null;
}

function safeError(status: number, raw: string) {
  if (status === 401) return "Tu sesión expiró. Ingresa nuevamente.";
  if (status === 403) return "Tu organización no tiene acceso a esta función.";
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string; hint?: string };
    const message = parsed.message || parsed.error;
    if (message === "forbidden") return "No tienes permisos para realizar esta acción.";
    if (message === "module not enabled") return "Este módulo no está habilitado para tu organización.";
    if (message === "organization suspended") return "La organización está suspendida.";
    if (message) return message;
  } catch {
    // Return a generic message below.
  }
  return status >= 500 ? "No fue posible completar la operación enterprise." : "Solicitud inválida.";
}

export async function enterpriseRpc<T>(
  request: NextRequest,
  functionName: string,
  body: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const token = accessToken(request);
  if (!token) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    const status = response.status === 400 && text.includes("42501") ? 403 : response.status;
    return { response: NextResponse.json({ error: safeError(status, text) }, { status }) };
  }
  return { data: text ? JSON.parse(text) as T : undefined };
}

export async function enterpriseRest<T>(
  request: NextRequest,
  path: string,
  options: RestOptions = {},
): Promise<RpcResult<T>> {
  const token = accessToken(request);
  if (!token) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.prefer ? { prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    return { response: NextResponse.json({ error: safeError(response.status, text) }, { status: response.status }) };
  }
  return { data: text ? JSON.parse(text) as T : undefined };
}

export async function enterpriseAccess(
  request: NextRequest,
  moduleName: string | null,
): Promise<{ access?: EnterpriseAccessContext; response?: NextResponse }> {
  let organizationId = request.cookies.get("mgp_organization_id")?.value ?? "";

  if (!organizationId) {
    const contextResult = await enterpriseRpc<EnterpriseContext>(request, "enterprise_context");
    if (contextResult.response) return { response: contextResult.response };
    const organizations = contextResult.data?.organizations ?? [];
    organizationId = organizations.find((item) => item.id === contextResult.data?.user?.lastOrganizationId)?.id
      ?? organizations.find((item) => ["active", "trial"].includes(item.status))?.id
      ?? organizations[0]?.id
      ?? "";
  }

  if (!organizationId) {
    return { response: NextResponse.json({ error: "Tu usuario no pertenece a una organización activa." }, { status: 403 }) };
  }

  const accessResult = await enterpriseRpc<EnterpriseAccessContext>(request, "enterprise_access_context", {
    p_organization_id: organizationId,
    p_module: moduleName,
  });
  if (accessResult.response) return { response: accessResult.response };
  if (!accessResult.data) {
    return { response: NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 }) };
  }
  return { access: accessResult.data };
}

export function scopeAllows(access: EnterpriseAccessContext, dimension: "retailers" | "brands" | "categories", value: string | null | undefined) {
  if (access.isSaasAdmin || !value) return true;
  const allowed = access[dimension] ?? [];
  return allowed.length === 0 || allowed.some((item) => item.localeCompare(value, "es", { sensitivity: "base" }) === 0);
}

export function enterpriseJson<T>(result: RpcResult<T>, fallback: T | null = null) {
  if (result.response) return result.response;
  return NextResponse.json(result.data ?? fallback);
}
