type ClickHouseParam = {
  type: "String" | "UInt8" | "UInt16" | "UInt32" | "Int32" | "Float64";
  value: string | number | boolean;
};

export type ClickHouseParams = Record<string, ClickHouseParam>;

const CLICKHOUSE_URL = (process.env.CLICKHOUSE_URL ?? "").trim().replace(/\/+$/, "");
const CLICKHOUSE_USER = (process.env.CLICKHOUSE_USER ?? "").trim();
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? "";
const CLICKHOUSE_DATABASE = (process.env.CLICKHOUSE_DATABASE ?? "pricing_analytics").trim();
const CLICKHOUSE_ENABLED = (process.env.CLICKHOUSE_ENABLED ?? "").trim().toLowerCase() === "true";
const CLICKHOUSE_MAX_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.CLICKHOUSE_MAX_CONCURRENCY ?? 2) || 2),
);
const CLICKHOUSE_CACHE_TTL_MS = Math.max(
  0,
  Math.min(60_000, Number(process.env.CLICKHOUSE_CACHE_TTL_MS ?? 12_000) || 12_000),
);
const CLICKHOUSE_CACHE_MAX_ENTRIES = 24;

class ClickHouseHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`ClickHouse query failed (${status})`);
    this.name = "ClickHouseHttpError";
    this.status = status;
  }
}

type CacheEntry = {
  expiresAt: number;
  value: unknown[];
};

const resultCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown[]>>();
let activeQueries = 0;
const waiters: Array<() => void> = [];

function configured() {
  return CLICKHOUSE_ENABLED
    && CLICKHOUSE_URL.startsWith("https://")
    && CLICKHOUSE_USER.length > 0
    && CLICKHOUSE_PASSWORD.length > 0
    && CLICKHOUSE_DATABASE.length > 0;
}

export function clickHouseConfigured() {
  return configured();
}

function queryUrl(params: ClickHouseParams) {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set("database", CLICKHOUSE_DATABASE);
  url.searchParams.set("default_format", "JSONEachRow");
  url.searchParams.set("wait_end_of_query", "1");

  for (const [name, param] of Object.entries(params)) {
    url.searchParams.set(`param_${name}`, String(param.value));
  }
  return url;
}

function queryKey(sql: string, params: ClickHouseParams) {
  const normalizedParams = Object.keys(params)
    .sort()
    .map((key) => [key, params[key].type, params[key].value]);
  return `${sql.trim()}::${JSON.stringify(normalizedParams)}`;
}

async function acquireQuerySlot() {
  if (activeQueries < CLICKHOUSE_MAX_CONCURRENCY) {
    activeQueries += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeQueries += 1;
}

function releaseQuerySlot() {
  activeQueries = Math.max(0, activeQueries - 1);
  waiters.shift()?.();
}

function transient(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof ClickHouseHttpError) {
    return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
  }
  return false;
}

function pruneCache(now = Date.now()) {
  for (const [key, entry] of resultCache) {
    if (entry.expiresAt <= now) resultCache.delete(key);
  }
  while (resultCache.size > CLICKHOUSE_CACHE_MAX_ENTRIES) {
    const first = resultCache.keys().next().value as string | undefined;
    if (!first) break;
    resultCache.delete(first);
  }
}

async function executeQueryAttempt<T>(
  sql: string,
  params: ClickHouseParams,
  timeoutMs: number,
): Promise<T[]> {
  await acquireQuerySlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(queryUrl(params), {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-clickhouse-user": CLICKHOUSE_USER,
        "x-clickhouse-key": CLICKHOUSE_PASSWORD,
      },
      body: sql.trim(),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    const embeddedException = text.includes("__exception__");
    if (!response.ok || embeddedException) {
      throw new ClickHouseHttpError(response.status);
    }

    const body = text.trim();
    if (!body) return [];
    return body
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } finally {
    clearTimeout(timeout);
    releaseQuerySlot();
  }
}

async function executeWithRetry<T>(
  sql: string,
  params: ClickHouseParams,
  timeoutMs: number,
): Promise<T[]> {
  try {
    return await executeQueryAttempt<T>(sql, params, timeoutMs);
  } catch (error) {
    if (!transient(error)) throw error;

    const retryTimeoutMs = Math.max(25_000, timeoutMs * 2);
    console.warn("ClickHouse transient failure; retrying with backoff", {
      timeoutMs,
      retryTimeoutMs,
      status: error instanceof ClickHouseHttpError ? error.status : undefined,
      kind: error instanceof Error ? error.name : "unknown",
    });

    await new Promise((resolve) => setTimeout(resolve, 650));
    return executeQueryAttempt<T>(sql, params, retryTimeoutMs);
  }
}

export async function clickHouseQuery<T>(
  sql: string,
  params: ClickHouseParams = {},
  timeoutMs = 7_000,
): Promise<T[]> {
  if (!configured()) throw new Error("ClickHouse is not configured");

  const key = queryKey(sql, params);
  const now = Date.now();
  pruneCache(now);

  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T[];
  }

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T[]>;

  const promise = executeWithRetry<T>(sql, params, timeoutMs)
    .then((rows) => {
      if (CLICKHOUSE_CACHE_TTL_MS > 0) {
        resultCache.set(key, {
          expiresAt: Date.now() + CLICKHOUSE_CACHE_TTL_MS,
          value: rows,
        });
        pruneCache();
      }
      return rows;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise as Promise<unknown[]>);
  return promise;
}

export async function clickHousePing() {
  const result = await clickHouseQuery<{ ok: number; database_name: string }>(
    "SELECT 1 AS ok, currentDatabase() AS database_name",
    {},
    4_000,
  );
  return result[0] ?? null;
}
