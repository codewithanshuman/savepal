import { captureMatches, parseUsdCents, providerPaymentStatus, type PaymentStatus } from "./assurance.ts";

/**
 * CAPTURE: pay after approval (one-step checkout). AUTHORIZE: fund first, where the client's PayPal
 * approval places a hold that is captured only after the client approves the delivered work.
 */
export type PaymentIntent = "CAPTURE" | "AUTHORIZE";

export type ExpectedPayment = {
  projectId: string;
  orderId?: string;
  captureId?: string;
  customId: string;
  amountCents: number;
  currency: string;
  merchantId?: string;
  intent?: PaymentIntent;
};

export type PayPalCapture = {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string };
  supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } };
  payee?: { merchant_id?: string };
  invoice_id?: string;
};

export type PayPalAuthorization = {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string };
  custom_id?: string;
  expiration_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
};

export type PayPalOrder = {
  id?: string;
  intent?: string;
  status?: string;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    payee?: { merchant_id?: string };
    amount?: { value?: string; currency_code?: string };
    payments?: { captures?: PayPalCapture[]; authorizations?: PayPalAuthorization[] };
  }>;
};

/** Local view of a hold: HELD means PayPal has reserved the funds and they can still be captured. */
export type HoldStatus = "HELD" | "PENDING" | "CAPTURED" | "VOIDED" | "EXPIRED" | "FAILED";

export function holdStatus(authorization: PayPalAuthorization): HoldStatus {
  switch (authorization.status) {
    case "CREATED": return "HELD";
    case "PENDING": return "PENDING";
    case "CAPTURED": case "PARTIALLY_CAPTURED": return "CAPTURED";
    case "VOIDED": return "VOIDED";
    case "EXPIRED": return "EXPIRED";
    case "DENIED": return "FAILED";
    default: throw new Error("PayPal returned an unsupported authorization status");
  }
}

export type PayPalSellerIntegration = {
  merchant_id?: string; tracking_id?: string;
  payments_receivable?: boolean; primary_email_confirmed?: boolean;
  oauth_integrations?: Array<{ oauth_third_party?: Array<{ partner_client_id?: string; scopes?: string[] }> }>;
};

export function sellerIntegrationReady(integration: PayPalSellerIntegration, trackingId: string, clientId: string, merchantId: string): boolean {
  const authorized = integration.oauth_integrations?.some(row => row.oauth_third_party?.some(permission =>
    permission.partner_client_id === clientId && permission.scopes?.some(scope =>
      scope.includes("/services/payments/realtimepayment") || scope.includes("/services/payments/payment/authcapture"))));
  return integration.merchant_id === merchantId && integration.tracking_id === trackingId &&
    integration.payments_receivable === true && integration.primary_email_confirmed === true && !!authorized;
}

export type PartnerReferral = { id?: string; links?: Array<{ rel?: string; href?: string }> };

export function referralActionUrl(referral: PartnerReferral): string | null {
  const href = referral.links?.find(link => link.rel === "action_url")?.href;
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname === "www.sandbox.paypal.com" ? href : null;
  } catch { return null; }
}

export function referralId(referral: PartnerReferral): string | null {
  const href = referral.links?.find(link => link.rel === "self")?.href;
  if (!href) return null;
  try {
    const url = new URL(href);
    const id = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    return url.protocol === "https:" && url.hostname === "api-m.sandbox.paypal.com" &&
      url.pathname.includes("/v2/customer/partner-referrals/") && /^[A-Za-z0-9+/=]{1,255}$/.test(id) ? id : null;
  } catch { return null; }
}

function moneyMatches(amount: { value?: string; currency_code?: string } | undefined, cents: number, currency: string): boolean {
  return !!amount && amount.currency_code === currency && parseUsdCents(amount.value) === cents && /^\d+\.\d{2}$/.test(amount.value || "");
}

