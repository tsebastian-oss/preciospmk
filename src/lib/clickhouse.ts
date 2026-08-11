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

export async function clickHouseQuery<T>(
  sql: string,
  params: ClickHouseParams = {},
  timeoutMs = 7_000,
): Promise<T[]> {
  if (!configured()) throw new Error("ClickHouse is not configured");

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
      throw new Error(`ClickHouse query failed (${response.status})`);
    }

    const body = text.trim();
    if (!body) return [];
    return body
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } finally {
    clearTimeout(timeout);
  }
}

export async function clickHousePing() {
  const result = await clickHouseQuery<{ ok: number; database_name: string }>(
    "SELECT 1 AS ok, currentDatabase() AS database_name",
    {},
    3_000,
  );
  return result[0] ?? null;
}
