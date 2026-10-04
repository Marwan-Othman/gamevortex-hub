/**
 * Binance Spot REST request signing.
 *
 * Supports the two credential forms used by GameVortex production trading:
 * - BINANCE_LIVE_API_PRIVATE_KEY: Ed25519 PKCS#8 PEM private key.
 * - BINANCE_LIVE_API_SECRET: classic Binance HMAC-SHA256 secret.
 *
 * Secrets/private keys are server-side only. This module never logs credentials
 * or the signed payload.
 */

import { createHmac } from "node:crypto";
import { signBinanceEd25519Payload } from "@/lib/trading/binance-ed25519-signer";

export type BinanceSigningCredentials = {
  apiPrivateKeyPem?: string;
  apiSecret?: string;
};

export function signBinancePayload(
  payload: string,
  credentials: BinanceSigningCredentials,
): string {
  const privateKeyPem = credentials.apiPrivateKeyPem?.trim();
  if (privateKeyPem) {
    return signBinanceEd25519Payload(payload, privateKeyPem);
  }

  const apiSecret = credentials.apiSecret?.trim();
  if (apiSecret) {
    return createHmac("sha256", apiSecret).update(payload, "utf8").digest("hex");
  }

  throw new Error("BINANCE_LIVE_API_CREDENTIALS_REQUIRED");
}

export function hasBinanceSigningCredential(
  credentials: BinanceSigningCredentials,
): boolean {
  return Boolean(credentials.apiPrivateKeyPem?.trim() || credentials.apiSecret?.trim());
}
