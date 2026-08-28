import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

type ExportRow = {
  cadena?: string;
  dominio?: string;
  categoria?: string;
  marca?: string;
  producto?: string;
  skuFuente?: string;
  precioActual?: number | null;
  precioRegular?: number | null;
  descuentoPct?: number | null;
  stock?: boolean | null;
  ml?: number | null;
  precioPorLitro?: number | null;
  moneda?: string;
  url?: string;
  observadoAt?: string;
};

type ExportPayload = { rows?: ExportRow[]; count?: number; lastObservedAt?: string | null };

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cell(value: unknown, type: "String" | "Number" = "String", style = "") {
  if (value == null || value === "") return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="String"></Data></Cell>`;
  if (type === "Number" && Number.isFinite(Number(value))) {
    return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="Number">${Number(value)}</Data></Cell>`;
  }
  return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="String">${xml(value)}</Data></Cell>`;
}

function worksheet(name: string, rows: ExportRow[]) {
  const headers = ["Cadena","Dominio","Categoría","Marca","Producto","SKU fuente","Precio actual","Precio regular","Descuento %","Stock","ml","Precio por litro","Moneda","URL","Observado"];
  const body = rows.map(row => `<Row>
    ${cell(row.cadena)}${cell(row.dominio)}${cell(row.categoria)}${cell(row.marca)}${cell(row.producto)}${cell(row.skuFuente)}
    ${cell(row.precioActual,"Number","money")}${cell(row.precioRegular,"Number","money")}${cell(row.descuentoPct,"Number","decimal")}
    ${cell(row.stock == null ? "" : row.stock ? "Disponible" : "Sin stock")}${cell(row.ml,"Number")}${cell(row.precioPorLitro,"Number","money")}
    ${cell(row.moneda)}${cell(row.url)}${cell(row.observadoAt)}
  </Row>`).join("");

  return `<Worksheet ss:Name="${xml(name.slice(0,31))}"><Table>
    <Row>${headers.map(header => cell(header,"String","header")).join("")}</Row>
    ${body}
  </Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions></Worksheet>`;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "bodegas-don-luis")) {
    return NextResponse.json({ error: "Esta marca no está habilitada para tu cuenta." }, { status: 403 });
  }

  const requested = request.nextUrl.searchParams.get("category")?.trim() || "";
  const category = ["Pisco","Ron","Vino"].includes(requested) ? requested : null;

  const result = await enterpriseRpc<ExportPayload>(request, "brands_peru_liquor_export", {
    p_slug: "bodegas-don-luis",
    p_category: category,
  });
  if (result.response) return result.response;

  const rows = Array.isArray(result.data?.rows) ? result.data!.rows! : [];
  const groups = category
    ? [[category, rows] as const]
    : (["Pisco","Ron","Vino"] as const).map(item => [item, rows.filter(row => row.categoria === item)] as const);

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Font ss:FontName="Aptos" ss:Size="10"/></Style>
  <Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#172033" ss:Pattern="Solid"/></Style>
  <Style ss:ID="money"><NumberFormat ss:Format="0.00"/></Style>
  <Style ss:ID="decimal"><NumberFormat ss:Format="0.0"/></Style>
 </Styles>
 ${groups.map(([name,data]) => worksheet(name,data)).join("")}
</Workbook>`;

  const suffix = category ? "-" + category.toLowerCase() : "-completa";
  return new NextResponse(workbook, {
    status: 200,
    headers: {
      "content-type": "application/vnd.ms-excel; charset=utf-8",
      "content-disposition": `attachment; filename="bodegas-don-luis${suffix}-${new Date().toISOString().slice(0,10)}.xls"`,
      "cache-control": "private, no-store",
    },
  });
}
