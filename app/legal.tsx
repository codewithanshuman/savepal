import type { ReactNode } from "react";

export const CONTACT_EMAIL = "codewithanshuman@gmail.com";
export const UPDATED = "7 November 2026";

/** Shared shell for the privacy policy and terms pages: plain, readable, printable. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return <div className="legal">
    <header className="legal-top">
      <a href="/" className="legal-brand"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2.5 4 5.6v6.1c0 4.7 3.3 8.6 8 9.8 4.7-1.2 8-5.1 8-9.8V5.6L12 2.5Zm-1.2 13.2-3.6-3.6 1.4-1.4 2.2 2.2 4.6-4.6 1.4 1.4-6 6Z"/></svg>savepal</a>
      <nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/app">Workspace</a></nav>
    </header>
    <main className="legal-body">
      <h1>{title}</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      {children}
    </main>
  </div>;
}
