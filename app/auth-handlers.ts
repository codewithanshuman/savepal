import { devSignInAvailable, providerConfig, sessionSecret, siteOrigin } from "./auth";
import { authorizeUrl, callbackUrl, completeSignIn, type Provider } from "../lib/oauth";
import {
  SESSION_COOKIE, SESSION_TTL_SECONDS, STATE_COOKIE, STATE_TTL_SECONDS,
  cookie, randomToken, readCookie, safeReturnPath, signSession, signState, verifyState,
} from "../lib/session";

function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

const failure = (origin: string, reason: string, returnTo = "/app") =>
  redirectTo(new URL(`/signin?error=${reason}&return_to=${encodeURIComponent(returnTo)}`, origin).toString());

/** GET /auth/{provider}: sends the browser to the provider with a signed, single-use state. */
export async function startSignIn(request: Request, provider: Provider): Promise<Response> {
  const origin = siteOrigin(request);
  const url = new URL(request.url);
  const returnTo = safeReturnPath(url.searchParams.get("return_to"));
  const secret = sessionSecret(), config = providerConfig(provider);
  if (!secret || !config) return failure(origin, "unavailable", returnTo);
  const state = randomToken();
  const stateCookie = cookie(STATE_COOKIE, await signState({ state, provider, returnTo }, secret), STATE_TTL_SECONDS, origin.startsWith("https:"));
  return redirectTo(authorizeUrl(provider, config, callbackUrl(origin, provider), state), [stateCookie]);
}

/** GET /auth/{provider}/callback: checks state, exchanges the code and starts a session. */
export async function finishSignIn(request: Request, provider: Provider): Promise<Response> {
  const origin = siteOrigin(request);
  const secure = origin.startsWith("https:");
  const url = new URL(request.url);
  const secret = sessionSecret(), config = providerConfig(provider);
  if (!secret || !config) return failure(origin, "unavailable");
  const saved = await verifyState(readCookie(request.headers.get("cookie"), STATE_COOKIE), secret);
  const clearState = cookie(STATE_COOKIE, "", 0, secure);
  if (!saved || saved.provider !== provider || url.searchParams.get("state") !== saved.state) return failure(origin, "expired");
  if (url.searchParams.get("error")) return failure(origin, "cancelled", saved.returnTo);
  try {
    const user = await completeSignIn(provider, config, url.searchParams.get("code") || "", callbackUrl(origin, provider));
    const session = cookie(SESSION_COOKIE, await signSession(user, secret), SESSION_TTL_SECONDS, secure);
    return redirectTo(new URL(saved.returnTo, origin).toString(), [clearState, session]);
  } catch (error) {
    const reason = error instanceof Error && /verified/i.test(error.message) ? "unverified" : "failed";
    return failure(origin, reason, saved.returnTo);
  }
}

/** POST /signout: ends the session. POST-only so other sites can't sign people out with a link. */
export function signOut(request: Request): Response {
  const origin = siteOrigin(request);
  const sameOrigin = request.headers.get("origin");
  if (sameOrigin && sameOrigin !== origin) return new Response("Forbidden", { status: 403 });
  // Locally, also end the dev test user's mock session.
  const next = devSignInAvailable() ? "/signout-with-chatgpt?return_to=%2F" : "/";
  return redirectTo(new URL(next, origin).toString(), [cookie(SESSION_COOKIE, "", 0, origin.startsWith("https:"))]);
}
