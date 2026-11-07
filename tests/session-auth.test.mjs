import assert from "node:assert/strict";
import test from "node:test";
import { cookie, readCookie, safeReturnPath, signSession, signState, verifySession, verifyState } from "../lib/session.ts";
import { authorizeUrl, callbackUrl, completeSignIn } from "../lib/oauth.ts";

const secret = "s".repeat(40);
const user = { uid: "github:42", email: "dev@example.org", name: "Dev", provider: "github" };

test("sessions verify, expire, and reject tampering or the wrong secret", async () => {
  const token = await signSession(user, secret, 1_000_000);
  assert.deepEqual(await verifySession(token, secret, 1_000_000), user);
  assert.equal(await verifySession(token, secret, 1_000_000 + 8 * 86_400_000), null, "expired after 7 days");
  assert.equal(await verifySession(token, "x".repeat(40), 1_000_000), null, "wrong secret");
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...user, uid: "github:1", kind: "session", exp: 9e9 })).toString("base64url");
  assert.equal(await verifySession(`${forged}.${sig}`, secret, 1_000_000), null, "payload swap");
  assert.equal(await verifySession(`${body}.${sig}x`, secret, 1_000_000), null, "bad signature");
  assert.equal(await verifySession("garbage", secret), null);
  assert.equal(await verifySession(null, secret), null);
  await assert.rejects(() => signSession(user, "short"), /32 characters/);
});

test("state tokens cannot be used as sessions, and vice versa", async () => {
  const state = await signState({ state: "abc", provider: "google", returnTo: "/app" }, secret);
  assert.equal(await verifySession(state, secret), null);
  assert.equal(await verifyState(await signSession(user, secret), secret), null);
  assert.equal((await verifyState(state, secret))?.state, "abc");
  assert.equal(await verifyState(state, secret, Date.now() + 11 * 60_000), null, "state expires after 10 minutes");
});

test("return paths stay on this site and avoid auth routes", () => {
  assert.equal(safeReturnPath("/app?project=1#x"), "/app?project=1#x");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "/signin", "/auth/github", "/signout", 42, null])
    assert.equal(safeReturnPath(bad), "/app", String(bad));
});

test("cookies are HttpOnly, Lax, and Secure on https", () => {
  assert.match(cookie("a", "b c", 60, true), /^a=b%20c; Path=\/; Max-Age=60; HttpOnly; SameSite=Lax; Secure$/);
  assert.doesNotMatch(cookie("a", "b", 60, false), /Secure/);
  assert.equal(readCookie("x=1; sp_session=ab%2Ec; y=2", "sp_session"), "ab.c");
  assert.equal(readCookie("x=1", "sp_session"), null);
});

test("authorize URLs carry state and the exact callback", () => {
  const cb = callbackUrl("https://savepal.example.org", "google");
  assert.equal(cb, "https://savepal.example.org/auth/google/callback");
  const url = new URL(authorizeUrl("google", { clientId: "id", clientSecret: "s" }, cb, "st"));
  assert.equal(url.hostname, "accounts.google.com");
  assert.deepEqual([url.searchParams.get("state"), url.searchParams.get("redirect_uri"), url.searchParams.get("scope")], ["st", cb, "openid email profile"]);
  assert.equal(new URL(authorizeUrl("github", { clientId: "id", clientSecret: "s" }, cb, "st")).hostname, "github.com");
});

const respond = map => async (url, init) => {
  const body = map[String(url)];
  if (!body) throw new Error(`unexpected ${url}`);
  if (init?.headers?.Authorization) assert.equal(init.headers.Authorization, "Bearer tok");
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

test("GitHub sign-in requires a verified primary email", async () => {
  const base = { "https://github.com/login/oauth/access_token": { access_token: "tok" }, "https://api.github.com/user": { id: 7, login: "octo", name: null } };
  const ok = await completeSignIn("github", { clientId: "i", clientSecret: "s" }, "code", "cb",
    respond({ ...base, "https://api.github.com/user/emails": [{ email: "x@y.org", primary: false, verified: true }, { email: "Octo@Example.org", primary: true, verified: true }] }));
  assert.deepEqual(ok, { uid: "github:7", email: "octo@example.org", name: "octo", provider: "github" });
  await assert.rejects(() => completeSignIn("github", { clientId: "i", clientSecret: "s" }, "code", "cb",
    respond({ ...base, "https://api.github.com/user/emails": [{ email: "o@e.org", primary: true, verified: false }] })), /verified/);
});

test("Google sign-in requires email_verified", async () => {
  const token = { "https://oauth2.googleapis.com/token": { access_token: "tok" } };
  const ok = await completeSignIn("google", { clientId: "i", clientSecret: "s" }, "code", "cb",
    respond({ ...token, "https://openidconnect.googleapis.com/v1/userinfo": { sub: "99", email: "A@B.org", email_verified: true, name: "A" } }));
  assert.equal(ok.uid, "google:99");
  assert.equal(ok.email, "a@b.org");
  await assert.rejects(() => completeSignIn("google", { clientId: "i", clientSecret: "s" }, "code", "cb",
    respond({ ...token, "https://openidconnect.googleapis.com/v1/userinfo": { sub: "99", email: "a@b.org", email_verified: false } })), /verified/);
  await assert.rejects(() => completeSignIn("google", { clientId: "i", clientSecret: "s" }, "", "cb", respond({})), /code/);
});
