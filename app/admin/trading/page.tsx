import type { Metadata } from "next";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import { getTradingSummary } from "@/lib/trading/allocation";
import { tradingMaxAllocationUsd, TRADING_MIN_ALLOCATION_USD } from "@/lib/trading/money";
import { getRiskConfig } from "@/lib/trading/risk-config-service";
import TradingAllocationPanel from "@/components/admin/TradingAllocationPanel";
import TradingRiskConfigPanel from "@/components/admin/TradingRiskConfigPanel";
import TradingBacktestPanel from "@/components/admin/TradingBacktestPanel";
import TradingPaperPanel from "@/components/admin/TradingPaperPanel";
import TradingTestnetPanel from "@/components/admin/TradingTestnetPanel";
import TradingLivePreflightPanel from "@/components/admin/TradingLivePreflightPanel";
import TradingLiveOrderPanel from "@/components/admin/TradingLiveOrderPanel";
import TradingAuditPanel from "@/components/admin/TradingAuditPanel";
import TradingCapitalReconciliation from "@/components/admin/TradingCapitalReconciliation";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GameVortex AI Trading",
  robots: { index: false, follow: false },
};

const sectionStyle = {
  display: "grid",
  gap: 14,
  marginTop: 22,
} as const;

const sectionTitleStyle = {
  fontSize: "1.05rem",
  fontWeight: 700,
  margin: 0,
} as const;

const detailsStyle = {
  border: "1px solid var(--border, rgba(127, 127, 127, 0.28))",
  borderRadius: 12,
  padding: 14,
} as const;

const summaryStyle = {
  cursor: "pointer",
  fontWeight: 650,
  padding: "3px 0",
} as const;

export default async function TradingPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;

  const [summary, riskConfig] = await Promise.all([
    getTradingSummary(result.owner.id),
    getRiskConfig(result.owner.id),
  ]);

  const riskConfigForClient = riskConfig
    ? { ...riskConfig, updatedAt: riskConfig.updatedAt.toISOString() }
    : null;

  return (
    <>
      <section className={styles.ownerCard}>
        <div className={styles.ownerCardName}>GameVortex AI Trading — Owner Edition</div>
        <p className="muted">
          لوحة المالك فقط. التداول الحقيقي غير مفعّل. لا تبدأ أي اختبار بأموال حقيقية قبل اجتياز فحوصات الأمان، والتحقق من مصدر رأس المال، ومراجعة سياسة Shariah واعتمادها.
        </p>
      </section>

      <section className={styles.statGrid} aria-label="ملخص أرصدة التداول">
        <div className={styles.statTile}>
          <strong>${summary.walletAvailableUsd}</strong>
          <span className={styles.label}>النقد USD المتاح فعليًا · نقاط المالك: {summary.walletAvailablePoints}</span>
        </div>
        <div className={styles.statTile}>
          <strong>${summary.tradingBalanceUsd}</strong>
          <span className={styles.label}>رصيد التداول الداخلي</span>
        </div>
      </section>

      <section style={sectionStyle} aria-labelledby="trading-config-heading">
        <h2 id="trading-config-heading" style={sectionTitleStyle}>1. إعداد رأس المال والمخاطر</h2>
        <details style={detailsStyle} open>
          <summary style={summaryStyle}>تخصيص رصيد التداول والمحفظة</summary>
          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <TradingAllocationPanel
              initialAllocations={summary.allocations}
              pointsPerUsd={summary.pointsPerUsd}
              minUsd={TRADING_MIN_ALLOCATION_USD}
              maxUsd={tradingMaxAllocationUsd()}
            />
          </div>
        </details>
        <details style={detailsStyle}>
          <summary style={summaryStyle}>إعدادات Risk Manager</summary>
          <div style={{ marginTop: 14 }}>
            <TradingRiskConfigPanel initial={riskConfigForClient} />
          </div>
        </details>
      </section>

      <section style={sectionStyle} aria-labelledby="trading-validation-heading">
        <h2 id="trading-validation-heading" style={sectionTitleStyle}>2. الاختبارات قبل التداول</h2>
        <details style={detailsStyle}>
          <summary style={summaryStyle}>Backtesting — اختبار الاستراتيجية تاريخيًا</summary>
          <div style={{ marginTop: 14 }}><TradingBacktestPanel /></div>
        </details>
        <details style={detailsStyle}>
          <summary style={summaryStyle}>Paper Trading — تداول تجريبي داخلي</summary>
          <div style={{ marginTop: 14 }}><TradingPaperPanel /></div>
        </details>
        <details style={detailsStyle}>
          <summary style={summaryStyle}>Binance Testnet — بيئة الاختبار</summary>
          <div style={{ marginTop: 14 }}><TradingTestnetPanel /></div>
        </details>
      </section>

      <section style={sectionStyle} aria-labelledby="trading-readiness-heading">
        <h2 id="trading-readiness-heading" style={sectionTitleStyle}>3. جاهزية الحساب ورأس المال</h2>
        <p className="muted" style={{ margin: 0 }}>
          هذه الفحوصات للقراءة فقط. تطابق الأرصدة وحده لا يثبت الحيازة أو مصدر الأموال، ولا يتجاوز مراجعة Shariah أو إيقاف التداول.
        </p>
        <details style={detailsStyle} open>
          <summary style={summaryStyle}>مطابقة رأس المال والحيازة (Capital Reconciliation)</summary>
          <div style={{ marginTop: 14 }}><TradingCapitalReconciliation /></div>
        </details>
        <details style={detailsStyle} open>
          <summary style={summaryStyle}>فحص Binance Spot وصلاحيات API (قراءة فقط)</summary>
          <div style={{ marginTop: 14 }}><TradingLivePreflightPanel /></div>
        </details>
      </section>

      <section style={sectionStyle} aria-labelledby="trading-execution-heading">
        <h2 id="trading-execution-heading" style={sectionTitleStyle}>4. أوامر التداول وسجل التدقيق</h2>
        <p className="muted" style={{ margin: 0 }}>
          لا تنفّذ أمرًا حقيقيًا ما دامت أي بوابة أمان غير مستوفاة. يلزم اعتماد المالك لكل أمر، والتأكيد النصي، واجتياز جميع الفحوصات.
        </p>
        <details style={detailsStyle}>
          <summary style={summaryStyle}>إدارة الأمر الحي — محضّر للتنفيذ بعد اجتياز الشروط فقط</summary>
          <div style={{ marginTop: 14 }}><TradingLiveOrderPanel /></div>
        </details>
        <details style={detailsStyle}>
          <summary style={summaryStyle}>سجل التدقيق والأحداث الأمنية</summary>
          <div style={{ marginTop: 14 }}><TradingAuditPanel /></div>
        </details>
      </section>
    </>
  );
}