export function orderMatches(order: PayPalOrder, expected: ExpectedPayment): boolean {
  if (!order.id || (expected.orderId && order.id !== expected.orderId)) return false;
  if (order.intent && order.intent !== (expected.intent ?? "CAPTURE")) return false;
  if (order.purchase_units?.length !== 1) return false;
  const unit = order.purchase_units[0];
  return unit.reference_id === expected.projectId && unit.custom_id === expected.customId &&
    (!expected.merchantId || unit.payee?.merchant_id === expected.merchantId) &&
    moneyMatches(unit.amount,expected.amountCents,expected.currency);
}

export function orderCapture(order: PayPalOrder, expected: ExpectedPayment): PayPalCapture | null {
  if (!orderMatches(order,expected)) return null;
  const captures = order.purchase_units![0].payments?.captures || [];
  if (captures.length !== 1) return null;
  const capture = captures[0];
  if (!captureMatches(capture,expected.amountCents,expected.currency,expected.captureId)) return null;
  if (capture.supplementary_data?.related_ids?.order_id && capture.supplementary_data.related_ids.order_id !== order.id) return null;
  return capture;
}

/** The single authorization on a fund-first order, if it matches the expected hold exactly. */
export function orderAuthorization(order: PayPalOrder, expected: ExpectedPayment, authorizationId?: string): PayPalAuthorization | null {
  if (expected.intent !== "AUTHORIZE" || !orderMatches(order,expected)) return null;
  const authorizations = order.purchase_units![0].payments?.authorizations || [];
  if (authorizations.length !== 1) return null;
  const authorization = authorizations[0];
  return authorizationMatches(authorization,expected,authorizationId) ? authorization : null;
}

export function authorizationMatches(authorization: PayPalAuthorization, expected: ExpectedPayment, authorizationId?: string): boolean {
  if (!safeProviderId(authorization.id) || (authorizationId && authorization.id !== authorizationId)) return false;
  if (!moneyMatches(authorization.amount,expected.amountCents,expected.currency)) return false;
  if (authorization.custom_id !== undefined && authorization.custom_id !== expected.customId) return false;
  const relatedOrder = authorization.supplementary_data?.related_ids?.order_id;
  return !relatedOrder || !expected.orderId || relatedOrder === expected.orderId;
}

export function captureMatchesOrder(capture: PayPalCapture, expected: ExpectedPayment): boolean {
  if (!captureMatches(capture,expected.amountCents,expected.currency,expected.captureId)) return false;
  if (expected.merchantId && capture.payee?.merchant_id !== expected.merchantId) return false;
  const relatedOrder = capture.supplementary_data?.related_ids?.order_id;
  return !relatedOrder || !expected.orderId || relatedOrder === expected.orderId;
}

export function safeProviderId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,80}$/.test(value);
}

export function safeMerchantId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{13}$/.test(value);
}

export function retrySafe(startedAt: string | null, now = Date.now()): boolean {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  return Number.isFinite(started) && started <= now && now - started < 5 * 60 * 60 * 1000;
}

export function captureStatus(capture: PayPalCapture): PaymentStatus {
  if (!["PENDING","COMPLETED","DENIED","DECLINED","FAILED","PARTIALLY_REFUNDED","REFUNDED"].includes(capture.status || ""))
    throw new Error("PayPal returned an unsupported capture status");
  return providerPaymentStatus(capture.status);
}

export class PayPalSandbox {
  private tokenValue: string | null = null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetcher: typeof fetch;
  private readonly partner?: { clientId: string; attributionId: string; merchantId: string };
  constructor(
    clientId: string,
    clientSecret: string,
    fetcher: typeof fetch = fetch,
    partner?: { clientId: string; attributionId: string; merchantId: string },
  ) { this.clientId = clientId; this.clientSecret = clientSecret; this.fetcher = fetcher; this.partner = partner; }

  private partnerHeaders(merchantId?: string): Record<string,string> {
    if (!this.partner || !merchantId) return {};
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    return {
      "PayPal-Partner-Attribution-Id": this.partner.attributionId,
      "PayPal-Auth-Assertion": `${encode({ alg: "none" })}.${encode({ iss: this.partner.clientId, payer_id: merchantId })}.`,
    };
  }

