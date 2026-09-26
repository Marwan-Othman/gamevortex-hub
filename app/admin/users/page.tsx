import Link from "next/link";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import { db } from "@/lib/prisma";
import styles from "../admin.module.css";
import UserRoleSelect from "./UserRoleSelect";
export const dynamic = "force-dynamic";
export default async function AdminUsersPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;
  const users = await db.user.findMany({ orderBy: { createdAt: "desc" }, take: 250, select: { id: true, username: true, email: true, role: true, points: true, ownerPoints: true, vipTier: true, createdAt: true } });
  return <main className="wrap" dir="rtl"><section className={styles.panel}><div className={styles.panelHead}><span>إدارة المستخدمين</span><Link href="/admin/owner-control" className="btn">مركز المالك</Link></div><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr><th>المستخدم</th><th>الدور</th><th>النقاط</th><th>VIP</th><th>التسجيل</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.username||u.email}<br/><small className="muted">{u.email}</small></td><td><UserRoleSelect userId={u.id} initialRole={u.role} disabled={u.role === "SUPER_ADMIN" && u.id === result.owner.id} canAssignOwnerRole={u.id === result.owner.id} /></td><td>{u.points}</td><td>{u.vipTier}</td><td>{u.createdAt.toLocaleDateString("ar")}</td></tr>)}</tbody></table></div></section></main>;
}
