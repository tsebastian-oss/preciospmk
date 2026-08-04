import {
  buildMetrics,
  deterministicExplanation,
  extractPackage,
  normalizeText,
  numeric,
  type CompetitorMatch,
  type ProductRecord,
  type Relationship,
} from "@/lib/competitive-intelligence";

export { buildMetrics, deterministicExplanation, normalizeText, numeric };
export type { CompetitorMatch, ProductRecord, Relationship };

const STOPWORDS = new Set(["a","al","con","de","del","el","en","la","las","lo","los","para","por","sin","un","una","y","pack","producto","nuevo","nueva","unidad","unidades","formato","marca","botella","bolsa","caja"]);
const GENERIC = new Set(["original","tradicional","clasico","clasica","regular","natural","premium","especial","seleccion"]);
const VARIANT_GROUPS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["maravilla","canola","oliva","maiz","coco","pepita","vegetal","freir"]),
  new Set(["entera","descremada","semidescremada"]),
  new Set(["basmati","integral","sushi","risotto","paella","jazmin"]),
  new Set(["zero","light","original"]),
  new Set(["liquido","polvo","capsula"]),
];

function clamp(value:number){return Math.max(0,Math.min(1,value));}
function canonicalToken(raw:string){
  let token=raw.replace(/^\.+|\.+$/g,"");
  if(token.length>5&&token.endsWith("s"))token=token.slice(0,-1);
  return token;
}
function tokens(value:string|null|undefined,ignoreGeneric=false){
  const result=new Set<string>();
  for(const raw of normalizeText(value).split(" ")){
    const token=canonicalToken(raw);
    if(token.length<2||STOPWORDS.has(token)||/^\d+(?:\.\d+)?$/.test(token))continue;
    if(ignoreGeneric&&GENERIC.has(token))continue;
    result.add(token);
  }
  return result;
}
function jaccard(left:Set<string>,right:Set<string>){
  if(!left.size||!right.size)return 0;
  let intersection=0;let union=0;
  const all=new Set<string>([...left,...right]);
  for(const token of all){const weight=GENERIC.has(token)?.35:token.length>=7?1.25:1;union+=weight;if(left.has(token)&&right.has(token))intersection+=weight;}
  return union?intersection/union:0;
}
function subsetScore(left:Set<string>,right:Set<string>){
  if(!left.size||!right.size)return 0;
  const smaller=left.size<=right.size?left:right;
  const larger=left.size<=right.size?right:left;
  let matches=0;for(const token of smaller)if(larger.has(token))matches++;
  return matches/smaller.size;
}
function leaf(category:string|null){
  const raw=(category??"").split(">").at(-1)??category??"";
  return tokens(raw);
}
function categorySimilarity(left:string|null,right:string|null){
  const a=normalizeText(left);const b=normalizeText(right);
  if(!a||!b)return .42;
  if(a===b)return 1;
  if(a.includes(b)||b.includes(a))return .92;
  const allScore=jaccard(tokens(a),tokens(b));
  const leftLeaf=leaf(left);const rightLeaf=leaf(right);
  const leafScore=jaccard(leftLeaf,rightLeaf);
  const containment=subsetScore(leftLeaf,rightLeaf);
  return Math.max(allScore,leafScore,containment>=1?.86:containment>=.5?.68:0);
}
function variantConflict(left:string,right:string){
  const leftTokens=tokens(left);const rightTokens=tokens(right);
  for(const group of VARIANT_GROUPS){
    const leftVariants=[...group].filter(token=>leftTokens.has(token));
    const rightVariants=[...group].filter(token=>rightTokens.has(token));
    if(leftVariants.length&&rightVariants.length&&!leftVariants.some(token=>rightVariants.includes(token)))return true;
  }
  return false;
}
type Measure=ReturnType<typeof extractPackage>;
function packageSimilarity(left:Measure,right:Measure){
  if(!left&&!right)return .58;
  if(!left||!right)return .46;
  if(left.family!==right.family)return 0;
  const total=Math.min(left.total,right.total)/Math.max(left.total,right.total);
  const item=Math.min(left.itemAmount,right.itemAmount)/Math.max(left.itemAmount,right.itemAmount);
  const pack=Math.min(left.packCount,right.packCount)/Math.max(left.packCount,right.packCount);
  return clamp(total*.68+item*.22+pack*.1);
}
function unitPrice(product:ProductRecord,measure:Measure){
  const explicit=numeric(product.unit_price);if(explicit>0)return explicit;
  const price=numeric(product.offer_price)||numeric(product.regular_price);
  if(!measure||price<=0||measure.total<=0)return null;
  return measure.family==="count"?price/measure.total:price/measure.total*1000;
}
function brandSimilarity(left:string|null,right:string|null){
  const a=normalizeText(left),b=normalizeText(right);if(!a||!b)return .48;if(a===b)return 1;return jaccard(tokens(a),tokens(b));
}
function relationship(params:{score:number;sameBrand:boolean;lexical:number;category:number;packageScore:number;variantsConflict:boolean}):Relationship|null{
  const {score,sameBrand,lexical,category,packageScore,variantsConflict}=params;
  if(!variantsConflict&&sameBrand&&lexical>=.45&&packageScore>=.82&&score>=.62)return "equivalent";
  if(!variantsConflict&&packageScore>=.68&&((category>=.55&&lexical>=.27)||lexical>=.47)&&score>=.5)return "direct_competitor";
  if(packageScore>=.55&&((category>=.48&&lexical>=.18)||lexical>=.36)&&score>=.43)return "substitute";
  return null;
}
function confidence(score:number):CompetitorMatch["confidence"]{return score>=80?"high":score>=64?"medium":"low";}

