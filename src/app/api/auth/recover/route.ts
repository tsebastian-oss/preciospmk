import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function config() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

function validEmail(value: string) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  let email = "";
  try {
    const body = await request.json() as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  if (!validEmail(email)) {
    return NextResponse.json({ error: "Ingresa un correo electrónico válido." }, { status: 400 });
  }

  const { url, key } = config();
  const configuredSite = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  const siteOrigin = configuredSite || request.nextUrl.origin;
  const redirectTo = `${siteOrigin}/auth/recovery`;

  try {
    await fetch(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: {
        apikey: key,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
  } catch {
    // Keep a generic response so this endpoint never reveals whether an account exists.
  }

  return NextResponse.json({
    ok: true,
    message: "Si existe una cuenta asociada a ese correo, recibirás instrucciones para restablecer tu contraseña.",
  });
}
