import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("mgp_access_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  response.cookies.set("mgp_refresh_token", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
