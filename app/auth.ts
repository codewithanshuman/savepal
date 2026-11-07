import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PROVIDERS, type Provider, type ProviderConfig } from "../lib/oauth";
import { SESSION_COOKIE, readCookie, safeReturnPath, verifySession } from "../lib/session";

export type AppUser = { userId: string; displayName: string; email: string; fullName: string | null; avatar: string | null };

type AuthEnv = {
  SESSION_SECRET?: string; SITE_ORIGIN?: string;
  GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
};
const cfg = env as Cloudflare.Env & AuthEnv;

/** Local development only: the Vite "sites" plugin signs in a fixed test user from localhost. */
const DEV_MOCK = import.meta.env.DEV;
const DEV_HEADERS = { id: "oai-authenticated-user-id", email: "oai-authenticated-user-email", name: "oai-authenticated-user-full-name", encoding: "oai-authenticated-user-full-name-encoding" };

export function sessionSecret(): string | null {
  return cfg.SESSION_SECRET && cfg.SESSION_SECRET.length >= 32 ? cfg.SESSION_SECRET : null;
}

export function providerConfig(provider: Provider): ProviderConfig | null {
  const id = provider === "github" ? cfg.GITHUB_CLIENT_ID : cfg.GOOGLE_CLIENT_ID;
  const secret = provider === "github" ? cfg.GITHUB_CLIENT_SECRET : cfg.GOOGLE_CLIENT_SECRET;
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

export function enabledProviders(): Provider[] {
  return sessionSecret() ? (Object.keys(PROVIDERS) as Provider[]).filter(p => providerConfig(p)) : [];
}

/** Public origin used for OAuth callbacks; SITE_ORIGIN wins so a proxy can't change it. */
export function siteOrigin(request: Request): string {
  return cfg.SITE_ORIGIN ? new URL(cfg.SITE_ORIGIN).origin : new URL(request.url).origin;
}

export const devSignInAvailable = () => DEV_MOCK;

/**
 * The signed-in user. In production this is only ever the signed session cookie; identity headers
 * are ignored, so a request cannot claim to be someone else.
 */
export async function getUser(): Promise<AppUser | null> {
  const requestHeaders = await headers();
  const secret = sessionSecret();
  if (secret) {
    const session = await verifySession(readCookie(requestHeaders.get("cookie"), SESSION_COOKIE), secret);
    if (session) return { userId: session.uid, email: session.email, displayName: session.name || session.email, fullName: session.name, avatar: session.avatar ?? null };
  }
  if (DEV_MOCK) {
    const userId = requestHeaders.get(DEV_HEADERS.id), email = requestHeaders.get(DEV_HEADERS.email);
    if (userId && email) {
      const raw = requestHeaders.get(DEV_HEADERS.name);
      let fullName: string | null = null;
      if (raw && requestHeaders.get(DEV_HEADERS.encoding) === "percent-encoded-utf-8") { try { fullName = decodeURIComponent(raw); } catch { fullName = null; } }
      return { userId, email, displayName: fullName ?? email, fullName, avatar: null };
    }
  }
  return null;
}

export async function requireUser(returnTo: string): Promise<AppUser> {
  const user = await getUser();
  if (user) return user;
  redirect(signInPath(returnTo));
}

export function signInPath(returnTo: string): string {
  return `/signin?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}
