import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stringSetting(settings: Record<string, unknown> | null, key: string) {
  const value = settings?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clientBrandCookie(response: NextResponse, brandSlug: string | null) {
  const secure = process.env.NODE_ENV === "production";
  if (brandSlug) {
    response.cookies.set("mgp_client_brand", brandSlug, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    response.cookies.set("mgp_client_brand", "", {
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

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, null);
  if (authorization.response) return authorization.response;
  if (!authorization.access) {
    return NextResponse.json({ error: "No fue posible resolver el acceso de tu cuenta." }, { status: 500 });
  }

  const access = authorization.access;
  const configuredBrand = stringSetting(access.settings, "client_panel_brand");
  const scopedBrand = access.brands[0] ?? null;
  const brandName = scopedBrand ?? configuredBrand;
  const brandSlug = brandName ? slugify(configuredBrand ?? brandName) : null;
  const clientBrandMode = !access.isSaasAdmin
    && access.organizationType === "brand"
    && Boolean(brandSlug);

  const landing = access.isSaasAdmin
    ? "/"
    : clientBrandMode
      ? "/panel"
      : access.industryConfigured
        ? "/"
        : "/onboarding";

  const response = NextResponse.json({
    isSaasAdmin: access.isSaasAdmin,
    organizationId: access.organizationId,
    organizationName: access.organizationName,
    organizationType: access.organizationType,
    role: access.role,
    brandName: clientBrandMode ? brandName : null,
    brandSlug: clientBrandMode ? brandSlug : null,
    clientBrandMode,
    landing,
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });

  return clientBrandCookie(response, clientBrandMode ? brandSlug : null);
}
