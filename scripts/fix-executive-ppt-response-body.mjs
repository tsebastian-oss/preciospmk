import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/api/b2b-pricing/executive-ppt/route.ts";
let source = readFileSync(path, "utf8");

const before = "return new Response(buffer, {";
const after = "return new Response(new Uint8Array(buffer), {";

if (source.includes(before)) {
  source = source.replace(before, after);
  writeFileSync(path, source);
  console.log("Executive PPT response body normalized");
} else if (source.includes(after)) {
  console.log("Executive PPT response body already normalized");
} else {
  throw new Error("Executive PPT response body anchor not found");
}
