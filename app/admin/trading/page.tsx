import type { Metadata } from "next";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import { getTradingSummary } from "@/lib/trading/allocation";
import { tradingMaxAllocationUsd, TRADING_MIN_ALLOCATION_USD } from "@/lib/trading/money";
import AdminShell from "@/components/admin/AdminShell";
import TradingAllocationPanel from "@/components/admin/TradingAllocationPanel";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

// Owner-only system: keep it out of search engines even if a URL leaks.
export const metadata: Metadata = {
  title: "GameVortex AI Trading",
  robots: { index: false, follow: false },
};

export default async function TradingPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;

  const summary = await getTradingSummary(result.owner.id);

  return (
    <AdminShell ownerLabel={result.owner.username || result.owner.email}>
      <section className={styles.ownerCard}>
        <div className={styles.ownerCardName}>GameVortex AI Trading — Owner Edition</div>
        <p className="muted">
          وضع التطوير: لا يوجد تداول حقيقي بعد. هذه المرحلة تخصّص رصيد التداول فقط (Owner Wallet ← Trading Balance)، وكل حركة مسجلة في Ledger لا يمكن تعديله.
        </p>
      </section>

      <section className={styles.statGrid}>
        <div className={styles.statTile}>
          <strong>${summary.walletAvailableUsd}</strong>
          <span className={styles.label}>رصيد المحفظة المتاح ({summary.walletAvailablePoints} نقطة)</span>
        </div>
        <div className={styles.statTile}>
          <strong>${summary.tradingBalanceUsd}</strong>
          <span className={styles.label}>رصيد التداول</span>
        </div>
      </section>

      <TradingAllocationPanel
        initialAllocations={summary.allocations}
        pointsPerUsd={summary.pointsPerUsd}
        minUsd={TRADING_MIN_ALLOCATION_USD}
        maxUsd={tradingMaxAllocationUsd()}
      />
    </AdminShell>
  );
}
