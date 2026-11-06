"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, CircleDollarSign, FileCheck2, Fingerprint, Link2, LockKeyhole, Plus, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";

const nav = [
  { href: "#top", label: "Home" },
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#roles", label: "For teams" },
  { href: "#faq", label: "FAQ" },
];

const steps = [
  { title: "Agreement", body: "The client writes the milestone, amount and up to eight acceptance criteria. Terms lock the moment it is created.", icon: LockKeyhole },
  { title: "Evidence", body: "The freelancer accepts and submits a live HTTPS URL. SavePal snapshots up to six pages and hashes each one.", icon: Link2 },
  { title: "Verification", body: "Every page is rechecked live. Each criterion gets its own finding, tied to page hashes and quoted text.", icon: Sparkles },
  { title: "Decision", body: "The client approves or asks for a revision. Either way, an immutable receipt records exactly what was decided.", icon: FileCheck2 },
  { title: "Payment", body: "Approval unlocks PayPal sandbox checkout, bound to the receipt. Paid means PayPal confirmed the capture.", icon: CircleDollarSign },
];

const faqs = [
  { q: "Does SavePal move real money?", a: "No. SavePal only talks to PayPal sandbox endpoints. It is built to demonstrate a verifiable path from delivery to payment, and has no production payment mode." },
  { q: "Who decides whether the work is accepted?", a: "The client, always. Objective checks and the optional AI review prepare evidence, but they cannot approve work or authorize payment on their own." },
  { q: "What exactly gets verified?", a: "Each criterion is checked against a time-stamped snapshot of the submitted site: HTTPS reachability, whole-phrase text matches in visible HTML, or a flag for human review. Anything that can't be proven is marked inconclusive." },
  { q: "Can someone change the record after the fact?", a: "Agreements, submissions and receipts are immutable, and every agreement keeps an append-only audit hash chain. An optional HMAC key protects that chain against database-only tampering." },
  { q: "Can I check a result without trusting the server?", a: "Yes. Agreement members can download a proof bundle and replay the objective findings offline with the included verification script." },
];

function Logo() {
  return <a href="#top" className="lp-logo" aria-label="SavePal home">
    <span className="lp-logo-mark"><PlaneGlyph /></span>
    <span className="lp-logo-word">savepal</span>
  </a>;
}

