import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";
const PRODUCTION_ORIGIN = "https://preciospmk.vercel.app";

function text(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function authError(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { msg?: string; message?: string; error_description?: string; error_code?: string };
    const message = parsed.msg || parsed.message || parsed.error_description || "";
    if (/already registered|already exists/i.test(message)) return "Ya existe una cuenta asociada a ese correo. Ingresa con tus credenciales.";
    if (/password/i.test(message) && /weak|short|least/i.test(message)) return "La contraseña no cumple los requisitos mínimos de seguridad.";
    if (/rate limit|too many/i.test(message)) return "Hiciste varios intentos seguidos. Espera un momento e inténtalo nuevamente.";
    if (message) return message;
  } catch {
    // Return the safe fallback below.
  }
  return "No fue posible crear la cuenta. Intenta nuevamente.";
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  // Honeypot and minimum-form-time checks reduce low-effort automated signups.
  if (text(body.website, 120)) return NextResponse.json({ ok: true, requiresEmailConfirmation: true });
  const startedAt = Number(body.startedAt ?? 0);
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 1500) {
    return NextResponse.json({ ok: true, requiresEmailConfirmation: true });
  }

  const displayName = text(body.displayName, 120);
  const email = text(body.email, 180).toLowerCase();
  const phone = text(body.phone, 40);
  const company = text(body.company, 160);
  const jobTitle = text(body.jobTitle, 120);
  const industrySlug = text(body.industrySlug, 80);
  const password = typeof body.password === "string" ? body.password : "";
  const acceptedTerms = body.acceptedTerms === true;

  if (displayName.length < 2) return NextResponse.json({ error: "Ingresa tu nombre y apellido." }, { status: 400 });
  if (!validEmail(email)) return NextResponse.json({ error: "Ingresa un correo electrónico válido." }, { status: 400 });
  if (company.length < 2) return NextResponse.json({ error: "Ingresa el nombre de tu empresa." }, { status: 400 });
  if (password.length < 8 || password.length > 128) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return NextResponse.json({ error: "Usa una contraseña con letras y números." }, { status: 400 });
  if (!acceptedTerms) return NextResponse.json({ error: "Debes aceptar los términos de uso y la política de privacidad." }, { status: 400 });

  const origin = request.nextUrl.hostname === "localhost" ? request.nextUrl.origin : PRODUCTION_ORIGIN;
  const redirectTo = `${origin}/login?confirmed=1`;

  const response = await fetch(`${supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      data: {
        registration_source: "marketing_site",
        display_name: displayName,
        phone: phone || null,
        company,
        job_title: jobTitle || null,
        industry_slug: industrySlug || null,
      },
    }),
    cache: "no-store",
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json({ error: authError(raw) }, { status: response.status >= 500 ? 500 : 400 });
  }

  const payload = raw ? JSON.parse(raw) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    session?: { access_token?: string; refresh_token?: string; expires_in?: number } | null;
    user?: { id?: string; email_confirmed_at?: string | null } | null;
  } : {};

  const accessToken = payload.access_token ?? payload.session?.access_token;
  const refreshToken = payload.refresh_token ?? payload.session?.refresh_token;
  const expiresIn = payload.expires_in ?? payload.session?.expires_in ?? 3600;
  const requiresEmailConfirmation = !accessToken;

  const result = NextResponse.json({
    ok: true,
    requiresEmailConfirmation,
    next: requiresEmailConfirmation ? "/login?registered=1" : "/onboarding",
  }, { status: 201 });

  if (accessToken) {
    const secure = process.env.NODE_ENV === "production";
    result.cookies.set("mgp_access_token", accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(60, expiresIn),
    });
    if (refreshToken) {
      result.cookies.set("mgp_refresh_token", refreshToken, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
  }

  return result;
}
