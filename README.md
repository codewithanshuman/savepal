# SavePal

SavePal links a locked website milestone, evidence, objective verification, a client decision, and a PayPal **sandbox** payment.

## What works

- ChatGPT sign-in and server-side client/freelancer access checks
- Client-created milestones with locked scope, USD amount, and 1–8 criteria
- Freelancer acceptance and HTTPS evidence submission with a private, time-stamped website snapshot
- Up to six bounded, same-origin pages per submission, selected with the locked criteria in mind, each with a SHA-256 hash and structural signals
- Immutable submission records and an inspectable snapshot manifest; the raw snapshot is available to agreement members at `GET /api/evidence?projectId=...&submissionId=...`
- Verification rechecks every captured page live and ties each finding to page hashes and a normalized text excerpt. Whole-phrase matches use visible HTML text and exclude scripts, hidden elements, and substring lookalikes. Unrelated page changes do not invalidate a supported phrase; removed or unavailable evidence becomes inconclusive.
- Versioned verification runs bound to the exact submission and snapshot hashes, with crash recovery after five minutes
- Append-only, per-agreement audit hash chains; optional HMAC key protects against database-only tampering
- Optional structured OpenAI review of each criterion, with page IDs and quotes validated against submitted and live evidence. The model's assessments are advisory and cannot change objective results or authorize payment; input, output, model, and response hashes are retained with the run.
- Client approval or revision request, with an immutable receipt hashing the agreement, exact submission, verification findings, approver, reason, and amount
- PayPal sandbox order creation bound to the approval receipt, buyer approval, capture, exact provider-side order and capture validation, and bounded idempotent retries
- Provider reconciliation after ambiguous responses, webhook recovery of captures before local persistence, and append-only payment observations with webhook replay checks
- Durable D1 storage
- Conditional state transitions to reject concurrent approvals, resubmissions, and stale verification results

## Local development

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_handy_shinobi_shaw.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_sharp_valeria_richards.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_clammy_baron_strucker.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0003_late_bloodscream.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0004_foamy_kate_bishop.sql
npm run dev -- --port 5174
```

Open the printed local URL, then visit `/signin-with-chatgpt?return_to=/` for the starter's local test identity. Hosted authentication is supplied by Sites.

## Hosted configuration

Set `PAYPAL_CLIENT_ID` (browser-safe), `PAYPAL_CLIENT_SECRET` (secret), and `PAYPAL_WEBHOOK_ID` (secret) in Sites runtime environment variables. Use a PayPal **sandbox** REST app. Register `https://YOUR-SITE/api/paypal/webhook` for capture completed, pending, denied, declined, refunded, and partially refunded events. The app never calls PayPal live endpoints. Refund state advances from completed to partially refunded or refunded; the observation history retains each provider response.

`OPENAI_API_KEY` is optional and must be a secret. `OPENAI_MODEL` defaults to `gpt-4o-mini`. When configured, bounded website text and freelancer notes are sent to the OpenAI Responses API for criterion-by-criterion review. Without the key, objective verification still works and manual checks remain inconclusive. AI review failure also leaves objective results intact.

`AUDIT_HMAC_KEY` should be a random, persistent 32-byte-or-longer secret. Keep it stable across deployments; changing it invalidates verification of earlier audit hashes. The hosted Site uses a generated secret. Local development without one uses a plain SHA-256 chain, which detects accidental edits but is weaker against someone with database write access.

The `BUCKET` R2 binding holds private JSON evidence snapshots. Keep this bucket private. The database stores page hashes and metadata; snapshot bodies are never served without agreement membership checks.

The new hosted Site is private by default. The invited freelancer must be allowed to visit the Site and sign in with the email specified in the agreement. Site access and agreement membership are separate controls.

## Demo flow

1. Client creates a milestone and enters the freelancer's account email.
2. Freelancer signs in, accepts the locked terms, and submits a public HTTPS URL plus notes.
3. Client runs verification and inspects each result.
4. Client approves or requests a revision.
5. After approval, client uses the PayPal sandbox button. The app records payment as complete only after PayPal reports a completed capture.

## Scope and limits

This hackathon MVP focuses on one website milestone per agreement. Snapshot checks read up to six pages of server-returned HTML, bounded at 100 KB per page. They do not execute browser JavaScript, apply external CSS to determine visibility, simulate a mobile device, or prove a checkout flow. Structural signals and AI assessments guide human review; manual checks stay inconclusive. A site with more than six discovered pages has partial coverage, so missing text is inconclusive. Evidence is a private website snapshot plus notes, not uploaded files. Payment uses immediate sandbox capture after buyer approval, not escrow or a long-lived authorization hold. The app has no production payment mode.

PayPal credentials and a separate sandbox buyer account are required for an end-to-end transaction test. The order and capture retry window is five hours from the first request; after that, the API requires reconciliation instead of blindly repeating a potentially charged operation. Do not describe payment or AI integration as verified until that test is run.

Run `npm test` for deterministic domain checks. With the local preview running on port 5174 and migrations applied, run `tests/api-smoke.ps1`, `tests/evidence-smoke.ps1`, `tests/verification-smoke.ps1`, and `tests/payment-smoke.ps1` from PowerShell for synthetic agreement creation, permission rejection, a real snapshot submission, verification-run persistence, snapshot binding, audit integrity, and missing-credentials payment checks. These scripts write test data only to local D1 and R2. No real sandbox capture has been tested without credentials.

The PayPal checkout currently settles to the sandbox merchant account that owns the configured REST app. Paying a different freelancer account requires PayPal partner/multiparty onboarding and seller permission; that routing is outside this MVP. Never present a merchant capture as proof the freelancer received funds.
