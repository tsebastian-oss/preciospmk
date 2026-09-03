import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";
import { clickHouseConfigured, clickHousePing } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEALTH_TIMEOUT_MS = 8_000;

type DatabaseHealth = {
  status: string;
  databaseTime: string;
  database: string;
  dispatcherActive: boolean;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Supabase health check timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

export async function GET() {
  const startedAt = Date.now();

  try {
    const database = await withTimeout(
      supabaseRest<DatabaseHealth>("rpc/production_health", {
        method: "POST",
        body: {},
      }),
      HEALTH_TIMEOUT_MS,
    );

    let clickhouse: { configured: boolean; reachable: boolean; database: string | null } = {
      configured: clickHouseConfigured(),
      reachable: false,
      database: null,
    };
    if (clickhouse.configured) {
      try {
        const ping = await withTimeout(clickHousePing(), 4_000);
        clickhouse = {
          configured: true,
          reachable: ping?.ok === 1,
          database: ping?.database_name ?? null,
        };
      } catch {
        clickhouse = { configured: true, reachable: false, database: null };
      }
    }

    const healthy = database.status === "ok" && database.dispatcherActive === true;

    return response({
      status: healthy ? "ok" : "degraded",
      application: "mgp-super-precios",
      vercel: {
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      },
      supabase: database,
      clickhouse,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    }, healthy ? 200 : 503);
  } catch (error) {
    return response({
      status: "error",
      application: "mgp-super-precios",
      vercel: {
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      },
      supabase: {
        status: "unreachable",
        error: error instanceof Error ? error.message : String(error),
      },
      clickhouse: {
        configured: clickHouseConfigured(),
        reachable: false,
        database: null,
      },
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    }, 503);
  }
}