export function scoreCompetitor(target:ProductRecord,candidate:ProductRecord):CompetitorMatch|null{
  if(target.id===candidate.id||target.supermarket===candidate.supermarket)return null;
  const targetMeasure=extractPackage(target.name,target.unit),candidateMeasure=extractPackage(candidate.name,candidate.unit);
  const packageScore=packageSimilarity(targetMeasure,candidateMeasure);
  if(targetMeasure&&candidateMeasure&&targetMeasure.family!==candidateMeasure.family)return null;
  if(targetMeasure&&candidateMeasure&&packageScore<.42)return null;
  const lexical=jaccard(tokens(target.name,true),tokens(candidate.name,true));
  const category=categorySimilarity(target.category,candidate.category);
  const brand=brandSimilarity(target.brand,candidate.brand);
  const sameBrand=Boolean(normalizeText(target.brand)&&normalizeText(target.brand)===normalizeText(candidate.brand));
  const variantsConflict=variantConflict(target.name,candidate.name);
  const targetUnit=unitPrice(target,targetMeasure),candidateUnit=unitPrice(candidate,candidateMeasure);
  const unitPriceScore=targetUnit&&candidateUnit?Math.min(targetUnit,candidateUnit)/Math.max(targetUnit,candidateUnit):.5;
  const raw=lexical*.4+category*.23+packageScore*.27+brand*.06+unitPriceScore*.04;
  const relation=relationship({score:raw,sameBrand,lexical,category,packageScore,variantsConflict});if(!relation)return null;
  const reasons:string[]=[];const warnings:string[]=[];
  if(category>=.82)reasons.push("misma categoría");else if(category>=.55)reasons.push("taxonomía equivalente");
  if(lexical>=.62)reasons.push("atributos altamente similares");else if(lexical>=.36)reasons.push("atributos comparables");
  if(packageScore>=.9)reasons.push("formato equivalente");else if(packageScore>=.68)reasons.push("formato comparable");
  if(sameBrand)reasons.push("misma marca");
  if(variantsConflict)warnings.push("variante distinta; tratado como sustituto");
  if(!targetMeasure||!candidateMeasure)warnings.push("formato incompleto");
  if(!target.brand||!candidate.brand)warnings.push("marca no informada");
  if(category<.55&&lexical>=.47)warnings.push("taxonomías distintas; match respaldado por descripción y formato");
  const targetPrice=numeric(target.offer_price)||numeric(target.regular_price),candidatePrice=numeric(candidate.offer_price)||numeric(candidate.regular_price);
  const gap=targetPrice-candidatePrice;const similarity=Math.round(raw*1000)/10;
  return {...candidate,relationship:relation,similarity,confidence:confidence(similarity),reasons,warnings,price_gap:gap,price_gap_pct:candidatePrice>0?gap/candidatePrice*100:0,normalized_unit_price:candidateUnit};
}
