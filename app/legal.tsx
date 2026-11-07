import type { ReactNode } from "react";

export const CONTACT_EMAIL = "codewithanshuman@gmail.com";
export const UPDATED = "7 November 2026";

/** Shared shell for the privacy policy and terms pages: plain, readable, printable. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return <div className="legal">
    <header className="legal-top">
      <a href="/" className="legal-brand">savepal</a>
      <nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/app">Workspace</a></nav>
    </header>
    <main className="legal-body">
      <h1>{title}</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>
      {children}
    </main>
  </div>;
}
