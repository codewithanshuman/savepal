import { redirect } from "next/navigation";
import { devSignInAvailable, enabledProviders, getUser } from "../auth";
import { safeReturnPath } from "../../lib/session";
import { PROVIDERS, type Provider } from "../../lib/oauth";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  expired: "That sign-in link expired. Please try again.",
  cancelled: "Sign-in was cancelled.",
  unverified: "Your account needs a verified email address. Verify it with the provider, then try again.",
  failed: "We couldn’t complete sign-in. Please try again.",
  unavailable: "That sign-in option isn’t set up yet.",
};

function ProviderIcon({ provider }: { provider: Provider }) {
  return provider === "github"
    ? <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>
    : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"/></svg>;
}

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const returnTo = safeReturnPath(typeof params.return_to === "string" ? params.return_to : "/app");
  if (await getUser()) redirect(returnTo);
  const providers = enabledProviders();
  const error = typeof params.error === "string" ? errors[params.error] : undefined;
  const query = `?return_to=${encodeURIComponent(returnTo)}`;
  return <main className="signin">
    <a href="/" className="signin-brand">savepal</a>
    <section className="signin-card">
      <h1>Sign in to SavePal</h1>
      <p className="signin-sub">Use the account whose email your client invited, or any account to create agreements.</p>
      {error && <p className="signin-error" role="alert">{error}</p>}
      <div className="signin-options">
        {providers.map(p => <a key={p} href={`/auth/${p}${query}`} className="signin-btn"><ProviderIcon provider={p} />Continue with {PROVIDERS[p].label}</a>)}
        {devSignInAvailable() && <a href={`/signin-with-chatgpt${query}`} className="signin-btn signin-dev">Continue as local test user</a>}
        {!providers.length && !devSignInAvailable() && <p className="signin-error">Sign-in isn’t configured on this server yet.</p>}
      </div>
      <p className="signin-note">We only read your name and verified email. Payments run in the PayPal sandbox; no real money moves. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
    </section>
  </main>;
}
