/**
 * Stateless, HMAC-signed tokens for the session cookie and the short-lived OAuth state cookie.
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)). Verification uses
 * crypto.subtle.verify, which compares in constant time.
 */

export const SESSION_COOKIE = "sp_session";
export const STATE_COOKIE = "sp_oauth";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const STATE_TTL_SECONDS = 10 * 60;

export type SessionUser = { uid: string; email: string; name: string | null; provider: "github" | "google"; avatar?: string | null };
export type OAuthState = { state: string; provider: "github" | "google"; returnTo: string };
type Signed<T> = T & { kind: string; exp: number };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
    return Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch { return null; }
}

async function key(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign<T extends object>(kind: string, payload: T, ttlSeconds: number, secret: string, now = Date.now()): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify({ ...payload, kind, exp: Math.floor(now / 1000) + ttlSeconds })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

async function verify<T>(kind: string, token: string | null | undefined, secret: string, now = Date.now()): Promise<T | null> {
  if (!token || token.length > 4096) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const signature = fromBase64Url(sig), raw = fromBase64Url(body);
  if (!signature || !raw) return null;
  if (!await crypto.subtle.verify("HMAC", await key(secret), signature, encoder.encode(body))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(raw)) as Signed<T>;
    if (payload.kind !== kind || typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    const { kind: _kind, exp: _exp, ...rest } = payload;
    return rest as T;
  } catch { return null; }
}

export const signSession = (user: SessionUser, secret: string, now?: number) => sign("session", user, SESSION_TTL_SECONDS, secret, now);
export async function verifySession(token: string | null | undefined, secret: string, now?: number): Promise<SessionUser | null> {
  const user = await verify<SessionUser>("session", token, secret, now);
  return user && typeof user.uid === "string" && typeof user.email === "string" && (user.provider === "github" || user.provider === "google") ? user : null;
}
export const signState = (state: OAuthState, secret: string, now?: number) => sign("oauth-state", state, STATE_TTL_SECONDS, secret, now);
export const verifyState = (token: string | null | undefined, secret: string, now?: number) => verify<OAuthState>("oauth-state", token, secret, now);

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Same-site relative path only; anything else (absolute URLs, `//host`, auth routes) falls back to /app. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/app";
  try {
    const url = new URL(value, "https://savepal.invalid");
    if (url.origin !== "https://savepal.invalid" || /^\/(auth|signin|signout)(\/|$)/.test(url.pathname)) return "/app";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/app"; }
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
