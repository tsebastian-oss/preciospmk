import fs from "node:fs";

const path = "src/app/BrandsVertical.tsx";
let source = fs.readFileSync(path, "utf8");

source = source.replace(
  'const [selectedBrand, setSelectedBrand] = useState("victorinox");',
  'const [selectedBrand, setSelectedBrand] = useState("krispy-kreme");',
);

const directFetch = '    fetch(`/api/brands?brand=${encodeURIComponent(selectedBrand)}`, { credentials: "same-origin", cache: "no-store" })';
const routedFetch = `    const baseEndpoint = selectedBrand === "victorinox"
      ? \`/api/brands-clickhouse-v3?brand=\${encodeURIComponent(selectedBrand)}\`
      : \`/api/brands?brand=\${encodeURIComponent(selectedBrand)}\`;
    fetch(baseEndpoint, { credentials: "same-origin", cache: "no-store" })`;

if (source.includes(directFetch)) source = source.replace(directFetch, routedFetch);

if (!source.includes('useState("krispy-kreme")')) throw new Error("Krispy Kreme default brand not applied");
if (!source.includes('/api/brands-clickhouse-v3?brand=')) throw new Error("Victorinox ClickHouse fast path not applied");
if (!source.includes('historyCategory')) throw new Error("Official Brands history view not detected");

fs.writeFileSync(path, source);
console.log("Brands loader compatibility applied");
