# SavePal

SavePal links a locked website milestone, evidence, objective verification, a client decision, and a PayPal **sandbox** payment.

## What works

- ChatGPT sign-in and server-side client/freelancer access checks
- Client-created milestones with locked scope, USD amount, and 1–8 criteria
- Freelancer acceptance and HTTPS evidence submission
- SHA-256 submission fingerprint and time-stamped audit events
- Bounded HTTP reachability and HTML text checks, with explicit manual/inconclusive findings
- Versioned verification runs bound to the exact evidence hash, with crash recovery after five minutes
- Append-only, per-agreement audit hash chains; optional HMAC key protects against database-only tampering
- Optional structured OpenAI report summary; model text cannot change check results or authorize payment
- Client approval or revision request
- PayPal sandbox order creation, buyer approval, capture, amount validation, stable idempotency keys, and verified webhook ingestion
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
npm run dev -- --port 5174
```

Open the printed local URL, then visit `/signin-with-chatgpt?return_to=/` for the starter's local test identity. Hosted authentication is supplied by Sites.

## Hosted configuration

Set `PAYPAL_CLIENT_ID` (browser-safe), `PAYPAL_CLIENT_SECRET` (secret), and `PAYPAL_WEBHOOK_ID` (secret) in Sites runtime environment variables. Use a PayPal **sandbox** REST app. Register `https://YOUR-SITE/api/paypal/webhook` for capture completed, pending, and denied events. The app never calls PayPal live endpoints.

`OPENAI_API_KEY` is optional and must be a secret. `OPENAI_MODEL` defaults to `gpt-4o-mini`. Without the key, objective verification still works and the report labels manual checks inconclusive.

`AUDIT_HMAC_KEY` should be a random, persistent 32-byte-or-longer secret. Keep it stable across deployments; changing it invalidates verification of earlier audit hashes. The hosted Site uses a generated secret. Local development without one uses a plain SHA-256 chain, which detects accidental edits but is weaker against someone with database write access.

The new hosted Site is private by default. The invited freelancer must be allowed to visit the Site and sign in with the email specified in the agreement. Site access and agreement membership are separate controls.

## Demo flow

1. Client creates a milestone and enters the freelancer's account email.
2. Freelancer signs in, accepts the locked terms, and submits a public HTTPS URL plus notes.
3. Client runs verification and inspects each result.
4. Client approves or requests a revision.
5. After approval, client uses the PayPal sandbox button. The app records payment as complete only after PayPal reports a completed capture.

## Scope and limits

This hackathon MVP focuses on one website milestone per agreement. The HTML text check reads server-returned markup; it does not execute browser JavaScript or prove a checkout flow. Manual checks stay inconclusive. Evidence is a URL and notes, not uploaded files. Payment uses immediate sandbox capture after buyer approval, not escrow or a long-lived authorization hold. The app has no production payment mode.

PayPal credentials and a separate sandbox buyer account are required for an end-to-end transaction test. Do not describe payment or AI integration as verified until that test is run.

Run `npm test` for deterministic domain checks. With the local preview running on port 5174 and migrations applied, run `tests/api-smoke.ps1`, `tests/verification-smoke.ps1`, and `tests/payment-smoke.ps1` from PowerShell for synthetic agreement creation, permission rejection, verification-run persistence, audit integrity, and missing-credentials payment checks. These scripts write test data only to local D1. No real sandbox capture has been tested without credentials.

The PayPal checkout currently settles to the sandbox merchant account that owns the configured REST app. Paying a different freelancer account requires PayPal partner/multiparty onboarding and seller permission; that routing is outside this MVP. Never present a merchant capture as proof the freelancer received funds.
