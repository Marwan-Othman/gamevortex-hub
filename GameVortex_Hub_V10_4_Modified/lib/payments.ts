import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentCreateInput = { orderId:string; amountCents:number; currency:string; returnUrl:string };
export type PaymentCreateResult = { provider:string; paymentId:string; checkoutUrl?:string; status:"CREATED"|"REQUIRES_ACTION" };
export interface PaymentProvider {
  name:string;
  createPayment(input:PaymentCreateInput):Promise<PaymentCreateResult>;
  verifyWebhook(rawBody:string, signature:string, headers?:Record<string,string>):Promise<boolean>;
}

async function stripeRequest(path:string, body:URLSearchParams) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method:"POST", headers:{ Authorization:`Bearer ${key}`, "Content-Type":"application/x-www-form-urlencoded" }, body });
  const data = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(String(data?.error?.message || "PAYMENT_PROVIDER_ERROR"));
  return data;
}

function paypalBase() {
  return (process.env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_NOT_CONFIGURED");
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method:"POST",
    headers:{ Authorization:`Basic ${basic}`, "Content-Type":"application/x-www-form-urlencoded" },
    body:"grant_type=client_credentials"
  });
  const data = await response.json() as any;
  if (!response.ok || !data.access_token) throw new Error("PAYPAL_AUTH_FAILED");
  return String(data.access_token);
}

async function paypalRequest(path:string, body:unknown) {
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBase()}${path}`, {
    method:"POST",
    headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json", "Accept":"application/json" },
    body:JSON.stringify(body)
  });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(String(data?.message || data?.name || "PAYPAL_ERROR"));
  return data;
}

export class ConfiguredPaymentProvider implements PaymentProvider {
  name = (process.env.PAYMENT_PROVIDER || "").toLowerCase();

  async createPayment(input:PaymentCreateInput):Promise<PaymentCreateResult> {
    if (this.name === "stripe") {
      const body = new URLSearchParams();
      body.set("mode", "payment");
      body.set("success_url", input.returnUrl);
      body.set("cancel_url", input.returnUrl);
      body.set("line_items[0][price_data][currency]", input.currency.toLowerCase());
      body.set("line_items[0][price_data][product_data][name]", `GameVortex Order ${input.orderId}`);
      body.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
      body.set("line_items[0][quantity]", "1");
      body.set("metadata[orderId]", input.orderId);
      body.set("payment_intent_data[metadata][orderId]", input.orderId);
      const session = await stripeRequest("checkout/sessions", body);
      return { provider:"stripe", paymentId:String(session.id), checkoutUrl:session.url, status:"REQUIRES_ACTION" };
    }

    if (this.name === "paypal") {
      const value = (input.amountCents / 100).toFixed(2);
      const data = await paypalRequest("/v2/checkout/orders", {
        intent:"CAPTURE",
        purchase_units:[{
          reference_id:input.orderId,
          custom_id:input.orderId,
          amount:{ currency_code:input.currency.toUpperCase(), value }
        }],
        application_context:{ return_url:input.returnUrl, cancel_url:input.returnUrl, user_action:"PAY_NOW" }
      });
      const approve = Array.isArray(data.links) ? data.links.find((link:any) => link.rel === "approve")?.href : undefined;
      return { provider:"paypal", paymentId:String(data.id), checkoutUrl:approve, status:"REQUIRES_ACTION" };
    }

    if (this.name === "hmac") {
      const base = process.env.PAYMENT_PROVIDER_BASE_URL;
      if (!base) throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
      const response = await fetch(`${base.replace(/\/$/,"")}/payments`, {
        method:"POST",
        headers:{"Content-Type":"application/json", ...(process.env.PAYMENT_PROVIDER_SECRET ? {Authorization:`Bearer ${process.env.PAYMENT_PROVIDER_SECRET}`} : {})},
        body:JSON.stringify(input)
      });
      const data = await response.json() as any;
      if (!response.ok) throw new Error(String(data?.error || "PAYMENT_PROVIDER_ERROR"));
      return { provider:"hmac", paymentId:String(data.paymentId), checkoutUrl:data.checkoutUrl, status:data.status === "CREATED" ? "CREATED" : "REQUIRES_ACTION" };
    }

    throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
  }

  async verifyWebhook(rawBody:string, signature:string, headers:Record<string,string> = {}):Promise<boolean> {
    if (this.name === "stripe") return verifyStripeWebhook(rawBody, signature);
    if (this.name === "paypal") return verifyPayPalWebhook(rawBody, headers);
    return verifyHmacWebhook(rawBody, signature);
  }
}

export function verifyStripeWebhook(rawBody:string, signature:string, secret=process.env.STRIPE_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || "") {
  if (!secret || !signature) return false;
  const parts = Object.fromEntries(signature.split(",").map(x => x.split("=",2) as [string,string]));
  const timestamp = Number(parts.t); const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided || Math.abs(Date.now()/1000 - timestamp) > 300) return false;
  const expected=createHmac("sha256",secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a=Buffer.from(expected), b=Buffer.from(provided);
  return a.length===b.length && timingSafeEqual(a,b);
}

export async function verifyPayPalWebhook(rawBody:string, headers:Record<string,string>) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const transmissionId = headers["paypal-transmission-id"];
  const transmissionTime = headers["paypal-transmission-time"];
  const certUrl = headers["paypal-cert-url"];
  const authAlgo = headers["paypal-auth-algo"];
  const transmissionSig = headers["paypal-transmission-sig"];
  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) return false;

  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
    method:"POST",
    headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json", "Accept":"application/json" },
    body:JSON.stringify({
      auth_algo:authAlgo,
      cert_url:certUrl,
      transmission_id:transmissionId,
      transmission_sig:transmissionSig,
      transmission_time:transmissionTime,
      webhook_id:webhookId,
      webhook_event:JSON.parse(rawBody)
    })
  });
  if (!response.ok) return false;
  const data = await response.json() as any;
  return data?.verification_status === "SUCCESS";
}

export function verifyHmacWebhook(rawBody:string, signature:string, secret=process.env.PAYMENT_WEBHOOK_SECRET || "") {
  if (!secret || !signature) return false;
  const expected=createHmac("sha256",secret).update(rawBody).digest("hex");
  const a=Buffer.from(expected), b=Buffer.from(signature);
  return a.length===b.length && timingSafeEqual(a,b);
}
