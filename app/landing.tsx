"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, CircleDollarSign, Fingerprint, GitCompareArrows, Link2, ListChecks, LockKeyhole, Plus, ReceiptText, ScanSearch, ShieldCheck } from "lucide-react";

const nav = [
  { href: "#top", label: "Home" },
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

const steps = [
  { title: "Agree on the work", body: "The client sets the amount and what “done” means. Both sides lock the same terms.", icon: LockKeyhole },
  { title: "Deliver a live link", body: "The freelancer submits the website. SavePal keeps a time-stamped copy of it.", icon: Link2 },
  { title: "Check every requirement", body: "Each requirement is checked automatically, with the proof shown beside it.", icon: ScanSearch },
  { title: "Approve and pay", body: "The client approves, then pays with PayPal. Every step stays on the record.", icon: CircleDollarSign },
];

const features = [
  { title: "Clear requirements", body: "Turn “build my site” into a checklist both sides agree to before work starts.", icon: ListChecks },
  { title: "Proof you can see", body: "Every result shows the page and the exact text it was based on.", icon: ScanSearch },
  { title: "Fair approvals", body: "A failed must-have requirement can’t be quietly waved through.", icon: ShieldCheck },
  { title: "Same terms for both", body: "Client and freelancer are bound to identical terms, confirmed by a fingerprint.", icon: Fingerprint },
  { title: "Revision history", body: "See what improved between versions, and how many rounds are left.", icon: GitCompareArrows },
  { title: "A record that holds up", body: "Decisions and receipts can’t be edited later, so there’s nothing to argue about.", icon: ReceiptText },
];

const faqs = [
  { q: "Does SavePal move real money?", a: "No. SavePal only uses the PayPal sandbox, PayPal’s test environment. It shows the full path from delivery to payment without charging anyone." },
  { q: "Who decides whether the work is accepted?", a: "The client, always. Automatic checks prepare the evidence, but they never approve work or release payment on their own." },
  { q: "What can SavePal check automatically?", a: "Whether the site loads, whether certain text appears or must not appear, the page title, a specific button or link, a specific page, and broken pages. Anything it can’t prove is marked “needs review” instead of guessed." },
  { q: "What if a requirement fails but I still want to approve?", a: "You can, but you have to say why. That reason is saved with the approval so both sides can see it." },
  { q: "Can anyone change the record afterwards?", a: "No. Agreements, submissions and approvals are permanent, and any change to the agreed terms is detected and freezes payment." },
];

function Mark() {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2.5 4 5.6v6.1c0 4.7 3.3 8.6 8 9.8 4.7-1.2 8-5.1 8-9.8V5.6L12 2.5Zm-1.2 13.2-3.6-3.6 1.4-1.4 2.2 2.2 4.6-4.6 1.4 1.4-6 6Z"/></svg>;
}

function Logo({ dark }: { dark?: boolean }) {
  return <a href="#top" className={`lp-logo ${dark ? "dark" : ""}`} aria-label="SavePal home"><Mark /><span>savepal</span></a>;
}

function ProductPreview() {
  return <div className="lp-mock" aria-hidden="true">
    <div className="lp-mock-side">
      <p className="lp-mock-crumb">Workspace / <b>Agreements</b></p>
      <p className="lp-mock-title">Agreements <span>3</span></p>
      {[["Online store", "Ready to approve", "on"], ["Landing page", "Paid"], ["Docs portal", "In progress"]].map(([n, s, on]) =>
        <div key={n} className={`lp-mock-row ${on ? "on" : ""}`}><span className="lp-mock-dot" /><div><b>{n}</b><small>{s}</small></div></div>)}
    </div>
    <div className="lp-mock-main">
      <div className="lp-mock-head">
        <div><b>Online store</b><small>Checked against the live site · 2 min ago</small></div>
        <span>$1,000</span>
      </div>
      <div className="lp-mock-feed">
        {["Website loads securely", "Product catalog is on the site", "No placeholder text left"].map(t =>
          <div key={t} className="lp-mock-check"><span><Check size={11} strokeWidth={3} /></span>{t}</div>)}
        <div className="lp-mock-note">All requirements met — ready to pay</div>
      </div>
    </div>
  </div>;
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("#top");
  const [open, setOpen] = useState<number | null>(0);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const reveal = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("is-in"); reveal.unobserve(e.target); }
    }), { threshold: 0.12 });
    document.querySelectorAll("[data-reveal]").forEach(el => reveal.observe(el));
    const spy = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) setActive(`#${e.target.id}`); }),
      { rootMargin: "-45% 0px -50% 0px" });
    nav.forEach(n => { const el = document.querySelector(n.href); if (el) spy.observe(el); });
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { reveal.disconnect(); spy.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, []);

  return <div className="lp">
    <header className={`lp-nav ${scrolled ? "solid" : ""} ${menu ? "open" : ""}`}>
      <Logo dark={scrolled} />
      <nav className="lp-pill" aria-label="Main">
        {nav.map(n => <a key={n.href} href={n.href} className={active === n.href ? "on" : ""} onClick={() => setMenu(false)}>{n.label}</a>)}
      </nav>
      <a href="/app" className="lp-nav-cta"><ShieldCheck size={16} /> Open workspace</a>
      <button className="lp-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><span /><span /></button>
    </header>

    <section id="top" className="lp-hero">
      <div className="lp-hero-grid">
        <div className="lp-hero-copy">
          <h1>Ship the work.<br />Get it paid.</h1>
          <a href="/app" className="lp-cta">Start an agreement <span><ArrowRight size={17} /></span></a>
        </div>

        <div className="lp-device">
          <div className="lp-device-frame">
            <span className="lp-device-mark"><Mark /></span>
            <span className="lp-device-seal"><Check size={30} strokeWidth={2.6} /></span>
            <span className="lp-device-label">3 of 3 verified</span>
          </div>
          <p>Checked<br />before you pay</p>
        </div>

        <p className="lp-tagline">Clear terms meet<br />work you can prove</p>

        <div className="lp-badge">
          <span className="lp-badge-icon"><ShieldCheck size={24} /></span>
          <strong>PayPal</strong>
          <small>Sandbox checkout</small>
        </div>
      </div>
      <div className="lp-mock-wrap"><ProductPreview /></div>
    </section>

    <section id="how" className="lp-section">
      <div className="lp-head" data-reveal>
        <p className="lp-eyebrow">How it works</p>
        <h2>From agreement to payment, in four steps</h2>
      </div>
      <ol className="lp-steps">
        {steps.map((s, i) => <li key={s.title} data-reveal style={{ ["--d" as string]: `${i * 70}ms` }}>
          <span className="lp-step-top"><span className="lp-step-n">{String(i + 1).padStart(2, "0")}</span><s.icon size={20} /></span>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </li>)}
      </ol>
    </section>

    <section id="features" className="lp-section">
      <div className="lp-head" data-reveal>
        <p className="lp-eyebrow">Why SavePal</p>
        <h2>Less back-and-forth. Fewer disputes.</h2>
        <p className="lp-lead">Both sides see the same requirements, the same evidence and the same decision.</p>
      </div>
      <div className="lp-grid">
        {features.map((f, i) => <article key={f.title} className="lp-card" data-reveal style={{ ["--d" as string]: `${(i % 3) * 70}ms` }}>
          <span className="lp-icon"><f.icon size={20} /></span>
          <h3>{f.title}</h3>
          <p>{f.body}</p>
        </article>)}
      </div>
    </section>

    <section id="faq" className="lp-section lp-faq">
      <div className="lp-head" data-reveal>
        <p className="lp-eyebrow">FAQ</p>
        <h2>Common questions</h2>
      </div>
      <div className="lp-faq-list">
        {faqs.map((f, i) => <div key={f.q} className={`lp-faq-item ${open === i ? "open" : ""}`}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{f.q}<Plus size={18} /></button>
          <div className="lp-faq-a"><div><p>{f.a}</p></div></div>
        </div>)}
      </div>
    </section>

    <section className="lp-closing" data-reveal>
      <h2>Ready when the work is.</h2>
      <p>Create your first agreement in about a minute. No real money moves while you try it.</p>
      <a href="/app" className="lp-cta">Get started <span><ArrowRight size={17} /></span></a>
    </section>

    <footer className="lp-footer">
      <div className="lp-footer-card">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <Logo dark />
            <p>SavePal links a clear agreement, proof of the delivered work, the client’s decision and a PayPal sandbox payment, so both sides can trust the outcome.</p>
          </div>
          <div className="lp-footer-start">
            <h3>Try it now</h3>
            <div className="lp-footer-start-row">
              <span>Create an agreement and invite your freelancer.</span>
              <a href="/app" className="lp-footer-btn">Start</a>
            </div>
            <p>Sandbox only. No real money moves.</p>
          </div>
        </div>
        <div className="lp-footer-links">
          <div><h4>Product</h4><a href="#how">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a></div>
          <div><h4>Workspace</h4><a href="/app">Sign in</a><a href="/app">New agreement</a><a href="/app">Activity</a></div>
          <div><h4>Trust</h4><a href="#faq">How checks work</a><a href="#faq">Who decides</a><a href="#faq">Record keeping</a></div>
          <div><h4>Connect</h4><a href="https://github.com/codewithanshuman/savepal" target="_blank" rel="noopener noreferrer" className="lp-social"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>GitHub</a></div>
        </div>
        <p className="lp-footer-copy">© {new Date().getFullYear()} SavePal. Built for the PayPal sandbox.</p>
        <div className="lp-footer-art" aria-hidden="true" />
      </div>
    </footer>
  </div>;
}
