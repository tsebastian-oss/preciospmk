import { strict as assert } from "node:assert";
import { discoverMarket, parseMarketProducts } from "./market-parsers-v4.ts";

const url = "https://sinotrukindumotora.cl/content/sinotruk/es/home/modelos/bolden-advance.html";
const encoded = '[{&#34;price&#34;:&#34;23431100&#34;,&#34;SAPCode&#34;:&#34;1001&#34;,&#34;version&#34;:&#34;Advance MT 4X2&#34;,&#34;modelo&#34;:&#34;Sinotruk Bolden&#34;}]';
const section = (label: string, value: string) => `<span data-subcategory="${label}"></span><span data-code="BOLD1001"></span><span data-valor-version="${value}"></span>`;
const html = `<st-comparador-component dataversions="${encoded}"></st-comparador-component>${section("Precio lista (con IVA) ", "$23.431.100")}${section("Bono marca", "$3.570.000")}${section("Bono Forum ", "$1.428.000")}${section("Precio final (con IVA)", "$18.433.100")}`;
const products = parseMarketProducts("indumotora_sinotruk", html, url, "indumotora_sinotruk", "Indumotora") ?? [];
assert.equal(products.length, 1);
assert.equal(products[0].brand, "Sinotruk");
assert.equal(products[0].list_price, 23_431_100);
assert.equal(products[0].cash_price, 19_861_100);
assert.equal(products[0].final_price, 18_433_100);
assert.equal(products[0].metadata.source_version_id, "1001");
assert.equal(parseMarketProducts("indumotora_sinotruk", html.replace("$18.433.100", "$15.000.000"), url, "indumotora_sinotruk", "Indumotora")?.length, 0);
const links = `<a href="${url}">Advance</a><a href="${url.replace("bolden-advance", "bolden-pro")}">Pro</a>`;
assert.deepEqual(discoverMarket("indumotora_sinotruk", links, url, "root")?.map((item) => item.url), [url]);
console.log("Sinotruk structured version price and canonical discovery passed");
