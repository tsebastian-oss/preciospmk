import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { victorinoxMarketIntelligence } from "@/lib/victorinox-market";
import { mergeVictorinoxOfficialMarket } from "@/lib/victorinox-real-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }
  const light = await enterpriseRpc<Record<string, unknown>>(request, "brands_vertical_light_payload", { p_slug: "victorinox" });
  if (light.response || !light.data) return light.response ?? NextResponse.json({error:"No fue posible cargar el catálogo oficial."},{status:503});
  let base: Record<string, unknown> = { listings: [] };
  try { base = await victorinoxMarketIntelligence(authorization.access); }
  catch (error) { console.error("victorinox-competition-market", error); }
  return NextResponse.json({ ...mergeVictorinoxOfficialMarket(base, light.data), vertical: light.data }, {
    headers: { "cache-control": "private, no-store, max-age=0", "x-data-mode": "real" },
  });
}
