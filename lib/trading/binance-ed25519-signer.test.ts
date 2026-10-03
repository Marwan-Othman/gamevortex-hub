import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signBinanceEd25519Payload } from "@/lib/trading/binance-ed25519-signer";

describe("Binance Ed25519 signer", () => {
  it("creates a Binance-compatible base64 Ed25519 signature", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const payload = "symbol=BTCUSDT&side=SELL&type=LIMIT&timestamp=1668481559918&recvWindow=5000";

    const signature = signBinanceEd25519Payload(payload, privateKeyPem);
    const verified = cryptoVerify(
      null,
      Buffer.from(payload, "utf8"),
      publicKeyPem,
      Buffer.from(signature, "base64"),
    );

    expect(signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(signature, "base64")).toHaveLength(64);
    expect(verified).toBe(true);
  });

  it("rejects an empty private key", () => {
    expect(() => signBinanceEd25519Payload("timestamp=1", "")).toThrow(
      "BINANCE_ED25519_PRIVATE_KEY_REQUIRED",
    );
  });

  it("rejects a non-Ed25519 private key", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPrivateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    expect(() => signBinanceEd25519Payload("timestamp=1", rsaPrivateKeyPem)).toThrow(
      "BINANCE_ED25519_PRIVATE_KEY_REQUIRED",
    );
  });
});
