import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyHmacWebhook, verifyStripeWebhook } from '../lib/payments';

const originalSecret = process.env.PAYMENT_WEBHOOK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
  else process.env.PAYMENT_WEBHOOK_SECRET = originalSecret;
});

describe('payment webhook signature verification', () => {
  it('accepts a correctly signed generic HMAC payload', () => {
    const secret = 'test-webhook-secret';
    const body = JSON.stringify({ provider: 'hmac', paymentId: 'pay_001', orderId: 'ord_001' });
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    expect(verifyHmacWebhook(body, signature, secret)).toBe(true);
  });

  it('rejects a generic payload when its content changes after signing', () => {
    const secret = 'test-webhook-secret';
    const original = JSON.stringify({ provider: 'hmac', amountCents: 500 });
    const signature = createHmac('sha256', secret).update(original).digest('hex');
    const tampered = JSON.stringify({ provider: 'hmac', amountCents: 1 });

    expect(verifyHmacWebhook(tampered, signature, secret)).toBe(false);
  });

  it('accepts a correctly signed Stripe-compatible payload within the time window', () => {
    const secret = 'stripe-webhook-secret';
    const body = JSON.stringify({ id: 'evt_001', type: 'checkout.session.completed' });
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

    expect(verifyStripeWebhook(body, `t=${timestamp},v1=${digest}`, secret)).toBe(true);
  });

  it('rejects a Stripe-compatible payload with an expired timestamp', () => {
    const secret = 'stripe-webhook-secret';
    const body = JSON.stringify({ id: 'evt_002', type: 'checkout.session.completed' });
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

    expect(verifyStripeWebhook(body, `t=${timestamp},v1=${digest}`, secret)).toBe(false);
  });
});
