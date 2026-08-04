import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !apiKey) {
    return NextResponse.json({ error: "La autenticación no está configurada" }, { status: 500 });
  }

  let email = "";
  let password = "";
  try {
    const body = await request.json() as { email?: string; password?: string };
    email = body.email?.trim().toLowerCase() ?? "";
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Debes ingresar correo y contraseña" }, { status: 400 });
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    msg?: string;
  };

  if (!response.ok || !payload.access_token) {
    return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
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
