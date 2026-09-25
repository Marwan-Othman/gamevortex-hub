import Link from "next/link";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import { db } from "@/lib/prisma";
import styles from "../admin.module.css";
export const dynamic = "force-dynamic";
const areas = [
  ["المستخدمون والصلاحيات", "/admin/users", "إدارة المستخدمين والأدوار والصلاحيات من السيرفر."],
  ["VIP", "/admin/vip", "الخطط والأسعار والاشتراكات والمكافآت."],
  ["الألعاب", "/admin/games", "إدارة واستيراد ونشر الألعاب."],
  ["المتجر", "/admin/store", "المنتجات والمخزون والمفاتيح."],
  ["السحوبات", "/admin/draws", "إدارة السحوبات والفائزين."],
  ["المراجعة", "/admin/moderation", "البلاغات وإجراءات الإشراف."],
  ["القرآن", "/admin/quran", "القراء ومصادر المحتوى."],
  ["الأخطاء", "/admin/errors", "أخطاء النظام وسجل التشغيل."],
  ["GameVortex AI", "/ai", "واجهة الذكاء الاصطناعي الحالية."],
  ["التداول", "/admin/trading", "Owner Trading Center عند تفعيل مكون التداول."],
  ["الإعدادات", "/admin/settings", "إعدادات النظام والتكاملات."],
];
export default async function OwnerControlPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;
  const owner = result.owner;
  const [users, staff, products, orders, payments, activeVip, pendingWithdrawals] = await Promise.all([
    db.user.count(), db.user.count({ where: { role: "STAFF" } }), db.gameProduct.count(), db.order.count(), db.payment.count(),
    db.vipSubscription.count({ where: { status: "ACTIVE" } }),
    db.withdrawalRequest.count({ where: { status: { in: ["REQUESTED", "PENDING", "PROCESSING"] } } }),
  ]);
  return <main className="wrap" dir="rtl">
    <section className={`${styles.ownerCard} glass`}><div className={styles.ownerCardTop}><span className={styles.ownerCardAvatar}>GV</span><div><div className={styles.ownerCardName}>مركز تحكم المالك الكامل 👑</div><div className={styles.ownerCardMeta}>SUPER_ADMIN · {owner.username || owner.email}</div></div></div><p className="muted">صلاحيات المالك تعتمد على دور SUPER_ADMIN من الخادم، وليس على البريد الإلكتروني. كل إجراء حساس يجب أن يبقى قابلًا للتدقيق.</p></section>
    <section className={styles.statGrid}>{[["المستخدمون",users],["Staff",staff],["المنتجات",products],["الطلبات",orders],["المدفوعات",payments],["VIP نشط",activeVip],["سحوبات معلقة",pendingWithdrawals]].map(([label,value]) => <div className={styles.statTile} key={String(label)}><strong>{value}</strong><span className={styles.label}>{label}</span></div>)}</section>
    <section className={styles.panel}><div className={styles.panelHead}><span>تحكم شامل</span><span className="muted">المسارات الحالية داخل المشروع</span></div><div className={styles.mediaRow}>{areas.map(([title,href,description]) => <Link href={href} key={href} className={styles.mediaCard}><div className={styles.mediaInfo}><strong>{title}</strong><span>{description}</span></div></Link>)}</div></section>
  </main>;
}
