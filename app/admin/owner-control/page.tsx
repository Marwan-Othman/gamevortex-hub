import Link from "next/link";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import { db } from "@/lib/prisma";
import styles from "../admin.module.css";
import LocaleText from "@/components/ui/LocaleText";
export const dynamic = "force-dynamic";
const areas = [
  ["المستخدمون والصلاحيات", "Users & roles", "/admin/users", "إدارة المستخدمين والأدوار والصلاحيات من السيرفر.", "Manage users, roles and permissions."],
  ["VIP", "VIP", "/admin/vip", "الخطط والأسعار والاشتراكات والمكافآت.", "Plans, prices, subscriptions and rewards."],
  ["الألعاب", "Games", "/admin/games", "إدارة واستيراد ونشر الألعاب.", "Manage, import and publish games."],
  ["المتجر", "Store", "/admin/store", "المنتجات والمخزون والمفاتيح.", "Products, inventory and digital keys."],
  ["السحوبات", "Draws", "/admin/draws", "إدارة السحوبات والفائزين.", "Manage draws and winners."],
  ["المراجعة", "Moderation", "/admin/moderation", "البلاغات وإجراءات الإشراف.", "Reports and moderation actions."],
  ["القرآن", "Quran", "/admin/quran", "القراء ومصادر المحتوى.", "Reciters and content sources."],
  ["الأخطاء", "Errors", "/admin/errors", "أخطاء النظام وسجل التشغيل.", "System errors and runtime logs."],
  ["GameVortex AI Trading", "GameVortex AI Trading", "/admin/trading", "تخصيص رصيد التداول وإدارة نظام التداول (للمالك فقط).", "Trading balance allocation and trading system (owner only)."],
  ["الإعدادات", "Settings", "/admin/settings", "إعدادات النظام والتكاملات.", "System and integration settings."],
] as const;
export default async function OwnerControlPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;
  const owner = result.owner;
  const [users, staff, products, orders, payments, activeVip, pendingWithdrawals] = await Promise.all([
    db.user.count(), db.user.count({ where: { role: "STAFF" } }), db.gameProduct.count(), db.order.count(), db.payment.count(),
    db.vipSubscription.count({ where: { status: "ACTIVE" } }),
    db.withdrawalRequest.count({ where: { status: { in: ["REQUESTED", "PENDING", "PROCESSING"] } } }),
  ]);
  return <main className="wrap">
    <section className={`${styles.ownerCard} glass`}><div className={styles.ownerCardTop}><span className={styles.ownerCardAvatar}>GV</span><div><div className={styles.ownerCardName}><LocaleText ar="مركز تحكم المالك الكامل 👑" en="Owner control center 👑" /></div><div className={styles.ownerCardMeta}>SUPER_ADMIN · {owner.username || owner.email}</div></div></div><p className="muted"><LocaleText ar="صلاحيات المالك تعتمد على دور SUPER_ADMIN من الخادم، وليس على البريد الإلكتروني. كل إجراء حساس يجب أن يبقى قابلًا للتدقيق." en="Owner access is enforced server-side by the SUPER_ADMIN role, not by email. Sensitive actions must remain auditable." /></p></section>
    <section className={styles.statGrid}>{[["المستخدمون", "Users", users],["Staff", "Staff", staff],["المنتجات", "Products", products],["الطلبات", "Orders", orders],["المدفوعات", "Payments", payments],["VIP نشط", "Active VIP", activeVip],["سحوبات معلقة", "Pending withdrawals", pendingWithdrawals]].map(([label,enLabel,value]) => <div className={styles.statTile} key={String(label)}><strong>{value}</strong><span className={styles.label}><LocaleText ar={String(label)} en={String(enLabel)} /></span></div>)}</section>
    <section className={styles.panel}><div className={styles.panelHead}><span><LocaleText ar="تحكم شامل" en="Management" /></span><span className="muted"><LocaleText ar="المسارات الحالية داخل المشروع" en="Available project modules" /></span></div><div className={styles.mediaRow}>{areas.map(([title,enTitle,href,description,enDescription]) => <Link href={href} key={href} className={styles.mediaCard}><div className={styles.mediaInfo}><strong><LocaleText ar={title} en={enTitle} /></strong><span><LocaleText ar={description} en={enDescription} /></span></div></Link>)}</div></section>
  </main>;
}
