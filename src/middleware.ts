import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";
const PUBLIC_PATHS = ["/landing", "/login", "/api/auth/login", "/api/auth/logout"];
const PRIVATE_API_PREFIXES = ["/api/dashboard", "/api/products", "/api/matches", "/api/scrape"];

type SessionState = {
  authenticated: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
};

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPrivateApi(pathname: string) {
  return PRIVATE_API_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function authConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    apiKey: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

async function sessionState(request: NextRequest): Promise<SessionState> {
  const accessToken = request.cookies.get("mgp_access_token")?.value;
  const refreshToken = request.cookies.get("mgp_refresh_token")?.value;
  const { supabaseUrl, apiKey } = authConfig();

  if (accessToken) {
    try {
      const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: apiKey, authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (userResponse.ok) return { authenticated: true };
    } catch {
      // Continue to refresh-token flow.
    }
  }

  if (!refreshToken) return { authenticated: false };

  try {
    const refreshResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
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
    return { authenticated: false };
  }
}

function applySessionCookies(response: NextResponse, session: SessionState) {
  if (!session.accessToken) return response;
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
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.match(/\.(?:png|jpg|jpeg|svg|webp|ico)$/)) {
    return NextResponse.next();
  }

  const session = await sessionState(request);

  if (pathname === "/") {
    if (session.authenticated) return applySessionCookies(NextResponse.next(), session);
    const landingUrl = request.nextUrl.clone();
    landingUrl.pathname = "/landing";
    return NextResponse.rewrite(landingUrl);
  }

  if (pathname === "/login" && session.authenticated) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/";
    return applySessionCookies(NextResponse.redirect(dashboardUrl), session);
  }

  if (isPrivateApi(pathname) && !session.authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!isPublic(pathname) && pathname.startsWith("/dashboard") && !session.authenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return applySessionCookies(NextResponse.next(), session);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
