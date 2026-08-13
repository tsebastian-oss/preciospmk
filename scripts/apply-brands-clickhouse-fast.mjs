import fs from "node:fs";
const path = "src/app/BrandsVertical.tsx";
let source = fs.readFileSync(path, "utf8");
const slow = 'fetch("/api/brands?brand=victorinox", { credentials: "same-origin" })';
const fast = 'fetch("/api/brands-fast-v2?brand=victorinox", { credentials: "same-origin" })';
if (source.includes(slow)) source = source.replace(slow, fast);
if (!source.includes(fast)) throw new Error("Brands ClickHouse endpoint patch missing");
fs.writeFileSync(path, source);
console.log("Brands ClickHouse fast path applied");
