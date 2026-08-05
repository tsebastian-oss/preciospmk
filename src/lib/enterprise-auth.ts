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

function accessToken(request: NextRequest) {
  return request.cookies.get("mgp_access_token")?.value ?? null;
}

function safeError(status: number, raw: string) {
  if (status === 401) return "Tu sesión expiró. Ingresa nuevamente.";
  if (status === 403) return "No tienes permisos para realizar esta acción.";
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string; hint?: string };
    const message = parsed.message || parsed.error;
    if (message === "forbidden") return "No tienes permisos para realizar esta acción.";
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

export function enterpriseJson<T>(result: RpcResult<T>, fallback: T | null = null) {
  if (result.response) return result.response;
  return NextResponse.json(result.data ?? fallback);
}
