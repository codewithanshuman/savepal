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
  { title: "Agree and secure funds", body: "The client sets what “done” means and reserves the payment with PayPal before work starts.", icon: LockKeyhole },
  { title: "Deliver a live link", body: "The freelancer submits the website. SavePal keeps a time-stamped copy of it.", icon: Link2 },
  { title: "Check every requirement", body: "Each requirement is checked automatically, with the proof shown beside it.", icon: ScanSearch },
  { title: "Approve and release", body: "The client approves, and PayPal releases the held money to the freelancer.", icon: CircleDollarSign },
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
  { q: "What happens to the money before the work is approved?", a: "PayPal holds it on the client’s account; nothing is charged yet. The freelancer can decline and release it at any time, and the client can cancel only before any work has been submitted. A PayPal hold lasts up to 29 days." },
  { q: "Who decides whether the work is accepted?", a: "The client, always. Automatic checks prepare the evidence, but they never approve work or release payment on their own." },
  { q: "What can SavePal check automatically?", a: "Whether the site loads, whether certain text appears or must not appear, the page title, a specific button or link, a specific page, and broken pages. Anything it can’t prove is marked “needs review” instead of guessed." },
  { q: "What if a requirement fails but I still want to approve?", a: "You can, but you have to say why. That reason is saved with the approval so both sides can see it." },
  { q: "Can anyone change the record afterwards?", a: "No. Agreements, submissions and approvals are permanent, and any change to the agreed terms is detected and freezes payment." },
];

const paypalPoints = [
  { title: "Secured before work starts", body: "The client reserves the payment with PayPal up front. The freelancer starts knowing the money is there.", icon: LockKeyhole },
  { title: "Tied to the agreement", body: "The hold is bound to the exact agreed terms, and the release carries the client’s approval.", icon: ReceiptText },
  { title: "Paid means PayPal confirmed", body: "A milestone counts as paid only once PayPal confirms it. Updates from PayPal, refunds included, keep it in sync.", icon: CircleDollarSign },
];

function Logo({ dark }: { dark?: boolean }) {
  return <a href="#top" className={`lp-logo ${dark ? "dark" : ""}`} aria-label="SavePal home">savepal</a>;
}

function PayPalMark({ className }: { className?: string }) {
  return <img src="/paypal-logo.webp" alt="PayPal" className={className} width={2000} height={511} />;
}

function ProductPreview() {
  const agreements = [
    { name: "Online store", who: "Maya Chen", status: "Ready to pay", tone: "pay", on: true },
    { name: "Landing page", who: "Leo Park", status: "Paid", tone: "paid" },
    { name: "Docs portal", who: "Sam Ortiz", status: "In review", tone: "review" },
  ];
  const checks = [
    ["Website loads securely", "200 OK · live"],
    ["Product catalog is on the site", "“Products” on /shop"],
    ["No placeholder text left", "6 of 6 pages read"],
  ];
  return <div className="lp-mock" aria-hidden="true">
    <div className="lp-mock-side">
      <p className="lp-mock-title">Agreements <span>{agreements.length}</span></p>
      {agreements.map(a => <div key={a.name} className={`lp-mock-row ${a.on ? "on" : ""}`}>
        <span className="lp-mock-ava">{a.who.split(" ").map(w => w[0]).join("")}</span>
        <div><b>{a.name}</b><small><i className={`dot ${a.tone}`} />{a.status}</small></div>
      </div>)}
    </div>
    <div className="lp-mock-main">
      <div className="lp-mock-head">
        <div><b>Online store</b><small>Maya Chen · freelancer</small></div>
        <strong>$1,000.00</strong>
      </div>
      <div className="lp-mock-progress"><span>Requirements</span><em>3 of 3 met</em><div><i /></div></div>
      <ul className="lp-mock-checks">
        {checks.map(([t, d]) => <li key={t}><span className="lp-mock-ok" /><div><b>{t}</b><small>{d}</small></div><em>Verified</em></li>)}
      </ul>
      <div className="lp-mock-pay">
        <span>Approve and release with</span>
        <span className="lp-mock-pp"><PayPalMark /></span>
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
      <button className="lp-burger" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><span /><span /></button>
    </header>

    <section id="top" className="lp-hero">
      <div className="lp-hero-grid">
        <div className="lp-hero-copy">
          <h1>Ship the work.<br />Get it paid.</h1>
          <a href="/app" className="lp-cta">Start an agreement <span><ArrowRight size={17} /></span></a>
        </div>
      </div>
      <div className="lp-mock-wrap"><ProductPreview /></div>
    </section>

    <section className="lp-built" aria-label="Built with PayPal">
      <span>Payments built with</span><PayPalMark className="lp-built-logo" />
    </section>

    <section id="paypal" className="lp-section lp-paypal">
      <div className="lp-head" data-reveal>
        <p className="lp-eyebrow">Powered by PayPal</p>
        <h2>The money moves only when the work is proven</h2>
        <p className="lp-lead">PayPal isn’t an add-on here. It holds the money before work starts, ties it to the agreement, and confirms when it’s paid.</p>
      </div>
      <div className="lp-pp-grid">
        {paypalPoints.map((p, i) => <article key={p.title} className="lp-pp-card" data-reveal style={{ ["--d" as string]: `${i * 70}ms` }}>
          <span className="lp-pp-n">{String(i + 1).padStart(2, "0")}</span>
          <p.icon size={22} className="lp-pp-icon" />
          <h3>{p.title}</h3>
          <p>{p.body}</p>
        </article>)}
      </div>
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
          <div><h4>Trust</h4><a href="#faq">How checks work</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a></div>
          <div><h4>Connect</h4><a href="https://github.com/codewithanshuman/savepal" target="_blank" rel="noopener noreferrer" className="lp-social"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>GitHub</a></div>
        </div>
        <div className="lp-footer-copy"><span>© {new Date().getFullYear()} SavePal · PayPal sandbox</span><span className="lp-footer-built">Built with <PayPalMark /></span></div>
        <div className="lp-footer-art" aria-hidden="true" />
      </div>
    </footer>
  </div>;
}
