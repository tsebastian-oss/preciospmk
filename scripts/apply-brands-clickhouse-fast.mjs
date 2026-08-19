import fs from "node:fs";
const path = "src/app/BrandsVertical.tsx";
let source = fs.readFileSync(path, "utf8");

// The multi-brand competitive view intentionally uses /api/brands because that
// endpoint now composes the Supabase payload with a live competitive pulse.
if (source.includes("encodeURIComponent(selectedBrand)") && source.includes("type LivePulse =")) {
  console.log("Brands multi-brand live path detected; ClickHouse legacy patch skipped");
  process.exit(0);
}

const slow = 'fetch("/api/brands?brand=victorinox", { credentials: "same-origin" })';
const fastV2 = 'fetch("/api/brands-fast-v2?brand=victorinox", { credentials: "same-origin" })';
const resilientV2 = 'fetch("/api/brands-fast-v2?brand=victorinox", { credentials: "same-origin" }).then(async response => response.ok ? response : fetch("/api/brands?brand=victorinox", { credentials: "same-origin" }))';
const fastV3 = 'fetch("/api/brands-clickhouse-v3?brand=victorinox", { credentials: "same-origin" })';
if (source.includes(resilientV2)) source = source.replace(resilientV2, fastV3);
if (source.includes(fastV2)) source = source.replace(fastV2, fastV3);
if (source.includes(slow)) source = source.replace(slow, fastV3);
if (!source.includes(fastV3)) throw new Error("Brands ClickHouse v3 endpoint patch missing");
fs.writeFileSync(path, source);
console.log("Brands ClickHouse v3 fast path applied");
