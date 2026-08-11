import fs from "node:fs";

const overview = fs.readFileSync("src/app/ClickHouseOverview.tsx", "utf8");
const route = fs.readFileSync("src/app/api/product-price-trends/route.ts", "utf8");
const data = fs.readFileSync("src/lib/clickhouse-product-trends.ts", "utf8");
const failures = [];

for (const marker of ["ProductComparisonChart", "Agregar al gráfico", "selectedProducts.length >= 4", "/api/product-price-trends?mode=brands"]) {
  if (!overview.includes(marker)) failures.push(`Overview missing ${marker}`);
}
for (const marker of ["value={retailer}", "value={category}", "value={brand}", "Ver monitoreo →"]) {
  if (overview.includes(marker)) failures.push(`Legacy overview control remains: ${marker}`);
}
if (!route.includes('enterpriseAccess(request, "overview")') || !route.includes("clickHouseConfigured")) failures.push("Product trend route is not protected/configured");
if (!data.includes("daily_pricing_live") || data.toLowerCase().includes("supabase")) failures.push("Product trend data layer must be ClickHouse-only");
if (!data.includes("slice(0, 4)")) failures.push("Server-side max 4 product guard missing");

if (failures.length) {
  console.error("Product price comparison verification FAILED");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log("Product price comparison verification OK");
