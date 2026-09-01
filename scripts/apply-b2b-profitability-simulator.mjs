import fs from "node:fs";

const pricingPath = "src/app/B2BPricing.tsx";
let source = fs.readFileSync(pricingPath, "utf8");

if (source.includes('import ChilexpressMarketPanel from "./ChilexpressMarketPanel";')) {
  console.log("Dedicated Courier & Logistics workspace detected; generic profitability simulator patch skipped");
  process.exit(0);
}

const styleImport = 'import styles from "./B2BPricing.module.css";';
const simulatorImport = 'import B2BProfitabilitySimulator from "./B2BProfitabilitySimulator";';

if (!source.includes(simulatorImport)) {
  if (!source.includes(styleImport)) throw new Error("B2B profitability: style import anchor missing");
  source = source.replace(styleImport, `${styleImport}\n${simulatorImport}`);
}

const anchor = '    {!loading && data ? <>\n      <article className={styles.normalizedCard}>';
const replacement = '    {!loading && data ? <>\n      <B2BProfitabilitySimulator/>\n\n      <article className={styles.normalizedCard}>';

if (!source.includes('<B2BProfitabilitySimulator/>')) {
  if (!source.includes(anchor)) throw new Error("B2B profitability: render anchor missing");
  source = source.replace(anchor, replacement);
}

fs.writeFileSync(pricingPath, source);
console.log("B2B profitability simulator applied");
