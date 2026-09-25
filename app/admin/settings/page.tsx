import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import styles from "../admin.module.css";
export const dynamic = "force-dynamic";
export default async function AdminSettingsPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;
  const flags = [
    ["الدفع", Boolean(process.env.PAYMENT_PROVIDER)], ["Stripe", Boolean(process.env.STRIPE_SECRET_KEY)],
    ["PayPal", Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)],
    ["Upstash Rate Limit", Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)], ["Payout Provider", Boolean(process.env.PAYOUT_PROVIDER)],
  ];
  return <main className="wrap" dir="rtl"><section className={styles.panel}><div className={styles.panelHead}><span>إعدادات النظام</span><span className="muted">لا يتم عرض أي أسرار أو مفاتيح</span></div><div className={styles.statGrid}>{flags.map(([name, enabled])=><div className={styles.statTile} key={String(name)}><strong>{enabled ? "مفعّل" : "غير مفعّل"}</strong><span className={styles.label}>{name}</span></div>)}</div><p className="muted" style={{marginTop:16}}>التكاملات التي تحتاج مفاتيح خارجية لا يمكن تفعيلها من ملف المشروع وحده. تحفظ المفاتيح في Vercel/بيئة التشغيل ولا تدخل إلى Git.</p></section></main>;
}
