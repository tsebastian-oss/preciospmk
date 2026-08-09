import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY;
  const accessToken = request.cookies.get("mgp_access_token")?.value;

  if (accessToken) {
    try {
      await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: apiKey, authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch {
      // Clear local auth state even if Supabase cannot be reached.
    }
  }

  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  const secure = process.env.NODE_ENV === "production";
  for (const name of ["mgp_access_token", "mgp_refresh_token", "mgp_organization_id"]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }
  return response;
}
