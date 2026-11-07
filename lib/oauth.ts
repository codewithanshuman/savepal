import type { SessionUser } from "./session.ts";

export type Provider = "github" | "google";
export type ProviderConfig = { clientId: string; clientSecret: string };
export const PROVIDERS: Record<Provider, { label: string }> = { google: { label: "Google" }, github: { label: "GitHub" } };

export function isProvider(value: unknown): value is Provider {
  return value === "github" || value === "google";
}

export function callbackUrl(origin: string, provider: Provider): string {
  return new URL(`/auth/${provider}/callback`, origin).toString();
}

export function authorizeUrl(provider: Provider, config: ProviderConfig, redirectUri: string, state: string): string {
  const url = provider === "github"
    ? new URL("https://github.com/login/oauth/authorize")
    : new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  if (provider === "github") {
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("allow_signup", "true");
  } else {
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("prompt", "select_account");
  }
  return url.toString();
}

/** Profile pictures only from the providers' own image hosts, over HTTPS. */
export function safeAvatar(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 600) return null;
  try {
    const url = new URL(value);
    const ok = url.protocol === "https:" && (url.hostname === "avatars.githubusercontent.com" || url.hostname.endsWith(".googleusercontent.com"));
    return ok ? url.toString() : null;
  } catch { return null; }
}

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what} failed (HTTP ${response.status})`);
  return await response.json() as T;
}

/**
 * Exchanges the authorization code and returns the signed-in identity. Only a provider-verified
 * email is accepted, because SavePal matches the freelancer on an agreement by email.
 */
export async function completeSignIn(
  provider: Provider, config: ProviderConfig, code: string, redirectUri: string, fetcher: typeof fetch = fetch,
): Promise<SessionUser> {
  if (!code || code.length > 512) throw new Error("Missing authorization code");
  const form = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri });
  const headers = { Accept: "application/json", "User-Agent": "SavePal" };
  if (provider === "github") {
    const token = await json<{ access_token?: string; error?: string }>(
      await fetcher("https://github.com/login/oauth/access_token", { method: "POST", headers, body: form }), "GitHub token exchange");
    if (!token.access_token) throw new Error(`GitHub sign-in was not completed${token.error ? ` (${token.error})` : ""}`);
    const auth = { ...headers, Authorization: `Bearer ${token.access_token}` };
    const user = await json<{ id: number; login: string; name: string | null; avatar_url?: string }>(await fetcher("https://api.github.com/user", { headers: auth }), "GitHub profile");
    const emails = await json<Array<{ email: string; primary: boolean; verified: boolean }>>(await fetcher("https://api.github.com/user/emails", { headers: auth }), "GitHub email lookup");
    const email = emails.find(e => e.primary && e.verified)?.email;
    if (!email) throw new Error("Your GitHub account needs a verified primary email");
    if (!Number.isSafeInteger(user.id)) throw new Error("GitHub returned an invalid account");
    return { uid: `github:${user.id}`, email: email.toLowerCase(), name: user.name || user.login, provider, avatar: safeAvatar(user.avatar_url) };
  }
  form.set("grant_type", "authorization_code");
  const token = await json<{ access_token?: string }>(
    await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers, body: form }), "Google token exchange");
  if (!token.access_token) throw new Error("Google sign-in was not completed");
  const info = await json<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(
    await fetcher("https://openidconnect.googleapis.com/v1/userinfo", { headers: { ...headers, Authorization: `Bearer ${token.access_token}` } }), "Google profile");
  if (!info.sub || !info.email || info.email_verified !== true) throw new Error("Your Google account needs a verified email");
  return { uid: `google:${info.sub}`, email: info.email.toLowerCase(), name: info.name || null, provider, avatar: safeAvatar(info.picture) };
}
