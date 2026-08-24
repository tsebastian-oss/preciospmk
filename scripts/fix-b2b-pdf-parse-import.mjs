import fs from "node:fs";
const path = "src/app/api/b2b-pricing/market-public-rates/refresh/route.ts";
let source = fs.readFileSync(path, "utf8");
source = source.replace('import pdfParse from "pdf-parse";', 'import pdfParse from "pdf-parse/lib/pdf-parse.js";');
fs.writeFileSync(path, source);
console.log("B2B PDF parser server import normalized");
