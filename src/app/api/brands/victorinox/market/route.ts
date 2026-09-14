import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { victorinoxDemoMarket } from "@/lib/victorinox-demo-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }
  let vertical: Record<string, unknown> | null = null;
  try {
    const light = await enterpriseRpc<Record<string, unknown>>(request, "brands_vertical_light_payload", { p_slug: "victorinox" });
    vertical = light.response ? null : light.data ?? null;
  } catch (error) { console.warn("victorinox-light-payload", error); }
  return NextResponse.json({ ...victorinoxDemoMarket(), vertical, presentationMode: true }, {
    headers: { "cache-control": "private, no-store, max-age=0", "x-demo-fallback": "victorinox-presentation" },
  });
}
