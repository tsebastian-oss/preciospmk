import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function config() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

function sessionResponse(accessToken: string, refreshToken: string, expiresIn: number) {
  const secure = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ ok: true, next: "/onboarding" });
  response.cookies.set("mgp_access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, Math.min(expiresIn, 86_400)),
  });
  response.cookies.set("mgp_refresh_token", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function POST(request: NextRequest) {
  let accessToken = "";
  let refreshToken = "";
  let expiresIn = 3600;
  let tokenHash = "";
  let type = "email";

  try {
    const body = await request.json() as {
      accessToken?: unknown;
      refreshToken?: unknown;
      expiresIn?: unknown;
      tokenHash?: unknown;
      type?: unknown;
    };
    accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
    refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
    expiresIn = typeof body.expiresIn === "number" && Number.isFinite(body.expiresIn) ? body.expiresIn : 3600;
    tokenHash = typeof body.tokenHash === "string" ? body.tokenHash.trim() : "";
    type = typeof body.type === "string" ? body.type.trim().toLowerCase() : "email";
  } catch {
    return NextResponse.json({ error: "Enlace de confirmación inválido." }, { status: 400 });
  }

  const { url, key } = config();

  if (tokenHash) {
    if (tokenHash.length > 500 || !["email", "signup", "invite", "magiclink"].includes(type)) {
      return NextResponse.json({ error: "Enlace de confirmación inválido." }, { status: 400 });
    }
    const verification = await fetch(`${url}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ token_hash: tokenHash, type }),
      cache: "no-store",
    });
    const raw = await verification.text();
    if (!verification.ok) {
      return NextResponse.json({ error: "El enlace expiró, ya fue utilizado o no es válido. Intenta iniciar sesión o solicita un nuevo registro." }, { status: 401 });
    }
    const payload = raw ? JSON.parse(raw) as { access_token?: string; refresh_token?: string; expires_in?: number } : {};
    accessToken = payload.access_token ?? "";
    refreshToken = payload.refresh_token ?? "";
    expiresIn = payload.expires_in ?? 3600;
  }

  if (!accessToken || !refreshToken || accessToken.length > 10_000 || refreshToken.length > 10_000) {
    return NextResponse.json({ error: "No encontramos una sesión válida en el enlace de confirmación." }, { status: 400 });
  }

  const validation = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!validation.ok) {
    return NextResponse.json({ error: "La confirmación no pudo validarse. Intenta iniciar sesión con tu correo y contraseña." }, { status: 401 });
  }

  return sessionResponse(accessToken, refreshToken, expiresIn);
}
