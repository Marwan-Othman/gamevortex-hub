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
        <div className={styles.ownerCardName}>GameVortex AI Trading — لوحة المالك</div>
        <p className="muted">
          هذه الصفحة مقسّمة إلى خطوات واضحة. ابدأ بقراءة الأرصدة، ثم إعداد المخاطر، وبعدها الاختبارات. ظهور نتيجة PASS في فحص الاتصال لا يعني أن تنفيذ صفقة حقيقية آمن.
          لا ترسل هذه الصفحة أي صفقة تلقائيًا، ولا تغيّر صلاحيات المالك.
        </p>
      </section>

      <section className={styles.statGrid} aria-label="ملخص الأرصدة">
        <div className={styles.statTile}>
          <strong>${summary.walletAvailableUsd}</strong>
          <span className={styles.label}>الرصيد النقدي المتاح في محفظة المالك (USD)</span>
        </div>
        <div className={styles.statTile}>
          <strong>${summary.tradingBalanceUsd}</strong>
          <span className={styles.label}>رصيد التداول المخصّص (USD)</span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span>الخطوة 1 — رصيد التداول</span>
          <span className="muted">لا تخصّص أكثر من الرصيد المتاح</span>
        </div>
        <p className="muted">
          التخصيص ينقل مبلغًا داخليًا من محفظة المالك إلى رصيد التداول ويسجّله في دفتر الحركات. لا يعني شراء عملة ولا يودع أموالًا في Binance.
        </p>
        <TradingAllocationPanel
          initialAllocations={summary.allocations}
          pointsPerUsd={summary.pointsPerUsd}
          minUsd={TRADING_MIN_ALLOCATION_USD}
          maxUsd={tradingMaxAllocationUsd()}
        />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span>الخطوة 2 — حدود المخاطر</span>
          <span className="muted">مطلوبة قبل أي تجربة تنفيذ</span>
        </div>
        <p className="muted">
          اضبط الحد الأقصى للصفقة والخسارة والتعرّض، واترك Stop Loss وTake Profit الإلزاميين مفعّلين.
        </p>
        <TradingRiskConfigPanel initial={riskConfigForClient} />
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span>الخطوة 3 — اختبار بدون أموال حقيقية</span>
          <span className="muted">ابدأ هنا قبل التفكير بالتداول الحقيقي</span>
        </div>
        <p className="muted">
          Backtesting وPaper Trading محاكاة فقط. Binance Spot Testnet يستخدم أموالًا افتراضية؛ فحص صلاحيات Testnet لا يثبت نجاح دورة شراء وحماية وإغلاق كاملة.
        </p>
        <details>
          <summary>فتح إعدادات Backtesting</summary>
          <TradingBacktestPanel />
        </details>
        <details>
          <summary>فتح Paper Trading (محاكاة)</summary>
          <TradingPaperPanel />
        </details>
        <details>
          <summary>فتح فحص Binance Spot Testnet</summary>
          <TradingTestnetPanel />
        </details>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span>الخطوة 4 — فحوص الإنتاج ودفتر الأرصدة</span>
          <span className="muted">قراءة فقط؛ لا تنفّذ صفقة</span>
        </div>
        <details>
          <summary>فحص مطابقة الأرصدة مع Binance</summary>
          <TradingCapitalReconciliation />
        </details>
        <details>
          <summary>فحص صلاحيات Binance للإنتاج</summary>
          <TradingLivePreflightPanel />
        </details>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span>الخطوة 5 — أمر حقيقي (موقوف حتى اجتياز التحقق)</span>
          <span className="muted">لا تستخدمه قبل إثبات الحماية والتسوية</span>
        </div>
        <p className="muted">
          لا تبدأ أمرًا حقيقيًا لمجرد ظهور PASS في فحص المفتاح. يجب التأكد من موافقة المالك، وفحص Shariah وRisk Manager، وتوافر الرصيد، ونجاح حماية الصفقة واستعادة الأوامر والتسوية. إذا لم تجتز جميع الشروط، يجب أن يرفض النظام الأمر.
        </p>
        <TradingLiveOrderPanel />
      </section>

      <details className={styles.panel}>
        <summary>سجل التدقيق — أحداث المالك والنظام</summary>
        <TradingAuditPanel />
      </details>
    </>
  );
}
