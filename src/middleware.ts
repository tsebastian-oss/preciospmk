import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/landing", "/login", "/api/auth/login", "/api/auth/logout"];
const PRIVATE_API_PREFIXES = ["/api/dashboard", "/api/products", "/api/matches", "/api/scrape"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isPrivateApi(pathname: string) {
  return PRIVATE_API_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

async function hasValidSession(request: NextRequest) {
  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return false;

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !apiKey) return false;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.match(/\.(?:png|jpg|jpeg|svg|webp|ico)$/)) {
    return NextResponse.next();
  }

  const authenticated = await hasValidSession(request);

  if (pathname === "/") {
    if (authenticated) return NextResponse.next();
    const landingUrl = request.nextUrl.clone();
    landingUrl.pathname = "/landing";
    return NextResponse.rewrite(landingUrl);
  }

  if (pathname === "/login" && authenticated) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/";
    return NextResponse.redirect(dashboardUrl);
  }

  if (isPrivateApi(pathname) && !authenticated) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (!isPublic(pathname) && pathname.startsWith("/dashboard") && !authenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
