import fs from "node:fs";
const f="src/app/BrandsVertical.tsx";let s=fs.readFileSync(f,"utf8");

// New multi-brand BrandsVertical owns its competition experience directly.
// Keep this legacy patch idempotent for older branches without overwriting it.
if(s.includes("type LivePulse =")&&s.includes("live.benchmarks")&&s.includes('"competition"')){
  console.log("Integrated Brands live competition tab detected; legacy competition patch skipped");
  process.exit(0);
}

if(!s.includes('import BrandsCompetition from "./BrandsCompetition";'))s=s.replace('import styles from "./BrandsVertical.module.css";','import styles from "./BrandsVertical.module.css";\nimport BrandsCompetition from "./BrandsCompetition";');
s=s.replace('type Tab = "overview" | "products" | "retailers" | "listings";','type Tab = "overview" | "competition" | "products" | "retailers" | "listings";');
s=s.replace('[["overview","Overview"],["products","Productos"]','[["overview","Overview"],["competition","Competencia"],["products","Productos"]');
const a='    {(tab === "products" || tab === "listings") && <div className={styles.filters}>';
if(!s.includes('tab === "competition" && <BrandsCompetition')){if(!s.includes(a))throw new Error("Brands competition tab anchor missing");s=s.replace(a,'    {tab === "competition" && <BrandsCompetition/>}\n\n'+a)}
if(!s.includes('tab === "competition" && <BrandsCompetition'))throw new Error("Brands competition tab missing");
fs.writeFileSync(f,s);

const cfile="src/app/BrandsCompetition.tsx";let c=fs.readFileSync(cfile,"utf8");
if(!c.includes('import BrandsCompetitionHistory from "./BrandsCompetitionHistory";'))c=c.replace('import styles from "./BrandsVertical.module.css";','import styles from "./BrandsVertical.module.css";\nimport BrandsCompetitionHistory from "./BrandsCompetitionHistory";');
const historyAnchor='  {data.categories.map((g:any)=>';
if(!c.includes('<BrandsCompetitionHistory/>')){if(!c.includes(historyAnchor))throw new Error("Brands history anchor missing");c=c.replace(historyAnchor,'  <BrandsCompetitionHistory/>\n'+historyAnchor)}
if(!c.includes('<BrandsCompetitionHistory/>'))throw new Error("Brands competition history missing");
fs.writeFileSync(cfile,c);
console.log("Brands competition tab and history applied");
