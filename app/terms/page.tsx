import type { Metadata } from "next";
import { CONTACT_EMAIL, LegalPage } from "../legal";

export const metadata: Metadata = { title: "Terms of service · SavePal" };

export default function Terms() {
  return <LegalPage title="Terms of service">
    <p>By using SavePal you agree to these terms. If you don’t agree, please don’t use the service.</p>

    <h2>What SavePal is</h2>
    <p>SavePal is a tool for recording a website milestone, checking delivered work against agreed criteria, recording the client’s decision and running a payment in the <strong>PayPal sandbox</strong>, PayPal’s test environment. <strong>No real money is moved.</strong> SavePal is not a bank, escrow service or payment provider.</p>

    <h2>Your responsibilities</h2>
    <ul>
      <li>Give accurate information and only invite people you intend to work with.</li>
      <li>Only submit websites you are allowed to share. Don’t submit unlawful content, malware or other people’s private data.</li>
      <li>Don’t try to break, overload or get around SavePal’s security, or access agreements you are not part of.</li>
    </ul>

    <h2>Checks and decisions</h2>
    <p>Automatic checks and any AI comments are aids, not guarantees. They can be incomplete, and anything SavePal can’t prove is marked as needing review. The client makes the final decision and is responsible for it.</p>

    <h2>The record</h2>
    <p>Agreements, submissions, decisions and activity are kept as a permanent, tamper-evident record that both parties can rely on, so they are not edited after the fact.</p>

    <h2>Availability</h2>
    <p>SavePal is provided “as is”, without warranties. We may change or pause the service. To the extent the law allows, we are not liable for indirect losses or for disputes between the people using it.</p>

    <h2>Contact</h2>
    <p>Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
  </LegalPage>;
}
