import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

const USERNAME_EMAIL_MAP: Record<string, string> = {
  mazokin13: "mazokin13@mgp-retail.internal",
  bodegasdonluis: "m.echave@bodegasdonluis.pe",
  piwen2026: "piwen@mgp-retail.internal",
  victorinox2026: "victorinox@mgp-retail.internal",
};

type SupabaseLoginPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
};

function temporaryAccessError() {
  return NextResponse.json(
    { error: "El servicio de acceso está temporalmente no disponible. Intenta nuevamente en unos segundos." },
    { status: 503 }
  );
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY;

  let identifier = "";
  let password = "";
  try {
    const body = await request.json() as { email?: string; username?: string; password?: string };
    identifier = (body.username ?? body.email ?? "").trim().toLowerCase();
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  if (!identifier || !password) {
    return NextResponse.json({ error: "Debes ingresar usuario y contraseña" }, { status: 400 });
  }

  const email = USERNAME_EMAIL_MAP[identifier] ?? identifier;

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return temporaryAccessError();
  }

  const raw = await response.text();
  let payload: SupabaseLoginPayload = {};

  if (raw) {
    try {
      payload = JSON.parse(raw) as SupabaseLoginPayload;
    } catch {
      if (response.ok) return temporaryAccessError();
    }
  } else if (response.ok) {
    return temporaryAccessError();
  }

  if (!response.ok || !payload.access_token) {
    if (response.status >= 500) return temporaryAccessError();
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  }

  const result = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  result.cookies.set("mgp_access_token", payload.access_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, payload.expires_in ?? 3600),
  });

  if (payload.refresh_token) {
    result.cookies.set("mgp_refresh_token", payload.refresh_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return result;
}
