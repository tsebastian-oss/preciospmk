import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function config() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

function validPassword(value: string) {
  if (value.length < 10 || value.length > 128) return false;
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  return classes >= 3;
}

export async function POST(request: NextRequest) {
  const recovery = request.cookies.get("mgp_password_recovery")?.value;
  const accessToken = request.cookies.get("mgp_access_token")?.value;
  if (recovery !== "1" || !accessToken) {
    return NextResponse.json({ error: "La sesión de recuperación expiró. Solicita un nuevo enlace." }, { status: 401 });
  }

  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  if (!validPassword(password)) {
    return NextResponse.json({ error: "Usa al menos 10 caracteres y combina mayúsculas, minúsculas, números o símbolos." }, { status: 400 });
  }

  const { url, key } = config();
  const update = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
    cache: "no-store",
  });

  if (!update.ok) {
    const raw = await update.text();
    const expired = update.status === 401 || raw.toLowerCase().includes("jwt");
    return NextResponse.json({
      error: expired ? "La sesión de recuperación expiró. Solicita un nuevo enlace." : "No fue posible actualizar la contraseña. Intenta nuevamente.",
    }, { status: expired ? 401 : 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("mgp_password_recovery", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
