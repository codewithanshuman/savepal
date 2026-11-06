import assert from "node:assert/strict";
import test from "node:test";
import { beginSellerOnboarding } from "../lib/seller-onboarding.ts";

test("a confirmed seller connection repairs an interrupted project update", async () => {
  const merchant = "CG5RZJV4NR5P4";
  const record = {id:"onboarding-1",project_id:"project-1",freelancer_email:"worker@example.com",
    tracking_id:"tracking-1",referral_id:"referral-1",merchant_id:merchant,status:"VERIFIED"};
  const writes = [];
  const db = { prepare(sql) { return { bind(...values) { return {
    async first() {
      if (sql.startsWith("SELECT * FROM seller_onboarding")) return record;
      if (sql.startsWith("SELECT audit_head_hash")) return {audit_head_hash:null};
      throw new Error(`Unexpected query: ${sql}`);
    },
    async run() { writes.push({sql,values}); return {meta:{changes:1}}; },
  }; } }; } };
  const client = { async getSellerIntegration(partner,seller) {
    assert.equal(partner,"PARTNER123456"); assert.equal(seller,merchant);
    return {merchant_id:merchant,tracking_id:record.tracking_id,payments_receivable:true,
      primary_email_confirmed:true,oauth_integrations:[{oauth_third_party:[{
        partner_client_id:"client-1",scopes:["https://uri.paypal.com/services/payments/realtimepayment"],
      }]}]};
  } };
  const result = await beginSellerOnboarding(db,
    {id:"project-1",freelancer_email:"worker@example.com",status:"AGREED",paypal_order_id:null,seller_merchant_id:null},
    "worker@example.com",client,"https://savepal.example/api/p/return","PARTNER123456","client-1");
  assert.deepEqual(result,{trackingId:"tracking-1",connected:true});
  assert.ok(writes.some(write => write.sql.startsWith("UPDATE projects SET seller_merchant_id")));
  assert.ok(writes.some(write => write.sql.startsWith("INSERT INTO audit_events")));
});
