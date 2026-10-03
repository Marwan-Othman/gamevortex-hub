/**
 * Binance Spot Ed25519 request signing.
 *
 * Private keys are accepted only server-side. Never expose this module to a
 * client bundle and never log the private key or generated signature payload.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";

export function signBinanceEd25519Payload(payload: string, privateKeyPem: string): string {
  const normalizedKey = privateKeyPem.trim();
  if (!normalizedKey) throw new Error("BINANCE_ED25519_PRIVATE_KEY_REQUIRED");

  let privateKey: ReturnType<typeof createPrivateKey>;
  try {
    privateKey = createPrivateKey(normalizedKey);
  } catch {
    throw new Error("BINANCE_ED25519_PRIVATE_KEY_INVALID");
  }

  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("BINANCE_ED25519_PRIVATE_KEY_REQUIRED");
  }

  return cryptoSign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");
}
