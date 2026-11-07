# SavePal

SavePal links a locked website milestone, evidence, objective verification, a client decision, and a PayPal **sandbox** payment.

## What works

- ChatGPT sign-in and server-side client/freelancer access checks
- Client-created milestones with locked scope, USD amount, an agreed revision limit, and 1–8 criteria, each marked required or optional
- Eight objective check types replayable offline from the snapshot: reachable, text present, text absent, page title, link or button label, named page path, no broken pages, and human review. Absence and "not found" are only claimed when every captured page was read, submitted and live.
- Two-sided consent: a terms hash binds the client at creation and the freelancer at acceptance (the freelancer must echo the hash they reviewed). Any later change to locked terms freezes approval and payment.
- Acceptance policy: a failed required criterion blocks approval unless the client records an explicit override, which is written into the receipt; unproven required criteria need a confirmation note
- Revision intelligence: per-criterion improved/regressed history across verification runs, a progress score, detection of regressions without a new submission, and enforcement of the revision limit
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
- PayPal partner seller referral and return callback: the assigned freelancer connects a sandbox seller account, provider integration permissions are checked, and the recipient merchant ID is frozen on the payment request. Checkout and capture validate the provider's payee against that bound recipient. A merchant-only configuration is explicitly labelled as a merchant payment.
- Client-triggered reconciliation, plus a token-protected batch endpoint for an external scheduler. Each attempt is recorded, and unsafe retries after the provider's idempotency window require review.
- A replayable verification artifact stores the exact bounded live pages and objective findings hash. Agreement members can download a proof bundle and verify the objective result offline.
- Optional Cloudflare Browser Run capture of the rendered root DOM and a private screenshot at both submission and verification. Rendered evidence participates in whole-phrase checks and carries content and image hashes.
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
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0005_shiny_jean_grey.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0006_fantastic_changeling.sql
npm run dev -- --port 5174
```

Open the printed local URL, then visit `/signin-with-chatgpt?return_to=/` for the starter's local test identity. Hosted authentication is supplied by Sites.

## Hosted configuration

Set `PAYPAL_CLIENT_ID` (browser-safe), `PAYPAL_CLIENT_SECRET` (secret), and `PAYPAL_WEBHOOK_ID` (secret) in Sites runtime environment variables. Use a PayPal **sandbox** REST app. Register `https://YOUR-SITE/api/paypal/webhook` for capture completed, pending, denied, declined, refunded, and partially refunded events. The app never calls PayPal live endpoints. Refund state advances from completed to partially refunded or refunded; the observation history retains each provider response.

For direct merchant sandbox checkout, set `PAYPAL_MERCHANT_ID` to the REST app owner's 13-character sandbox merchant ID. This sends money to that merchant, so it is not a freelancer payout. For freelancer-directed checkout, use a PayPal multiparty partner app and set `PAYPAL_PARTNER_MERCHANT_ID` (partner merchant ID), `PAYPAL_PARTNER_BN_CODE`, and `SITE_ORIGIN` (public HTTPS origin). The freelancer then connects their sandbox seller account through PayPal. Checkout stays unavailable until PayPal confirms receivable status, email, third-party payment permission, and the app's client ID. Partner access and sandbox seller accounts must be obtained from PayPal; adding keys alone cannot grant partner capability.

For scheduled recovery, set `RECONCILIATION_TOKEN` to a random secret of at least 32 characters and arrange an external scheduler to POST `/api/reconcile` with `Authorization: Bearer <token>` every 15 minutes. The scheduler also needs access to the private Site. The endpoint processes up to five stale approved payment requests per call. Without that scheduler, clients can use **Reconcile with PayPal** inside an agreement. Attempts and review-required outcomes are retained in D1.

