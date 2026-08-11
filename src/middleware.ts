import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";
const REFRESH_TIMEOUT_MS = 1500;
const PRIVATE_API_PREFIXES = [
  "/api/dashboard",
  "/api/products",
  "/api/matches",
  "/api/scrape",
  "/api/competitive-analysis",
  "/api/brand-intelligence",
  "/api/brand-chat",
  "/api/price-map-ai",
  "/api/data-exports",
  "/api/alerts",
  "/api/price-movements",
  "/api/admin",
  "/api/enterprise",
];
const PRIVATE_PAGE_PREFIXES = [
  "/dashboard",
  "/competitive-analysis",
  "/admin",
  "/enterprise",
  "/onboarding",
  "/cuenta",
  "/trial-expired",
  "/reset-password",
];

type SessionState = {
  authenticated: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
};

function isPrivateApi(pathname: string) {
  return PRIVATE_API_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPrivatePage(pathname: string) {
  return PRIVATE_PAGE_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function authConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    apiKey: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

async function refreshSession(refreshToken: string): Promise<SessionState> {
  const { supabaseUrl, apiKey } = authConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

  try {
    const refreshResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!refreshResponse.ok) return { authenticated: false };
    const payload = await refreshResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) return { authenticated: false };
    return {
      authenticated: true,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresIn: payload.expires_in,
    };
  } catch {
    // Middleware must never wait on an unhealthy upstream until Vercel's hard timeout.
    return { authenticated: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function sessionState(request: NextRequest): Promise<SessionState> {
  const accessToken = request.cookies.get("mgp_access_token")?.value;
  const refreshToken = request.cookies.get("mgp_refresh_token")?.value;

  // Middleware is only a fast routing/session-presence guard. Real authorization
  // is enforced again inside protected API routes (for example enterpriseAccess).
  // Avoid a remote /auth/v1/user call on every page and API request: that call made
  // the whole application dependent on Supabase latency before Vercel could route.
  if (accessToken) return { authenticated: true };
  if (!refreshToken) return { authenticated: false };

  // Network is used only on the infrequent token-refresh path, with a strict cap.
  return refreshSession(refreshToken);
}

function applyHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

function applySessionCookies(response: NextResponse, session: SessionState) {
  if (session.accessToken) {
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("mgp_access_token", session.accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(60, session.expiresIn ?? 3600),
    });
    if (session.refreshToken) {
      response.cookies.set("mgp_refresh_token", session.refreshToken, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
  }
  return applyHeaders(response);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.match(/\.(?:png|jpg|jpeg|svg|webp|ico)$/)) {
    return applyHeaders(NextResponse.next());
  }

  const session = await sessionState(request);

  if (pathname === "/") {
    if (session.authenticated) return applySessionCookies(NextResponse.next(), session);
    const landingUrl = request.nextUrl.clone();
    landingUrl.pathname = "/landing";
    return applyHeaders(NextResponse.rewrite(landingUrl));
  }

  if (pathname === "/login" && session.authenticated) {
    const onboardingUrl = request.nextUrl.clone();
    onboardingUrl.pathname = "/onboarding";
    return applySessionCookies(NextResponse.redirect(onboardingUrl), session);
  }

  if (isPrivateApi(pathname) && !session.authenticated) {
    return applyHeaders(NextResponse.json({ error: "No autorizado" }, { status: 401 }));
  }

  if (isPrivatePage(pathname) && !session.authenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = pathname === "/reset-password" ? "/forgot-password" : "/login";
    return applyHeaders(NextResponse.redirect(loginUrl));
  }

  return applySessionCookies(NextResponse.next(), session);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
