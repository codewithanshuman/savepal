import { MAX_HTML_BYTES, safeWebsiteUrl } from "./assurance.ts";
import { sha256 } from "./website-evidence.ts";

export type RenderedPage = {
  url: string;
  html: string;
  htmlHash: string;
  truncated: boolean;
  screenshotHash: string;
  screenshotKey: string;
  capturedAt: string;
};

export type BrowserCapture = { rendered: RenderedPage; screenshot: Uint8Array };

function bytesFromBase64(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > 8_000_000)
    throw new Error("Browser screenshot exceeds the evidence bound");
  const decoded = atob(encoded);
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
  if (!bytes.length || bytes.length > 6_000_000) throw new Error("Browser screenshot exceeds the evidence bound");
  if (![137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value))
    throw new Error("Browser evidence did not contain a PNG screenshot");
  return bytes;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,"0")).join("");
}

export async function captureRenderedPage(
  url: string, screenshotKey: string, accountId: string, apiToken: string,
  fetcher: typeof fetch = fetch,
): Promise<BrowserCapture> {
  if (safeWebsiteUrl(url) !== url || !/^[a-f0-9]{32}$/i.test(accountId) || !apiToken)
    throw new Error("Browser evidence configuration or URL is invalid");
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-run/snapshot`,{
    method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, gotoOptions: { waitUntil: "networkidle2", timeout: 20_000 } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Browser evidence request failed (${response.status})`);
  const payload = await response.json() as {
    success?: boolean; result?: { content?: string; screenshot?: string };
  };
  if (!payload.success || typeof payload.result?.content !== "string" || typeof payload.result?.screenshot !== "string")
    throw new Error("Browser evidence response is incomplete");
  const screenshot = bytesFromBase64(payload.result.screenshot);
  const contentBytes = new TextEncoder().encode(payload.result.content);
  const bounded = contentBytes.subarray(0,MAX_HTML_BYTES);
  const html = new TextDecoder().decode(bounded);
  return {
    rendered: {
      url, html, htmlHash: await sha256(html), truncated: contentBytes.length > MAX_HTML_BYTES,
      screenshotHash: await sha256Bytes(screenshot), screenshotKey, capturedAt: new Date().toISOString(),
    }, screenshot,
  };
}

export async function validateRenderedPage(rendered: RenderedPage | undefined, url: string): Promise<boolean> {
  if (!rendered) return true;
  return rendered.url === url && typeof rendered.html === "string" &&
    new TextEncoder().encode(rendered.html).length <= MAX_HTML_BYTES &&
    /^[a-f0-9]{64}$/.test(rendered.screenshotHash) &&
    /^rendered\/[a-f0-9-]+\/[a-f0-9-]+\.png$/.test(rendered.screenshotKey) &&
    await sha256(rendered.html) === rendered.htmlHash;
}
