import { NextRequest } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return enterpriseJson(await enterpriseRpc(request, "enterprise_context"));
}
