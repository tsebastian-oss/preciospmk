import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

const FALLBACK_TOKEN_SHA256 = "3baad96cf068bc2221726a3732e9012dd20e5474b6a8249a7bc62161427551c7";

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function internalTokenFrom(request: NextRequest) {
  return (
    request.headers.get("x-mgp-internal-token")
    || request.headers.get("x-chilexpress-worker-token")
    || ""
  ).trim();
}

export async function hasValidInternalToken(request: NextRequest) {
  const supplied = internalTokenFrom(request);
  if (!supplied) return false;

  const actual = await sha256Hex(supplied);
  const candidates = [FALLBACK_TOKEN_SHA256];
  const configured = (process.env.INTERNAL_WORKER_TOKEN ?? "").trim();
  if (configured) {
    if (/^[a-f0-9]{64}$/i.test(configured)) candidates.push(configured.toLowerCase());
    else candidates.push(await sha256Hex(configured));
  }

  return candidates.some((expected) => timingSafeEqual(actual, expected));
}

export async function denyUnlessInternal(request: NextRequest) {
  if (await hasValidInternalToken(request)) return null;

  const authorization = await enterpriseAccess(request, null);
  if (authorization.access?.isSaasAdmin) return null;
  if (authorization.response && authorization.response.status >= 500) return authorization.response;

  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
