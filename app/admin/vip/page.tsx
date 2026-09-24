import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import { db } from "@/lib/prisma";
import styles from "../admin.module.css";
export const dynamic = "force-dynamic";
export default async function AdminVipPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;
  const plans = await db.vipPlan.findMany({ orderBy: { sortOrder: "asc" } });
  const active = await db.vipSubscription.count({ where: { status: "ACTIVE" } });
  return <main className="wrap" dir="rtl"><section className={styles.panel}><div className={styles.panelHead}><span>GameVortex VIP</span><span className="muted">اشتراكات نشطة: {active}</span></div><div className={styles.mediaRow}>{plans.map(p=><div className={styles.mediaCard} key={p.id}><div className={styles.mediaInfo}><strong>{p.nameAr} · ${(p.priceCents/100).toFixed(2)}</strong><span>{p.durationMonths ? `${p.durationMonths} شهر` : "دائم"} · ×{p.pointsMultiplier.toString()} · Chat {p.chatCredits} · Images {p.imageCredits} · Video {p.videoCredits}</span></div></div>)}</div></section></main>;
}
