import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentCreateInput = {
  orderId: string;
  amountCents: number;
  currency: string;
  returnUrl: string;
};

export type PaymentCreateResult = {
  provider: string;
  paymentId: string;
  checkoutUrl?: string;
  status: "CREATED" | "REQUIRES_ACTION";
};

export interface PaymentProvider {
  name: string;

  createPayment(
    input: PaymentCreateInput,
  ): Promise<PaymentCreateResult>;

  verifyWebhook(
    rawBody: string,
    signature: string,
    headers?: Record<string, string>,
  ): Promise<boolean>;

  capturePayment(
    paymentId: string,
  ): Promise<{
    provider: string;
    paymentId: string;
    status: "SUCCEEDED";
  }>;
}

const SUPPORTED_CURRENCIES = new Set([
  "usd",
  "eur",
  "gbp",
  "ils",
]);

function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toLowerCase();

  if (!SUPPORTED_CURRENCIES.has(normalized)) {
    throw new Error("UNSUPPORTED_CURRENCY");
  }

  return normalized;
}

function validateAmount(amountCents: number): void {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0
  ) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }
}

function getAllowedOrigin(): string {
  const origin =
    process.env.APP_ORIGIN?.trim().replace(/\/$/, "");

  if (!origin) {
    throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  }

  try {
    return new URL(origin).origin;
  } catch {
    throw new Error("INVALID_APP_ORIGIN");
  }
}

function validateReturnUrl(returnUrl: string): string {
  let parsed: URL;

  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new Error("INVALID_RETURN_URL");
  }

  const allowedOrigin = getAllowedOrigin();

  if (parsed.origin !== allowedOrigin) {
    throw new Error("RETURN_URL_NOT_ALLOWED");
  }

  return parsed.toString();
}

async function stripeRequest(
  path: string,
  body: URLSearchParams,
) {
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetch(
    `https://api.stripe.com/v1/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    },
  );

  const data =
    (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const error =
      data?.error &&
      typeof data.error === "object"
        ? data.error as Record<string, unknown>
        : null;

    throw new Error(
      String(
        error?.message ||
          "PAYMENT_PROVIDER_ERROR",
      ),
    );
  }

  return data;
}

function paypalBase() {
  return (
    process.env.PAYPAL_ENVIRONMENT ||
    "sandbox"
  ).toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken() {
  const id =
    process.env.PAYPAL_CLIENT_ID;

  const secret =
    process.env.PAYPAL_CLIENT_SECRET;

  if (!id || !secret) {
    throw new Error("PAYPAL_NOT_CONFIGURED");
  }

  const basic = Buffer.from(
    `${id}:${secret}`,
  ).toString("base64");

  const response = await fetch(
    `${paypalBase()}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body:
        "grant_type=client_credentials",
      cache: "no-store",
    },
  );

  const data =
    (await response.json()) as Record<string, unknown>;

  if (
    !response.ok ||
    typeof data.access_token !== "string"
  ) {
    throw new Error("PAYPAL_AUTH_FAILED");
  }

  return data.access_token;
}