function PlaneGlyph({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M21.6 2.6 2.9 10.1c-.8.3-.8 1.5.1 1.7l6.4 1.8 1.8 6.4c.2.9 1.4 1 1.7.1l7.5-18.7c.2-.5-.3-1-.8-.8Z" fill="currentColor" />
    <path d="m9.4 13.6 5.2-5.2" stroke="var(--lp-plane-crease, #2f6fdc)" strokeWidth="1.6" strokeLinecap="round" />
  </svg>;
}

function PaperPlane({ className }: { className: string }) {
  return <div className={`lp-flyer ${className}`} aria-hidden="true">
    <svg viewBox="0 0 120 60" className="lp-flyer-plane">
      <path d="M2 30 118 4 52 40Z" fill="#fff" />
      <path d="M52 40 118 4 60 56Z" fill="#dfe9fb" />
      <path d="M52 40 60 56 44 44Z" fill="#c4d5f3" />
    </svg>
  </div>;
}

function Cloud({ className }: { className: string }) {
  return <div className={`lp-cloud ${className}`} aria-hidden="true"><span /><span /><span /><span /></div>;
}

function HeroMock() {
  const lines = [
    { t: "Reachable over HTTPS", d: "200 OK · TLS valid" },
    { t: "Contains “Products”", d: "Visible text · /shop" },
    { t: "Checkout can be completed", d: "Client review" },
  ];
  return <div className="lp-mock" data-reveal="up" style={{ ["--d" as string]: "500ms" }}>
    <div className="lp-mock-side">
      <div className="lp-mock-crumb">← Workspace <b>/ Agreements</b></div>
      <div className="lp-mock-title">Agreements <span>3</span></div>
      {[
        { n: "Website implementation", s: "Ready to verify", c: "#ffd34e" },
        { n: "Landing refresh", s: "Approved", c: "#6fd3a0" },
        { n: "Docs portal", s: "Awaiting delivery", c: "#9ec0ff" },
      ].map((a, i) => <div key={a.n} className={`lp-mock-item ${i === 0 ? "on" : ""}`}>
        <span className="lp-mock-dot" style={{ background: a.c }} />
        <div><b>{a.n}</b><small>{a.s}</small></div>
      </div>)}
    </div>
    <div className="lp-mock-main">
      <div className="lp-mock-head">
        <span className="lp-mock-ava">WI</span>
        <div><b>Website implementation</b><small>Snapshot · 4 pages · SHA-256 9f3c…a1</small></div>
        <span className="lp-mock-amt">$1,000</span>
      </div>
      <div className="lp-mock-feed">
        <div className="lp-mock-date">Verification run · v2</div>
        {lines.map((l, i) => <div className="lp-mock-check" key={l.t} style={{ ["--i" as string]: i }}>
          <span className={`lp-mock-tick ${i === 2 ? "amber" : ""}`}>{i === 2 ? "?" : <Check size={11} strokeWidth={3} />}</span>
          <div><b>{l.t}</b><small>{l.d}</small></div>
        </div>)}
        <div className="lp-mock-bubble">Approved — releasing $1,000 via PayPal sandbox</div>
      </div>
    </div>
  </div>;
}

export default function Landing() {
  const heroRef = useRef<HTMLElement>(null);
  const stepsRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("#top");
  const [role, setRole] = useState<"client" | "freelancer">("client");
  const [open, setOpen] = useState<number | null>(0);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
    els.forEach(el => io.observe(el));

    const sections = nav.map(n => document.querySelector(n.href)).filter(Boolean) as Element[];
    const spy = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(`#${e.target.id}`); });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach(s => spy.observe(s));

    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 24);
        const s = stepsRef.current;
        if (s) {
          const r = s.getBoundingClientRect();
          const p = Math.min(1, Math.max(0, (window.innerHeight * 0.7 - r.top) / (r.height * 0.85)));
          s.style.setProperty("--p", p.toFixed(3));
        }
        const h = heroRef.current;
        if (h) h.style.setProperty("--sy", String(Math.min(window.scrollY, 900)));
      });
    };
    const onMove = (e: PointerEvent) => {
      const h = heroRef.current;
      if (!h) return;
      h.style.setProperty("--mx", ((e.clientX / window.innerWidth) - 0.5).toFixed(3));
      h.style.setProperty("--my", ((e.clientY / window.innerHeight) - 0.5).toFixed(3));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { io.disconnect(); spy.disconnect(); window.removeEventListener("scroll", onScroll); window.removeEventListener("pointermove", onMove); cancelAnimationFrame(frame); };
  }, []);

  const headline = [["Ship", "the", "work."], ["Watch", "it", "get", "paid."]];
  let w = 0;

  return <div className="lp">
    <header className={`lp-nav ${scrolled ? "is-scrolled" : ""} ${menu ? "is-open" : ""}`}>
      <Logo />
      <nav className="lp-pill" aria-label="Main">
        {nav.map(n => <a key={n.href} href={n.href} className={active === n.href ? "on" : ""} onClick={() => setMenu(false)}>{n.label}</a>)}
      </nav>
      <a href="/app" className="lp-nav-cta"><ShieldCheck size={16} /> Open workspace</a>
      <button className="lp-burger" aria-label="Toggle menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><span /><span /></button>
    </header>

    <section id="top" className="lp-hero" ref={heroRef}>
      <div className="lp-sky" />
      <div className="lp-grain" />
      <Cloud className="c1" />
      <Cloud className="c2" />
      <PaperPlane className="f1" />
      <PaperPlane className="f2" />
      <svg className="lp-trail" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
        <path id="lp-trail-a" d="M-60 720 C 260 560, 420 520, 620 600 S 1040 520, 1500 240" />
      </svg>

      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <p className="lp-kicker" data-reveal="fade"><span className="lp-live" /> Work assurance for freelance milestones</p>
          <h1 className="lp-h1" aria-label="Ship the work. Watch it get paid.">
            {headline.map((line, li) => <span className="lp-h1-line" key={li}>
              {line.map(word => { const i = w++; return <span className="lp-word" key={word + i} style={{ ["--w" as string]: i }}><span>{word}</span></span>; })}
            </span>)}
          </h1>
          <div className="lp-hero-actions" data-reveal="up" style={{ ["--d" as string]: "650ms" }}>
            <a href="/app" className="lp-cta">Start an agreement <span><ArrowRight size={18} /></span></a>
            <a href="#how" className="lp-link">See how it works</a>
          </div>
        </div>

        <div className="lp-device" data-reveal="fade" style={{ ["--d" as string]: "800ms" }}>
          <div className="lp-device-frame">
            <span className="lp-device-mark"><PlaneGlyph /></span>
            <div className="lp-device-seal">
              <svg viewBox="0 0 100 100" className="lp-ring"><circle cx="50" cy="50" r="44" /></svg>
              <Check size={34} strokeWidth={2.6} />
            </div>
            <div className="lp-device-row"><i /><i className="mid"><Fingerprint size={14} /></i><i /></div>
          </div>
          <div className="lp-device-base" />
          <p>Milestone<br />verified</p>
        </div>

        <p className="lp-tag" data-reveal="fade" style={{ ["--d" as string]: "900ms" }}>Clear scope meets<br />verifiable delivery</p>

        <HeroMock />

        <div className="lp-badge" data-reveal="fade" style={{ ["--d" as string]: "1000ms" }}>
          <div className="lp-stamp">
            <svg viewBox="0 0 120 120"><defs><path id="lp-circle" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" /></defs>
              <text><textPath href="#lp-circle">HASH-CHAINED · TAMPER-EVIDENT · AUDIT · </textPath></text></svg>
            <LockKeyhole size={22} />
          </div>
          <strong>SHA-256</strong>
          <span>Every page, every receipt</span>
        </div>
      </div>
      <a href="#how" className="lp-scroll" aria-label="Scroll down"><ChevronDown size={18} /></a>
    </section>

    <div className="lp-marquee" aria-hidden="true">
      <div className="lp-marquee-track">
        {[0, 1].map(k => <div key={k}>
          {["Locked scope", "Evidence snapshots", "Live re-verification", "Per-criterion findings", "Approval receipts", "PayPal sandbox", "Hash-chained audit", "Offline proof replay"].map(t => <span key={t}><PlaneGlyph className="lp-mq-plane" />{t}</span>)}
        </div>)}
      </div>
    </div>

    <section id="how" className="lp-section lp-how" ref={stepsRef}>
      <div className="lp-head" data-reveal="up">
        <p className="lp-eyebrow">How it works</p>
        <h2 className="lp-h2">From scope to settlement,<br /><em>in five honest steps.</em></h2>
        <p className="lp-lead">Each step leaves a record the next one depends on, so nobody has to take anything on trust.</p>
      </div>
      <div className="lp-steps">
        <div className="lp-rail"><div className="lp-rail-fill" /><span className="lp-rail-plane"><PlaneGlyph /></span></div>
        {steps.map((s, i) => <article key={s.title} className="lp-step" data-reveal="up" style={{ ["--d" as string]: `${i * 90}ms` }}>
          <div className="lp-step-top"><span className="lp-step-n">{String(i + 1).padStart(2, "0")}</span><span className="lp-step-ic"><s.icon size={18} /></span></div>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </article>)}
      </div>
    </section>

    <section id="features" className="lp-section lp-features">
      <div className="lp-head" data-reveal="up">
        <p className="lp-eyebrow">Built for proof</p>
        <h2 className="lp-h2">Evidence that holds up,<br /><em>even when people disagree.</em></h2>
      </div>
      <div className="lp-bento">
        <article className="lp-card lp-card-wide lp-card-sky" data-reveal="up">
          <div className="lp-card-copy">
            <span className="lp-chip"><Sparkles size={13} /> Live verification</span>
            <h3>Every criterion, its own verdict.</h3>
            <p>Pages are rechecked live and each finding is tied to page hashes and a quoted excerpt. Whole-phrase matches ignore scripts, hidden elements and lookalikes.</p>
          </div>
          <div className="lp-verdicts">
            {[["Reachable over HTTPS", "verified"], ["Contains “Products”", "verified"], ["Footer shows © 2026", "failed"], ["Checkout works end-to-end", "inconclusive"]].map(([t, s], i) =>
              <div key={t} className={`lp-verdict ${s}`} style={{ ["--i" as string]: i }}><span />{t}<em>{s}</em></div>)}
          </div>
        </article>
        <article className="lp-card" data-reveal="up" style={{ ["--d" as string]: "80ms" }}>
          <span className="lp-chip"><LockKeyhole size={13} /> Locked scope</span>
          <h3>Terms freeze at creation.</h3>
          <p>Amount, scope and 1–8 criteria lock the moment the agreement exists. No quiet goalpost moving.</p>
          <div className="lp-lock"><span className="lp-lock-shackle" /><span className="lp-lock-body"><LockKeyhole size={20} /></span></div>
        </article>
        <article className="lp-card" data-reveal="up" style={{ ["--d" as string]: "120ms" }}>
          <span className="lp-chip"><Fingerprint size={13} /> Snapshots</span>
          <h3>Hashed the moment it ships.</h3>
          <p>Up to six same-origin pages per submission, each with a SHA-256 hash and structural signals.</p>
          <code className="lp-hash">sha256:<span>9f3c2e7ab41d0c5e</span>…</code>
        </article>
        <article className="lp-card" data-reveal="up" style={{ ["--d" as string]: "160ms" }}>
          <span className="lp-chip"><ReceiptText size={13} /> Receipts</span>
          <h3>Decisions you can cite.</h3>
          <p>Approvals hash the agreement, exact submission, findings, approver, reason and amount.</p>
          <div className="lp-receipt"><i /><i /><i /><b>APPROVED</b></div>
        </article>
        <article className="lp-card lp-card-wide lp-card-pay" data-reveal="up" style={{ ["--d" as string]: "200ms" }}>
          <div className="lp-card-copy">
            <span className="lp-chip"><CircleDollarSign size={13} /> PayPal sandbox</span>
            <h3>Paid means PayPal said so.</h3>
            <p>Checkout is bound to the approval receipt and the freelancer&apos;s verified seller account. Ambiguous responses are reconciled with the provider, never guessed.</p>
          </div>
          <div className="lp-chain">
            {["Receipt", "Order", "Capture", "Webhook"].map((t, i) => <div key={t} className="lp-chain-node" style={{ ["--i" as string]: i }}><span>{i + 1}</span>{t}</div>)}
          </div>
        </article>
      </div>

      <div className="lp-numbers">
        {[["1–8", "criteria per milestone"], ["6", "pages per snapshot"], ["100 KB", "bounded per page"], ["0", "live payment endpoints"]].map(([n, l], i) =>
          <div key={l} data-reveal="up" style={{ ["--d" as string]: `${i * 70}ms` }}><strong>{n}</strong><span>{l}</span></div>)}
      </div>
    </section>

    <section id="roles" className="lp-section lp-roles">
      <div className="lp-roles-card" data-reveal="up">
        <div className="lp-roles-copy">
          <p className="lp-eyebrow">For both sides of the deal</p>
          <h2 className="lp-h2">Fair to the client.<br /><em>Fair to the freelancer.</em></h2>
          <div className="lp-toggle" role="tablist">
            <span className={`lp-toggle-bg ${role}`} />
            <button role="tab" aria-selected={role === "client"} onClick={() => setRole("client")}>I hire</button>
            <button role="tab" aria-selected={role === "freelancer"} onClick={() => setRole("freelancer")}>I deliver</button>
          </div>
        </div>
        <ul className="lp-roles-list" key={role}>
          {(role === "client"
            ? ["Write criteria before work starts, so ‘done’ is defined upfront", "Inspect findings with quoted evidence, not vibes", "Approve or request a revision with a recorded reason", "Pay only after you decide, through PayPal sandbox"]
            : ["Know exactly what will be checked before you start", "Submit a live URL; the snapshot proves what you shipped and when", "See the same findings your client sees", "Get paid to your own verified PayPal seller account"]
          ).map((t, i) => <li key={t} style={{ ["--i" as string]: i }}><span><Check size={14} strokeWidth={3} /></span>{t}</li>)}
        </ul>
      </div>
    </section>

    <section id="faq" className="lp-section lp-faq">
      <div className="lp-head" data-reveal="up">
        <p className="lp-eyebrow">Questions</p>
        <h2 className="lp-h2">The straight answers.</h2>
      </div>
      <div className="lp-faq-list">
        {faqs.map((f, i) => <div key={f.q} className={`lp-faq-item ${open === i ? "open" : ""}`} data-reveal="up" style={{ ["--d" as string]: `${i * 60}ms` }}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>{f.q}<span><Plus size={18} /></span></button>
          <div className="lp-faq-a"><div><p>{f.a}</p></div></div>
        </div>)}
      </div>
    </section>

    <section className="lp-final">
      <div className="lp-final-card" data-reveal="up">
        <div className="lp-final-sky" />
        <Cloud className="c4" />
        <Cloud className="c5" />
        <PaperPlane className="f3" />
        <h2>Ready when<br />the work is.</h2>
        <p>Create your first agreement in under a minute.</p>
        <a href="/app" className="lp-cta">Open your workspace <span><ArrowUpRight size={18} /></span></a>
      </div>
    </section>

    <footer className="lp-footer">
      <Logo />
      <p>Prove the work. Approve with confidence. Pay with PayPal sandbox.</p>
      <span>© {new Date().getFullYear()} SavePal · Sandbox only</span>
    </footer>
  </div>;
}
