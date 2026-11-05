import assert from "node:assert/strict";
import test from "node:test";
import { aiInput, reviewWithAi, validateAiAssessments } from "../lib/ai-verification.ts";
import { captureWebsite, evaluateSnapshot } from "../lib/website-evidence.ts";

const html = '<html><body><p>Blue shirt available</p><form><button>Checkout</button></form></body></html>';
const criteria = [
  {label:"Blue shirt listed",kind:"contains",needle:"Blue shirt"},
  {label:"Checkout completes a purchase",kind:"manual"},
];

test("AI review is bound to cited pages and cannot change objective status", async () => {
  const snapshot = await captureWebsite("https://shop.example.org/",async () => new Response(html,{headers:{"content-type":"text/html"}}));
  const live = [{url:snapshot.rootUrl,status:200,body:html}];
  const findings = evaluateSnapshot(criteria,snapshot,live);
  const output = {assessments:[
    {criterionIndex:0,assessment:"SUPPORTED",evidenceIds:["P1"],quote:"Blue shirt available",explanation:"The product phrase is present in submitted and live text."},
    {criterionIndex:1,assessment:"UNKNOWN",evidenceIds:["P1"],quote:"",explanation:"The form does not prove a completed purchase."},
  ]};
  let request;
  const fetcher = async (_url,options) => {
    request = JSON.parse(options.body);
    return Response.json({id:"resp_test",status:"completed",output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  };
  const review = await reviewWithAi("test-key","gpt-4o-mini",criteria,findings,snapshot,live,"Freelancer notes",fetcher);
  assert.equal(review.status,"COMPLETED");
  assert.equal(review.assessments.length,2);
  assert.equal(review.responseId,"resp_test");
  assert.ok(review.inputHash && review.outputHash);
  assert.equal(findings[1].status,"INCONCLUSIVE");
  assert.equal(request.store,false);
  assert.equal(request.text.format.type,"json_schema");
  assert.equal(aiInput(criteria,findings,snapshot,live,"x").pages[0].id,"P1");
});

test("invalid citations, duplicate indices, and incomplete responses fail closed", async () => {
  const snapshot = await captureWebsite("https://shop.example.org/",async () => new Response(html,{headers:{"content-type":"text/html"}}));
  const live = [{url:snapshot.rootUrl,status:200,body:html}];
  const finding = {criterionIndex:0,assessment:"SUPPORTED",evidenceIds:["P1"],quote:"Blue shirt available",explanation:"Supported."};
  assert.equal(validateAiAssessments({assessments:[{...finding,evidenceIds:["P9"]},{...finding,criterionIndex:1}]},2,snapshot,live),null);
  assert.equal(validateAiAssessments({assessments:[finding,finding]},2,snapshot,live),null);
  assert.equal(validateAiAssessments({assessments:[finding,{...finding,criterionIndex:1}]},2,snapshot,[{...live[0],status:503}]),null);
  assert.equal(validateAiAssessments({assessments:[{...finding,quote:"Nonexistent product"},{...finding,criterionIndex:1}]},2,snapshot,live),null);
  const failed = await reviewWithAi("test-key","gpt-4o-mini",criteria,evaluateSnapshot(criteria,snapshot,live),snapshot,live,"",async () => Response.json({status:"incomplete",output:[]}));
  assert.equal(failed.status,"FAILED");
  assert.equal(failed.assessments.length,0);
});
