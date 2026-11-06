import { captureMatches, parseUsdCents, providerPaymentStatus, type PaymentStatus } from "./assurance.ts";

export type ExpectedPayment = {
  projectId: string;
  orderId?: string;
  captureId?: string;
  customId: string;
  amountCents: number;
  currency: string;
  merchantId?: string;
};

export type PayPalCapture = {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
  payee?: { merchant_id?: string };
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
    payments?: { captures?: PayPalCapture[] };
  }>;
};

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
  if (order.intent && order.intent !== "CAPTURE") return false;
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
    if (!response.ok) throw new Error(`PayPal ${method} ${path.split("/").slice(0,4).join("/")} failed with HTTP ${response.status}`);
    return await response.json() as T;
  }

  createOrder(expected: ExpectedPayment, requestId: string): Promise<PayPalOrder> {
    return this.request("/v2/checkout/orders","POST",{
      intent: "CAPTURE",
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
