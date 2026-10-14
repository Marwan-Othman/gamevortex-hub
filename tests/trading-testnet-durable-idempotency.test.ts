import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "prisma/migrations/20261014080000_add_trading_testnet_orders/migration.sql"),
  "utf8",
);
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const executor = readFileSync(resolve(root, "lib/trading/testnet-execution.ts"), "utf8");
const docs = readFileSync(resolve(root, "docs/trading/binance-testnet.md"), "utf8");

describe("Binance Spot Testnet durable idempotency safety contract", () => {
  it("stores Testnet order state separately from production live orders", () => {
    expect(migration).toContain('CREATE TABLE "TradingTestnetOrder"');
    expect(migration).toContain('UNIQUE ("approvalId")');
    expect(migration).toContain('UNIQUE ("idempotencyKey")');
    expect(migration).toContain('UNIQUE ("clientOrderId")');
    expect(migration).toContain('REFERENCES "TradingApproval"("id")');
    expect(schema).toContain("model TradingTestnetOrder");
    expect(schema).toContain("@@ignore");
  });

  it("claims each approval with a single compare-and-set before provider submission", () => {
    expect(executor).toContain('ON CONFLICT ("approvalId") DO NOTHING');
    expect(executor).toContain('AND "status" = \'INTENT_CREATED\'');
    expect(executor).toContain('throw new Error("TESTNET_ORDER_ALREADY_CLAIMED_OR_TERMINAL")');
    expect(executor.indexOf("claimTestnetOrder({")).toBeLessThan(
      executor.indexOf("order = await adapter.placeSpotBuy({"),
    );
  });

  it("marks ambiguous provider outcomes non-retryable and persists fills before audit", () => {
    expect(executor).toContain('SET "status" = \'UNKNOWN\'');
    expect(executor).toContain('throw new Error("TESTNET_ORDER_OUTCOME_UNKNOWN")');
    expect(executor).toContain('"auditStatus" = \'PENDING\'');
    expect(executor).toContain('"auditStatus" = \'RECORDED\'');
    expect(executor).toContain('"auditStatus" = \'FAILED\'');
    expect(executor).toContain('throw new Error("TESTNET_ORDER_AUDIT_WRITE_FAILED")');
    expect(executor).toContain('"TESTNET_PROVIDER_ERROR"');
    expect(executor.indexOf('SET "status" = \'FILLED\'')).toBeLessThan(
      executor.indexOf('action: "TRADING_TESTNET_ORDER_FILLED"'),
    );
    expect(docs).toContain("requires provider-side reconciliation");
    expect(docs).toContain("Do not automatically retry it");
  });
});
