import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, type EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { clickHouseConfigured, clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CLICKHOUSE_URL = (process.env.CLICKHOUSE_URL ?? "").trim().replace(/\/+$/, "");
const CLICKHOUSE_USER = (process.env.CLICKHOUSE_USER ?? "").trim();
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? "";
const CLICKHOUSE_DATABASE = (process.env.CLICKHOUSE_DATABASE ?? "pricing_analytics").trim();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

type ScopedAccess = EnterpriseAccessContext & {
  industryConfigured?: boolean;
  industrySlug?: string | null;
};

type MetaRow = {
  first_date: string | null;
  last_date: string | null;
  observations: number | string;
  products: number | string;
};
type OptionRow = { dimension: "retailer" | "category" | "brand"; value: string; observations: number | string };

function addString(params: ClickHouseParams, name: string, value: string) {
  params[name] = { type: "String", value };
  return `{${name}:String}`;
}

function addStringList(predicates: string[], params: ClickHouseParams, column: string, values: string[], prefix: string) {
  const unique = [...new Set(values.map((item) => item.trim()).filter(Boolean))].slice(0, 100);
  if (!unique.length) return;
  const placeholders = unique.map((value, index) => addString(params, `${prefix}_${index}`, value));
  predicates.push(`${column} IN (${placeholders.join(", ")})`);
}

function smartCategory(alias = "p") {
  return `coalesce(nullIf(trimBoth(${alias}.smart_category), ''), nullIf(trimBoth(${alias}.category), ''))`;
}

function scopePredicates(access: ScopedAccess, params: ClickHouseParams) {
  const predicates = ["p.retailer_type IN ('supermarket', 'department_store', 'pharmacy', 'home_improvement')"];
  addStringList(predicates, params, "p.supermarket", access.retailers ?? [], "scope_retailer");
  addStringList(predicates, params, "p.brand", access.brands ?? [], "scope_brand");
  addStringList(predicates, params, smartCategory(), access.categories ?? [], "scope_category");
  if (access.industryConfigured && access.industrySlug && access.industrySlug !== "all") {
    if (access.industrySlug === "grocery") predicates.push("p.retailer_type = 'supermarket'");
    else predicates.push(`p.industry_slug = ${addString(params, "scope_industry", access.industrySlug)}`);
  }
  return predicates;
}

function clean(value: string | null, max = 180) {
  return (value ?? "").trim().slice(0, max);
}

function parseDate(value: string | null) {
  return value && DATE_PATTERN.test(value) ? value : null;
}

function daysBetween(start: string, end: string) {
  return Math.floor((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1;
}

function chileToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function metadata(access: ScopedAccess) {
  const params: ClickHouseParams = {};
  const predicates = scopePredicates(access, params);
  predicates.push("d.effective_price > 0");

  const [metaRows, optionRows] = await Promise.all([
    clickHouseQuery<MetaRow>(`
      SELECT
        toString(min(d.price_date)) AS first_date,
        toString(max(d.price_date)) AS last_date,
        count() AS observations,
        uniqExact(d.product_id) AS products
      FROM daily_pricing_live AS d FINAL
      INNER JOIN products AS p FINAL ON p.id = d.product_id
      WHERE ${predicates.join("\n        AND ")}
    `, params, 8_000),
    clickHouseQuery<OptionRow>(`
      SELECT dimension, value, observations
      FROM (
        SELECT 'retailer' AS dimension, p.supermarket AS value, count() AS observations
        FROM daily_pricing_live AS d FINAL
        INNER JOIN products AS p FINAL ON p.id = d.product_id
        WHERE ${predicates.join("\n          AND ")}
        GROUP BY value
        UNION ALL
        SELECT 'category' AS dimension, ${smartCategory()} AS value, count() AS observations
        FROM daily_pricing_live AS d FINAL
        INNER JOIN products AS p FINAL ON p.id = d.product_id
        WHERE ${predicates.join("\n          AND ")}
          AND notEmpty(ifNull(${smartCategory()}, ''))
        GROUP BY value
        ORDER BY observations DESC
        LIMIT 120
        UNION ALL
        SELECT 'brand' AS dimension, ifNull(p.brand, '') AS value, count() AS observations
        FROM daily_pricing_live AS d FINAL
        INNER JOIN products AS p FINAL ON p.id = d.product_id
        WHERE ${predicates.join("\n          AND ")}
          AND notEmpty(ifNull(p.brand, ''))
        GROUP BY value
        ORDER BY observations DESC
        LIMIT 120
      )
      ORDER BY dimension, observations DESC
    `, params, 10_000),
  ]);

  const meta = metaRows[0] ?? null;
  return {
    source: "clickhouse" as const,
    firstDate: meta?.first_date ?? null,
    lastDate: meta?.last_date ?? null,
    observations: numeric(meta?.observations),
    products: numeric(meta?.products),
    retailers: optionRows.filter((row) => row.dimension === "retailer").map((row) => ({ value: row.value, observations: numeric(row.observations) })),
    categories: optionRows.filter((row) => row.dimension === "category").map((row) => ({ value: row.value, observations: numeric(row.observations) })),
    brands: optionRows.filter((row) => row.dimension === "brand").map((row) => ({ value: row.value, observations: numeric(row.observations) })),
  };
}

async function clickHouseCsv(sql: string, params: ClickHouseParams) {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set("database", CLICKHOUSE_DATABASE);
  url.searchParams.set("wait_end_of_query", "0");
  for (const [name, param] of Object.entries(params)) url.searchParams.set(`param_${name}`, String(param.value));

  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-clickhouse-user": CLICKHOUSE_USER,
      "x-clickhouse-key": CLICKHOUSE_PASSWORD,
    },
    body: sql.trim(),
    cache: "no-store",
  });
}

function excelFriendlyStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("\uFEFFsep=,\r\n"));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function safeFilenamePart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "downloads");
  if (authorization.response) return authorization.response;
  const access = authorization.access as ScopedAccess | undefined;
  if (!access) return NextResponse.json({ error: "No fue posible resolver el acceso." }, { status: 500 });
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está configurado.", source: "clickhouse" }, { status: 503 });

  if (request.nextUrl.searchParams.get("mode") === "meta") {
    try {
      return NextResponse.json(await metadata(access), { headers: { "cache-control": "private, no-store, max-age=0" } });
    } catch {
      return NextResponse.json({ error: "No fue posible cargar la disponibilidad de exportación desde ClickHouse.", source: "clickhouse" }, { status: 503 });
    }
  }

  const startDate = parseDate(request.nextUrl.searchParams.get("startDate"));
  const endDate = parseDate(request.nextUrl.searchParams.get("endDate"));
  const retailer = clean(request.nextUrl.searchParams.get("retailer"), 120);
  const category = clean(request.nextUrl.searchParams.get("category"), 240);
  const brand = clean(request.nextUrl.searchParams.get("brand"), 180);

  if (!startDate || !endDate) return NextResponse.json({ error: "Selecciona una fecha inicial y final válidas." }, { status: 400 });
  if (startDate > endDate || endDate > chileToday()) return NextResponse.json({ error: "El rango de fechas no es válido." }, { status: 400 });
  const rangeDays = daysBetween(startDate, endDate);
  if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) return NextResponse.json({ error: `El período máximo permitido es de ${MAX_RANGE_DAYS} días.` }, { status: 400 });

  const params: ClickHouseParams = {
    export_start: { type: "String", value: startDate },
    export_end: { type: "String", value: endDate },
  };
  const predicates = scopePredicates(access, params);
  predicates.push("d.effective_price > 0");
  predicates.push("d.price_date BETWEEN toDate({export_start:String}) AND toDate({export_end:String})");
  if (retailer) predicates.push(`p.supermarket = ${addString(params, "export_retailer", retailer)}`);
  if (category) predicates.push(`${smartCategory()} = ${addString(params, "export_category", category)}`);
  if (brand) predicates.push(`p.brand = ${addString(params, "export_brand", brand)}`);

  const sql = `
    SELECT
      toString(d.price_date) AS \`Fecha\`,
      formatDateTime(d.observed_at, '%Y-%m-%d %H:%i:%s', 'America/Santiago') AS \`Fecha observacion\`,
      p.supermarket AS \`Retailer\`,
      p.external_id AS \`SKU retailer\`,
      p.name AS \`Producto\`,
      ifNull(p.brand, '') AS \`Marca\`,
      ${smartCategory()} AS \`Categoria\`,
      round(toFloat64(ifNull(o.regular_price, 0)), 2) AS \`Precio regular\`,
      round(toFloat64(ifNull(o.offer_price, 0)), 2) AS \`Precio oferta\`,
      round(toFloat64(d.effective_price), 2) AS \`Precio efectivo\`,
      ifNull(o.unit, '') AS \`Unidad\`,
      round(toFloat64(ifNull(o.unit_price, 0)), 2) AS \`Precio unitario\`,
      if(ifNull(o.in_stock, false), 'Si', 'No') AS \`En stock\`,
      p.url AS \`URL producto\`
    FROM daily_pricing_live AS d FINAL
    INNER JOIN products AS p FINAL ON p.id = d.product_id
    LEFT JOIN price_observations AS o FINAL ON o.id = d.observation_id
    WHERE ${predicates.join("\n      AND ")}
    ORDER BY d.price_date DESC, p.supermarket ASC, p.name ASC
    FORMAT CSVWithNames
  `;

  try {
    const upstream = await clickHouseCsv(sql, params);
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "ClickHouse no pudo generar el archivo." }, { status: 503 });

    const parts = ["precios", startDate, endDate, retailer && safeFilenamePart(retailer), category && safeFilenamePart(category), brand && safeFilenamePart(brand)].filter(Boolean);
    const filename = `${parts.join("_")}.csv`;
    return new Response(excelFriendlyStream(upstream.body), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename=\"${filename}\"`,
        "cache-control": "private, no-store, max-age=0",
        "x-data-source": "clickhouse",
      },
    });
  } catch {
    return NextResponse.json({ error: "No fue posible generar la descarga desde ClickHouse." }, { status: 503 });
  }
}
