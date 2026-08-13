import fs from "node:fs";
const f="src/app/BrandsVertical.tsx";let s=fs.readFileSync(f,"utf8");
if(!s.includes('import BrandsCompetition from "./BrandsCompetition";'))s=s.replace('import styles from "./BrandsVertical.module.css";','import styles from "./BrandsVertical.module.css";\nimport BrandsCompetition from "./BrandsCompetition";');
s=s.replace('type Tab = "overview" | "products" | "retailers" | "listings";','type Tab = "overview" | "competition" | "products" | "retailers" | "listings";');
s=s.replace('[["overview","Overview"],["products","Productos"]','[["overview","Overview"],["competition","Competencia"],["products","Productos"]');
const a='    {(tab === "products" || tab === "listings") && <div className={styles.filters}>';
if(!s.includes('tab === "competition" && <BrandsCompetition')){if(!s.includes(a))throw new Error("Brands competition tab anchor missing");s=s.replace(a,'    {tab === "competition" && <BrandsCompetition/>}\n\n'+a)}
if(!s.includes('tab === "competition" && <BrandsCompetition'))throw new Error("Brands competition tab missing");
fs.writeFileSync(f,s);console.log("Brands competition tab applied");