  private async token(): Promise<string> {
    if (this.tokenValue) return this.tokenValue;
    const basic = btoa(`${this.clientId}:${this.clientSecret}`);
    const response = await this.fetcher("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw new Error("PayPal authentication failed");
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) throw new Error("PayPal did not return an access token");
    this.tokenValue = data.access_token;
    return data.access_token;
  }

  private async request<T>(path: string, method: "GET" | "POST", body?: unknown, requestId?: string, merchantId?: string): Promise<T> {
    const token = await this.token();
    const response = await this.fetcher(`https://api-m.sandbox.paypal.com${path}`, {
      method, signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        ...this.partnerHeaders(merchantId),
      },
      ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    if (!response.ok) {
      // PayPal names the problem (e.g. INSTRUMENT_DECLINED); keep only that safe identifier.
      const issue = await response.json().then((raw: unknown) => { const b = raw as { name?: string; details?: Array<{ issue?: string }> } | null; return b?.details?.[0]?.issue || b?.name || ""; }, () => "");
      const tag = /^[A-Z_]{3,60}$/.test(issue) ? ` (${issue})` : "";
      throw new Error(`PayPal ${method} ${path.split("/").slice(0,4).join("/")} failed with HTTP ${response.status}${tag}`);
    }
    // Void returns 204 No Content.
    if (response.status === 204) return {} as T;
    return await response.json() as T;
  }

  createOrder(expected: ExpectedPayment, requestId: string): Promise<PayPalOrder> {
    return this.request("/v2/checkout/orders","POST",{
      intent: expected.intent ?? "CAPTURE",
      purchase_units: [{
        reference_id: expected.projectId,
        custom_id: expected.customId,
        ...(expected.merchantId ? { payee: { merchant_id: expected.merchantId } } : {}),
        amount: { currency_code: expected.currency, value: (expected.amountCents/100).toFixed(2) },
      }],
    },requestId,expected.merchantId);
  }

  getOrder(orderId: string, merchantId?: string): Promise<PayPalOrder> {
    if (!safeProviderId(orderId)) throw new Error("Invalid PayPal order ID");
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}`,"GET",undefined,undefined,merchantId);
  }

  captureOrder(orderId: string, requestId: string, merchantId?: string): Promise<PayPalOrder> {
    if (!safeProviderId(orderId)) throw new Error("Invalid PayPal order ID");
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,"POST",{},requestId,merchantId);
  }

  /** Fund first: turns the buyer-approved order into a hold on the buyer's funds. */
  authorizeOrder(orderId: string, requestId: string, merchantId?: string): Promise<PayPalOrder> {
    if (!safeProviderId(orderId)) throw new Error("Invalid PayPal order ID");
    return this.request(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,"POST",{},requestId,merchantId);
  }

  getAuthorization(authorizationId: string, merchantId?: string): Promise<PayPalAuthorization> {
    if (!safeProviderId(authorizationId)) throw new Error("Invalid PayPal authorization ID");
    return this.request(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,"GET",undefined,undefined,merchantId);
  }

  /** Releases held funds to the payee. `invoiceId` carries the approval receipt hash. */
  captureAuthorization(authorizationId: string, requestId: string, invoiceId: string, merchantId?: string): Promise<PayPalCapture> {
    if (!safeProviderId(authorizationId)) throw new Error("Invalid PayPal authorization ID");
    if (!/^[A-Za-z0-9:_-]{1,127}$/.test(invoiceId)) throw new Error("Invalid invoice reference");
    return this.request(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,"POST",
      { final_capture: true, invoice_id: invoiceId, note_to_payer: "Released by SavePal after you approved the delivered work." },requestId,merchantId);
  }

  /** Cancels a hold so the buyer's funds are released. */
  voidAuthorization(authorizationId: string, requestId: string, merchantId?: string): Promise<Record<string, never>> {
    if (!safeProviderId(authorizationId)) throw new Error("Invalid PayPal authorization ID");
    return this.request(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,"POST",{},requestId,merchantId);
  }

  /** Renews a hold after PayPal's honor period: a fresh authorization for the same amount. */
  reauthorize(authorizationId: string, cents: number, currency: string, requestId: string, merchantId?: string): Promise<PayPalAuthorization> {
    if (!safeProviderId(authorizationId)) throw new Error("Invalid PayPal authorization ID");
    return this.request(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`,"POST",
      { amount: { currency_code: currency, value: (cents/100).toFixed(2) } },requestId,merchantId);
  }

  /** Returns money from a completed capture to the payer (a granted appeal). */
  refundCapture(captureId: string, cents: number, currency: string, requestId: string, note: string, merchantId?: string): Promise<{ id?: string; status?: string }> {
    if (!safeProviderId(captureId)) throw new Error("Invalid PayPal capture ID");
    return this.request(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,"POST",
      { amount: { currency_code: currency, value: (cents/100).toFixed(2) }, note_to_payer: note.slice(0,255) },requestId,merchantId);
  }

  getCapture(captureId: string, merchantId?: string): Promise<PayPalCapture> {
    if (!safeProviderId(captureId)) throw new Error("Invalid PayPal capture ID");
    return this.request(`/v2/payments/captures/${encodeURIComponent(captureId)}`,"GET",undefined,undefined,merchantId);
  }

  createSellerReferral(trackingId: string, returnUrl: string, email: string): Promise<PartnerReferral> {
    if (!this.partner || !/^[A-Za-z0-9-]{1,127}$/.test(trackingId)) throw new Error("PayPal partner onboarding is unavailable");
    return this.request("/v2/customer/partner-referrals","POST",{
      tracking_id: trackingId,
      operations: [{ operation: "API_INTEGRATION", api_integration_preference: { rest_api_integration: {
        integration_method: "PAYPAL", integration_type: "THIRD_PARTY",
        third_party_details: { features: ["PAYMENT","REFUND"] },
      } } }],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      referral_data: { email },
      partner_config_override: { return_url: returnUrl, return_url_description: "Return to SavePal" },
    },trackingId,this.partner.merchantId);
  }

  getSellerReferral(referralId: string): Promise<PartnerReferral> {
    if (!this.partner || !/^[A-Za-z0-9+/=]{1,255}$/.test(referralId)) throw new Error("Invalid partner referral ID");
    return this.request(`/v2/customer/partner-referrals/${encodeURIComponent(referralId)}`,"GET",undefined,undefined,this.partner.merchantId);
  }

  getSellerIntegration(partnerMerchantId: string, sellerMerchantId: string): Promise<PayPalSellerIntegration> {
    if (!this.partner || !safeMerchantId(partnerMerchantId) || !safeMerchantId(sellerMerchantId)) throw new Error("Invalid merchant ID");
    return this.request(`/v1/customer/partners/${encodeURIComponent(partnerMerchantId)}/merchant-integrations/${encodeURIComponent(sellerMerchantId)}`,
      "GET",undefined,undefined,sellerMerchantId);
  }

  async verifyWebhook(headers: Headers, event: unknown, webhookId: string): Promise<boolean> {
    const transmissionId = headers.get("paypal-transmission-id");
    const transmissionTime = headers.get("paypal-transmission-time");
    const certUrl = headers.get("paypal-cert-url");
    const authAlgo = headers.get("paypal-auth-algo");
    const transmissionSig = headers.get("paypal-transmission-sig");
    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) return false;
    const result = await this.request<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature","POST",{
      transmission_id: transmissionId, transmission_time: transmissionTime,
      cert_url: certUrl, auth_algo: authAlgo, transmission_sig: transmissionSig,
      webhook_id: webhookId, webhook_event: event,
    });
    return result.verification_status === "SUCCESS";
  }
}
