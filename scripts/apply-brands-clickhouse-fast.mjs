import fs from "node:fs";
const path = "src/app/BrandsVertical.tsx";
let source = fs.readFileSync(path, "utf8");
const slow = 'fetch("/api/brands?brand=victorinox", { credentials: "same-origin" })';
const fast = 'fetch("/api/brands-fast-v2?brand=victorinox", { credentials: "same-origin" })';
const resilient = 'fetch("/api/brands-fast-v2?brand=victorinox", { credentials: "same-origin" }).then(async response => response.ok ? response : fetch("/api/brands?brand=victorinox", { credentials: "same-origin" }))';
if (source.includes(resilient)) {
  console.log("Brands resilient ClickHouse fast path already applied");
} else {
  if (source.includes(fast)) source = source.replace(fast, resilient);
  else if (source.includes(slow)) source = source.replace(slow, resilient);
}
if (!source.includes(resilient)) throw new Error("Brands resilient ClickHouse endpoint patch missing");
fs.writeFileSync(path, source);
console.log("Brands resilient ClickHouse fast path applied");
