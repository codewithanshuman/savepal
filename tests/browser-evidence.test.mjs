import assert from "node:assert/strict";
import test from "node:test";
import { captureRenderedPage, validateRenderedPage } from "../lib/browser-evidence.ts";
import { captureWebsite, evaluateSnapshot, sha256, snapshotManifest, validateSnapshot } from "../lib/website-evidence.ts";

test("rendered DOM capture is bounded, hashed, and replayed with the source snapshot", async () => {
  const url = "https://shop.example.org/";
  const source = "<html><body><div id='app'></div></body></html>";
  const renderedHtml = "<html><body><p>Catalog now open</p></body></html>";
  const key = "rendered/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.png";
  let browserCalled = false;
  const browser = await captureRenderedPage(url,key,"a".repeat(32),"test-token",async (endpoint,options) => {
    browserCalled = true;
    assert.ok(endpoint.endsWith("/browser-run/snapshot"));
    assert.equal(JSON.parse(options.body).url,url);
    return Response.json({success:true,result:{content:renderedHtml,screenshot:Buffer.from([137,80,78,71,13,10,26,10,1]).toString("base64")}});
  });
  assert.equal(browserCalled,true);
  assert.equal(browser.rendered.htmlHash,await sha256(renderedHtml));
  assert.equal(await validateRenderedPage(browser.rendered,url),true);
  assert.equal(await validateRenderedPage({...browser.rendered,html:"changed"},url),false);
  const snapshot = await captureWebsite(url,async () => new Response(source,{headers:{"content-type":"text/html"}}));
  snapshot.renderedRoot = browser.rendered;
  const raw = JSON.stringify(snapshot);
  const manifest = JSON.stringify(snapshotManifest(snapshot));
  assert.ok(await validateSnapshot(raw,await sha256(raw),manifest,url));
  const criteria = [{label:"Catalog available",kind:"contains",needle:"Catalog now open"}];
  const live = [{url,status:200,body:source,renderedRoot:browser.rendered}];
  assert.equal(evaluateSnapshot(criteria,snapshot,live)[0].status,"VERIFIED");
  assert.equal(evaluateSnapshot(criteria,snapshot,[{url,status:200,body:source}])[0].status,"INCONCLUSIVE");
});
