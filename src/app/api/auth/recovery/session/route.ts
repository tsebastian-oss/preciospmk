import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function config() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

export async function POST(request: NextRequest) {
  let accessToken = "";
  let refreshToken = "";
  let expiresIn = 3600;

  try {
    const body = await request.json() as { accessToken?: unknown; refreshToken?: unknown; expiresIn?: unknown };
    accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
    refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
    expiresIn = typeof body.expiresIn === "number" && Number.isFinite(body.expiresIn) ? Math.max(60, Math.min(body.expiresIn, 86_400)) : 3600;
  } catch {
    return NextResponse.json({ error: "Enlace de recuperación inválido." }, { status: 400 });
  }

  if (!accessToken || !refreshToken || accessToken.length > 10_000 || refreshToken.length > 10_000) {
    return NextResponse.json({ error: "Enlace de recuperación inválido o incompleto." }, { status: 400 });
  }

  const { url, key } = config();
  const validation = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!validation.ok) {
    return NextResponse.json({ error: "El enlace expiró o ya no es válido. Solicita uno nuevo." }, { status: 401 });
  }

  const secure = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ ok: true });
  response.cookies.set("mgp_access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn,
  });
  response.cookies.set("mgp_refresh_token", refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set("mgp_password_recovery", "1", {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 15 * 60,
  });
  return response;
}
