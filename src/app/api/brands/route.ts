import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import { supabaseRest } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QSR_BRANDS = new Set(["krispy-kreme", "little-caesars"]);

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });

  const slug = request.nextUrl.searchParams.get("brand")?.trim().toLowerCase() || "krispy-kreme";
  try {
    const payload = await supabaseRest<Record<string, unknown>>("rpc/brands_vertical_payload_base", {
      method: "POST",
      body: { p_slug: slug },
    });
    if (!payload || !payload.brand) return NextResponse.json({ error: "Marca no encontrada." }, { status: 404 });

    let live: Record<string, unknown> | null = null;
    if (QSR_BRANDS.has(slug)) {
      try {
        live = await supabaseRest<Record<string, unknown>>("rpc/brands_qsr_competitive_snapshot", {
          method: "POST",
          body: { p_slug: slug },
        });
      } catch (snapshotError) {
        console.error("brands-qsr-snapshot", snapshotError);
      }
    }

    return NextResponse.json(
      { ...payload, live },
      { headers: { "cache-control": "private, max-age=15, stale-while-revalidate=60" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar Brands." }, { status: 503 });
  }
}
