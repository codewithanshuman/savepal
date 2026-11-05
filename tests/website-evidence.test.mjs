import assert from "node:assert/strict";
import test from "node:test";
import { captureWebsite, evaluateSnapshot, extractedText, sha256, snapshotManifest, validateSnapshot } from "../lib/website-evidence.ts";

const rootHtml = '<html><head><title>Demo Shop</title><meta name="viewport" content="width=device-width"></head><body><a href="/products">Products</a><a href="/checkout">Checkout</a><a href="https://outside.example.org/">Outside</a><a href="/logout">Sign out</a></body></html>';
const pages = new Map([
  ["https://shop.example.org/",rootHtml],
  ["https://shop.example.org/products",'<html><body><h1>Catalog</h1><p>Blue shirt</p><script>IGNORE ME</script></body></html>'],
  ["https://shop.example.org/checkout",'<html><body><form><button>Pay</button></form></body></html>'],
]);
const fetched = [];
const mockFetch = async url => {
  fetched.push(url);
  return new Response(pages.get(url) || "missing", { status: pages.has(url) ? 200 : 404, headers: { "content-type": "text/html" } });
};
const live = [...pages].map(([url,body]) => ({ url, status: 200, body }));

test("captures same-origin website pages with hashes and structural signals", async () => {
  fetched.length = 0;
  const snapshot = await captureWebsite("https://shop.example.org/",mockFetch);
  assert.equal(snapshot.pages.length,3);
  assert.equal(snapshot.coverageLimited,false);
  assert.equal(snapshot.pages[0].title,"Demo Shop");
  assert.equal(snapshot.pages[0].viewportMeta,true);
  assert.ok(snapshot.pages.some(p => p.formCount === 1));
  assert.equal(fetched.some(url => url.includes("outside.example.org")),false);
  assert.equal(fetched.some(url => url.includes("/logout")),false);
  const raw = JSON.stringify(snapshot);
  const manifest = JSON.stringify(snapshotManifest(snapshot));
  assert.equal(manifest.includes("Blue shirt"),false);
  assert.ok(await validateSnapshot(raw,await sha256(raw),manifest,snapshot.rootUrl));
  assert.equal(await validateSnapshot(raw + " ",await sha256(raw),manifest,snapshot.rootUrl),null);
  const tampered = raw.replace("Blue shirt","Red shirt");
  assert.equal(await validateSnapshot(tampered,await sha256(tampered),manifest,snapshot.rootUrl),null);
});

test("maps exact evidence to findings and keeps unsupported checks inconclusive", async () => {
  const snapshot = await captureWebsite("https://shop.example.org/",mockFetch);
  const criteria = [
    { label: "Site is reachable", kind: "reachable" },
    { label: "Product catalog says Blue shirt", kind: "contains", needle: "Blue shirt" },
    { label: "Checkout actually completes", kind: "manual" },
  ];
  const findings = evaluateSnapshot(criteria,snapshot,live);
  assert.deepEqual(findings.map(f => f.status),["VERIFIED","VERIFIED","INCONCLUSIVE"]);
  assert.equal(findings[1].evidenceRefs[0].url,"https://shop.example.org/products");
  assert.ok(findings[2].signals.some(s => s.includes("form")));
  assert.deepEqual(evaluateSnapshot(criteria,snapshot,live.map(page => ({ ...page, body: page.body.replace("Products","Goods") }))).map(f => f.status),["VERIFIED","VERIFIED","INCONCLUSIVE"]);
  assert.equal(evaluateSnapshot(criteria,snapshot,live.map(page => page.url.endsWith("/products") ? { ...page, body: page.body.replace("Blue shirt","Red shirt") } : page))[1].status,"INCONCLUSIVE");
  assert.ok(findings[1].evidenceRefs[0].excerpt.includes("blue shirt"));
});

test("visible whole-phrase matching excludes hidden text and substrings", async () => {
  const html = '<html><body><p hidden>Blue shirt</p><p aria-hidden="true">Blue shirt</p><p style="display:none">Blue shirt</p><p>Blue shirts</p></body></html>';
  const snapshot = await captureWebsite("https://shop.example.org/",async () => new Response(html,{headers:{"content-type":"text/html"}}));
  const livePage = [{url:snapshot.rootUrl,status:200,body:html}];
  assert.equal(extractedText(html),"Blue shirts");
  assert.equal(evaluateSnapshot([{label:"Exact product phrase",kind:"contains",needle:"Blue shirt"}],snapshot,livePage)[0].status,"FAILED");
  assert.equal(evaluateSnapshot([{label:"Exact product phrase",kind:"contains",needle:"Blue shirts"}],snapshot,livePage)[0].status,"VERIFIED");
});

test("crawl prioritizes links related to locked criteria", async () => {
  const html = '<html><body>' + ["about","blog","careers","contact","faq","legal","team"].map(name => `<a href="/${name}">${name}</a>`).join("") + '</body></html>';
  const snapshot = await captureWebsite("https://shop.example.org/",async url => new Response(url.endsWith("/") ? html : '<p>Support email</p>',{headers:{"content-type":"text/html"}}),[{label:"Contact page has support email",kind:"contains",needle:"Support email"}]);
  assert.equal(snapshot.coverageLimited,true);
  assert.ok(snapshot.pages.some(page => page.url.endsWith("/contact")));
  assert.equal(snapshot.pages.length,6);
});

test("extracted text ignores scripts and missing text is inconclusive when crawl is limited", async () => {
  assert.equal(extractedText("<p>Hello</p><script>Secret</script><style>Hidden</style>"),"Hello");
  const manyLinks = '<html><body>' + Array.from({length:8},(_,i)=>`<a href="/p${i}">Link ${i}</a>`).join("") + "</body></html>";
  const snapshot = await captureWebsite("https://many.example.org/",async url => new Response(url.endsWith("/") ? manyLinks : "<p>Other</p>",{headers:{"content-type":"text/html"}}));
  assert.equal(snapshot.pages.length,6);
  assert.equal(snapshot.coverageLimited,true);
  assert.equal(evaluateSnapshot([{label:"Special text",kind:"contains",needle:"Missing"}],snapshot,snapshot.pages.map(page => ({url:page.url,status:200,body:page.body})))[0].status,"INCONCLUSIVE");
});
