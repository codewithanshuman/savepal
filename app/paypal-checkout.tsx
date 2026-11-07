"use client";

import { useEffect } from "react";

type PayPal = { Buttons: (options: { createOrder: () => Promise<string>; onApprove: (data: { orderID: string }) => Promise<void>; onError: (error: Error) => void; style: { layout: string; color: string; shape: string; label: string; height?: number } }) => { render: (selector: string) => Promise<void> } };
declare global { interface Window { paypal?: PayPal } }

async function api(payload: Record<string, unknown>) {
  const res = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json() as { error?: string; orderId?: string; status?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/**
 * PayPal Smart Buttons. "pay": one-step checkout after approval. "hold": fund first, where the buyer's
 * approval places a PayPal authorization that SavePal captures only after the work is approved.
 */
export default function PayPalCheckout({ project, clientId, merchantId, bnCode, mode = "pay", onPaid, onError, tone = "gold" }: { project: { id: string }; tone?: "gold" | "black"; clientId: string; merchantId?: string; bnCode?: string | null; mode?: "pay" | "hold"; onPaid: () => void; onError: (message: string) => void }) {
  useEffect(() => {
    let cancelled = false;
    const actions = mode === "hold" ? { create: "fund_order", approve: "fund_authorize", done: ["HELD", "PENDING"] } : { create: "create_order", approve: "capture_order", done: ["COMPLETED"] };
    const start = async () => {
      const sdkUrl = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=${mode === "hold" ? "authorize" : "capture"}${merchantId ? `&merchant-id=${encodeURIComponent(merchantId)}` : ""}`;
      const previous = document.querySelector<HTMLScriptElement>('script[data-savepal-paypal="true"]');
      if (previous && previous.src !== sdkUrl) { previous.remove(); window.paypal = undefined; }
      if (!window.paypal) {
        const script = document.createElement("script");
        script.src = sdkUrl;
        script.dataset.savepalPaypal = "true";
        if (bnCode) script.dataset.partnerAttributionId = bnCode;
        script.async = true;
        await new Promise<void>((resolve, reject) => { script.onload = () => resolve(); script.onerror = () => reject(new Error("PayPal could not load")); document.head.appendChild(script); });
      }
      if (cancelled || !window.paypal) return;
      const host = document.getElementById("paypal-button"); if (host) host.innerHTML = "";
      await window.paypal.Buttons({
        createOrder: async () => {
          const result = await api({ action: actions.create, id: project.id });
          if (!result.orderId) throw new Error("PayPal order ID is missing");
          return result.orderId;
        },
        onApprove: async ({ orderID }) => {
          const result = await api({ action: actions.approve, id: project.id, orderId: orderID });
          if (actions.done.includes(result.status || "")) onPaid();
          else onError(mode === "hold" ? "PayPal is still reviewing the hold. Refresh in a moment." : "PayPal reported a pending capture. Check back for confirmation.");
        },
        onError: (error) => onError(error.message || "PayPal checkout failed"),
        style: { layout: "vertical", color: tone, shape: tone === "black" ? "rect" : "pill", label: "paypal", height: 44 },
      }).render("#paypal-button");
    };
    start().catch(e => onError(e.message));
    return () => { cancelled = true; };
  }, [project.id, clientId, merchantId, bnCode, mode, onPaid, onError, tone]);
  return <div id="paypal-button" className="d-paypal-btn" />;
}