async function paypalRequest(
  path: string,
  body: unknown,
) {
  const token =
    await paypalAccessToken();

  const response = await fetch(
    `${paypalBase()}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  const data =
    (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      String(
        data?.message ||
          data?.name ||
          "PAYPAL_ERROR",
      ),
    );
  }

  return data;
}

export class ConfiguredPaymentProvider
  implements PaymentProvider
{
  name = (
    process.env.PAYMENT_PROVIDER || ""
  ).toLowerCase();

  async createPayment(
    input: PaymentCreateInput,
  ): Promise<PaymentCreateResult> {
    validateAmount(input.amountCents);

    const currency =
      normalizeCurrency(input.currency);

    const returnUrl =
      validateReturnUrl(input.returnUrl);

    if (!input.orderId.trim()) {
      throw new Error("INVALID_ORDER_ID");
    }

    if (this.name === "stripe") {
      const body =
        new URLSearchParams();

      body.set("mode", "payment");

      body.set(
        "success_url",
        returnUrl,
      );

      body.set(
        "cancel_url",
        returnUrl,
      );

      body.set(
        "line_items[0][price_data][currency]",
        currency,
      );

      body.set(
        "line_items[0][price_data][product_data][name]",
        `GameVortex Order ${input.orderId}`,
      );

      body.set(
        "line_items[0][price_data][unit_amount]",
        String(input.amountCents),
      );

      body.set(
        "line_items[0][quantity]",
        "1",
      );

      body.set(
        "metadata[orderId]",
        input.orderId,
      );

      body.set(
        "payment_intent_data[metadata][orderId]",
        input.orderId,
      );

      const session =
        await stripeRequest(
          "checkout/sessions",
          body,
        );

      if (
        typeof session.id !== "string"
      ) {
        throw new Error(
          "PAYMENT_PROVIDER_ERROR",
        );
      }

      return {
        provider: "stripe",
        paymentId: session.id,
        checkoutUrl:
          typeof session.url === "string"
            ? session.url
            : undefined,
        status:
          "REQUIRES_ACTION",
      };
    }

    if (this.name === "paypal") {
      const value =
        (input.amountCents / 100)
          .toFixed(2);

      const data =
        await paypalRequest(
          "/v2/checkout/orders",
          {
            intent: "CAPTURE",
            purchase_units: [
              {
                reference_id:
                  input.orderId,
                custom_id:
                  input.orderId,
                amount: {
                  currency_code:
                    currency.toUpperCase(),
                  value,
                },
              },
            ],
            application_context: {
              return_url:
                returnUrl,
              cancel_url:
                returnUrl,
              user_action:
                "PAY_NOW",
            },
          },
        );

      const links =
        Array.isArray(data.links)
          ? data.links
          : [];

      const approve =
        links.find(
          (link) =>
            link &&
            typeof link ===
              "object" &&
            (link as Record<string, unknown>)
              .rel === "approve",
        ) as
          | Record<string, unknown>
          | undefined;

      if (
        typeof data.id !== "string"
      ) {
        throw new Error(
          "PAYPAL_ERROR",
        );
      }

      return {
        provider: "paypal",
        paymentId: data.id,
        checkoutUrl:
          typeof approve?.href === "string"
            ? approve.href
            : undefined,
        status:
          "REQUIRES_ACTION",
      };
    }

    if (this.name === "hmac") {
      const base =
        process.env
          .PAYMENT_PROVIDER_BASE_URL;

      if (!base) {
        throw new Error(
          "PAYMENT_PROVIDER_NOT_CONFIGURED",
        );
      }

      const secret =
        process.env
          .PAYMENT_PROVIDER_SECRET;

      const response =
        await fetch(
          `${base.replace(/\/$/, "")}/payments`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              ...(secret
                ? {
                    Authorization:
                      `Bearer ${secret}`,
                  }
                : {}),
            },
            body: JSON.stringify({
              ...input,
              amountCents:
                input.amountCents,
              currency,
              returnUrl,
            }),
            cache: "no-store",
          },
        );

      const data =
        (await response.json()) as Record<
          string,
          unknown
        >;

      if (!response.ok) {
        throw new Error(
          String(
            data?.error ||
              "PAYMENT_PROVIDER_ERROR",
          ),
        );
      }

      if (
        typeof data.paymentId !== "string"
      ) {
        throw new Error(
          "PAYMENT_PROVIDER_ERROR",
        );
      }

      return {
        provider: "hmac",
        paymentId:
          data.paymentId,
        checkoutUrl:
          typeof data.checkoutUrl ===
          "string"
            ? data.checkoutUrl
            : undefined,
        status:
          data.status === "CREATED"
            ? "CREATED"
            : "REQUIRES_ACTION",
      };
    }

    throw new Error(
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
    );
  }

  async capturePayment(
    paymentId: string,
  ): Promise<{
    provider: string;
    paymentId: string;
    status: "SUCCEEDED";
  }> {
    if (
      !paymentId ||
      paymentId.trim().length === 0
    ) {
      throw new Error(
        "INVALID_PAYMENT_ID",
      );
    }

    if (
      this.name !== "paypal"
    ) {
      throw new Error(
        "PAYMENT_CAPTURE_NOT_SUPPORTED",
      );
    }

    const data =
      await paypalRequest(
        `/v2/checkout/orders/${encodeURIComponent(
          paymentId,
        )}/capture`,
        {},
      );

    if (
      String(data.status) !==
      "COMPLETED"
    ) {
      throw new Error(
        "PAYPAL_CAPTURE_NOT_COMPLETED",
      );
    }

    return {
      provider: "paypal",
      paymentId,
      status: "SUCCEEDED",
    };
  }

  async verifyWebhook(
    rawBody: string,
    signature: string,
    headers: Record<string, string> = {},
  ): Promise<boolean> {
    if (this.name === "stripe") {
      return verifyStripeWebhook(
        rawBody,
        signature,
      );
    }

    if (this.name === "paypal") {
      return verifyPayPalWebhook(
        rawBody,
        headers,
      );
    }

    if (this.name === "hmac") {
      return verifyHmacWebhook(
        rawBody,
        signature,
      );
    }

    return false;
  }
}

export function verifyStripeWebhook(
  rawBody: string,
  signature: string,
  secret =
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.PAYMENT_WEBHOOK_SECRET ||
    "",
) {
  if (!secret || !signature) {
    return false;
  }

  const parts =
    signature
      .split(",")
      .reduce(
        (
          result,
          part,
        ) => {
          const [key, value] =
            part.split("=", 2);

          if (
            key &&
            value
          ) {
            result[key] =
              value;
          }

          return result;
        },
        {} as Record<
          string,
          string
        >,
      );

  const timestamp =
    Number(parts.t);

  const provided =
    parts.v1;

  if (
    !Number.isFinite(timestamp) ||
    !provided
  ) {
    return false;
  }

  const age =
    Math.abs(
      Date.now() / 1000 -
        timestamp,
    );

  if (age > 300) {
    return false;
  }

  const expected =
    createHmac(
      "sha256",
      secret,
    )
      .update(
        `${timestamp}.${rawBody}`,
      )
      .digest("hex");

  const a =
    Buffer.from(expected, "utf8");

  const b =
    Buffer.from(provided, "utf8");

  return (
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

export async function verifyPayPalWebhook(
  rawBody: string,
  headers: Record<string, string>,
) {
  const webhookId =
    process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    return false;
  }

  const transmissionId =
    headers[
      "paypal-transmission-id"
    ];

  const transmissionTime =
    headers[
      "paypal-transmission-time"
    ];

  const certUrl =
    headers["paypal-cert-url"];

  const authAlgo =
    headers["paypal-auth-algo"];

  const transmissionSig =
    headers[
      "paypal-transmission-sig"
    ];

  if (
    !transmissionId ||
    !transmissionTime ||
    !certUrl ||
    !authAlgo ||
    !transmissionSig
  ) {
    return false;
  }

  let webhookEvent: unknown;

  try {
    webhookEvent =
      JSON.parse(rawBody);
  } catch {
    return false;
  }

  const token =
    await paypalAccessToken();

  const response =
    await fetch(
      `${paypalBase()}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${token}`,
          "Content-Type":
            "application/json",
          Accept:
            "application/json",
        },
        body: JSON.stringify({
          auth_algo:
            authAlgo,
          cert_url:
            certUrl,
          transmission_id:
            transmissionId,
          transmission_sig:
            transmissionSig,
          transmission_time:
            transmissionTime,
          webhook_id:
            webhookId,
          webhook_event:
            webhookEvent,
        }),
        cache: "no-store",
      },
    );

  if (!response.ok) {
    return false;
  }

  const data =
    (await response.json()) as Record<
      string,
      unknown
    >;

  return (
    data?.verification_status ===
    "SUCCESS"
  );
}

export function verifyHmacWebhook(
  rawBody: string,
  signature: string,
  secret =
    process.env
      .PAYMENT_WEBHOOK_SECRET ||
    "",
) {
  if (!secret || !signature) {
    return false;
  }

  const expected =
    createHmac(
      "sha256",
      secret,
    )
      .update(rawBody)
      .digest("hex");

  const a =
    Buffer.from(expected, "utf8");

  const b =
    Buffer.from(
      signature.trim(),
      "utf8",
    );

  return (
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}
