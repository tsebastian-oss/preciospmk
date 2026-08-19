import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { getLiveCompetitivePulse } from "@/lib/brands-live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });

  const slug = request.nextUrl.searchParams.get("brand")?.trim().toLowerCase() || "krispy-kreme";
  try {
    const live = await getLiveCompetitivePulse(slug);
    return NextResponse.json({ live }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("brands-live", error);
    return NextResponse.json({ live: null, error: "La señal competitiva en vivo no respondió en esta lectura." }, { status: 200 });
  }
}
