import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage } from "../legal";

export const metadata: Metadata = { title: "Privacy policy · SavePal" };

export default function Privacy() {
  return <LegalPage title="Privacy policy">
    <p>SavePal helps a client and a freelancer agree on a website milestone, check the delivered site, record the client’s decision and run a PayPal <strong>sandbox</strong> (test) payment. This page explains what we collect and why.</p>

    <h2>What we collect</h2>
    <ul>
      <li><strong>Sign-in details.</strong> When you sign in with Google or GitHub we receive your account ID, your name and your verified email address. We do not receive your password.</li>
      <li><strong>Agreement content.</strong> Titles, descriptions, amounts, acceptance criteria, decisions and reasons that you or the other party enter.</li>
      <li><strong>Evidence.</strong> When a freelancer submits a website, we save a time-stamped copy of up to six public pages of that site, and screenshots where enabled, so both sides can check the same evidence later.</li>
      <li><strong>Payment references.</strong> PayPal sandbox order and capture IDs and their status. We never see or store card or bank details; PayPal handles checkout.</li>
      <li><strong>Activity records.</strong> A tamper-evident log of actions on each agreement (who did what, and when).</li>
    </ul>

    <h2>How we use it</h2>
    <p>Only to run SavePal: to sign you in, show you the agreements you belong to, verify delivered work, record decisions and process sandbox payments. We do not sell your data, show ads or build marketing profiles.</p>

    <h2>Who can see it</h2>
    <ul>
      <li>An agreement and its evidence are visible only to its client and its invited freelancer.</li>
      <li>Our service providers process data on our behalf: Cloudflare (hosting and storage), Google or GitHub (sign-in) and PayPal (sandbox payments).</li>
      <li>If optional AI review is enabled, the text of submitted website pages and the freelancer’s notes are sent to OpenAI to prepare advisory comments. AI comments never approve work or release payment.</li>
    </ul>

    <h2>Cookies</h2>
    <p>We use one essential cookie to keep you signed in for up to 7 days, and a short-lived cookie (10 minutes) that protects the sign-in step. We use no advertising or analytics cookies.</p>

    <h2>How long we keep it</h2>
    <p>Agreements, evidence and activity records are kept so the record stays verifiable for both parties. Because both sides rely on the same record, an agreement is not edited after the fact. You can ask us to delete your account information at any time; we will remove what we can without breaking the other party’s record and tell you what must remain.</p>

    <h2>Your choices</h2>
    <p>You can sign out at any time, and revoke SavePal’s access in your Google or GitHub account settings. To ask for a copy or deletion of your data, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>

    <h2>Changes</h2>
    <p>If this policy changes, we will update the date at the top of this page.</p>
  </LegalPage>;
}