To capture JavaScript-rendered evidence, set `BROWSER_RUN_ACCOUNT_ID` and secret `BROWSER_RUN_API_TOKEN` with Browser Run permission for that Cloudflare account. When configured, submission and verification require a successful Browser Run capture. Without these values, SavePal checks bounded server HTML only; it does not infer rendered content. Screenshots remain private in R2 and are served only to agreement members through `/api/evidence?projectId=...&submissionId=...&view=screenshot` or `/api/verification-proof?projectId=...&runId=...&screenshot=submission|verification`.

`OPENAI_API_KEY` is optional and must be a secret. `OPENAI_MODEL` defaults to `gpt-4o-mini`. When configured, bounded website text and freelancer notes are sent to the OpenAI Responses API for criterion-by-criterion review. Without the key, objective verification still works and manual checks remain inconclusive. AI review failure also leaves objective results intact.

`AUDIT_HMAC_KEY` should be a random, persistent 32-byte-or-longer secret. Keep it stable across deployments; changing it invalidates verification of earlier audit hashes. The hosted Site uses a generated secret. Local development without one uses a plain SHA-256 chain, which detects accidental edits but is weaker against someone with database write access.

The `BUCKET` R2 binding holds private JSON evidence snapshots. Keep this bucket private. The database stores page hashes and metadata; snapshot bodies are never served without agreement membership checks.

Agreement members can request `GET /api/verification-proof?projectId=...&runId=...&download=1` and save the JSON response. Run `node scripts/verify-proof-bundle.mjs path/to/downloaded-proof.json` to replay the objective findings and check the receipt and audit links. This offline check does not requery PayPal or validate the audit HMAC without the server secret. Keep the exported JSON and any rendered screenshots together for independent review. For database recovery, use Cloudflare D1 Time Travel and restore the matching R2 evidence objects; verify a recovered run with the same proof endpoint before accepting payments.

The new hosted Site is private by default. The invited freelancer must be allowed to visit the Site and sign in with the email specified in the agreement. Site access and agreement membership are separate controls.

## Demo flow

1. Client creates a milestone and enters the freelancer's account email.
2. Freelancer signs in, accepts the locked terms, and submits a public HTTPS URL plus notes.
3. Client runs verification and inspects each result.
4. Client approves or requests a revision.
5. After approval, client uses the PayPal sandbox button. The app records payment as complete only after PayPal reports a completed capture.

## Scope and limits

This hackathon implementation focuses on one website milestone per agreement. Snapshot checks read up to six pages of server-returned HTML, bounded at 100 KB per page. Browser Run can additionally render the root page, but it does not simulate a checkout, prove responsive behavior, or crawl an entire JavaScript app. Structural signals and AI assessments guide human review; manual checks stay inconclusive. A site with more than six discovered pages has partial coverage, so missing text is inconclusive. Evidence is a private website snapshot plus notes, not uploaded files. Payment uses immediate sandbox capture after buyer approval, not escrow or a long-lived authorization hold. The app has no production payment mode.

PayPal credentials and a separate sandbox buyer account are required for an end-to-end transaction test. The order and capture retry window is five hours from the first request; after that, the API requires reconciliation instead of blindly repeating a potentially charged operation. Do not describe payment or AI integration as verified until that test is run.

Run `npm test` for deterministic domain checks. With the local preview running on port 5174 and migrations applied, run `tests/api-smoke.ps1`, `tests/evidence-smoke.ps1`, `tests/verification-smoke.ps1`, and `tests/payment-smoke.ps1` from PowerShell for synthetic agreement creation, permission rejection, a real snapshot submission, verification-run persistence, snapshot binding, audit integrity, and missing-credentials payment checks. For the built local Worker on port 8787, set `SAVEPAL_BASE_URL=http://127.0.0.1:8787` and run `tests/proof-smoke.ps1`; it exercises submission, verification, outsider rejection, offline proof replay before and after approval, and the checkout credential gate. These scripts write test data only to local D1 and R2. No real sandbox capture has been tested without credentials.

The partner flow requires PayPal-granted multiparty access and cannot be exercised end to end without those sandbox credentials and a sandbox seller. No sandbox transaction or seller onboarding has been claimed as tested until those credentials are supplied.
