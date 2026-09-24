import Link from "next/link";
import { requireOwner } from "./auth";

/**
 * Every /admin/* page needs the same check: only the SUPER_ADMIN owner may
 * see it. Several pages called requireOwner() directly with no try/catch,
 * so a logged-out visitor (or a session invalidated by a role change) hit
 * an uncaught "UNAUTHORIZED"/"FORBIDDEN" error that fell through to the
 * generic app/error.tsx boundary — a confusing crash screen instead of a
 * clear "please log in" message.
 *
 * Usage in a page:
 *   const result = await getOwnerOrAccessScreen();
 *   if ("screen" in result) return result.screen;
 *   const owner = result.owner;
 */
export async function getOwnerOrAccessScreen() {
  try {
    const owner = await requireOwner();
    return { owner };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return { screen: <AdminAccessScreen reason={message} /> };
  }
}

function AdminAccessScreen({ reason }: { reason: string }) {
  const isLoggedOut = reason === "UNAUTHORIZED";
  return (
    <main className="wrap" dir="rtl">
      <section className="glass card" style={{ textAlign: "center", padding: 60, margin: "40px auto", maxWidth: 480 }}>
        {isLoggedOut ? (
          <>
            <h1>سجّل الدخول للوصول لهذه الصفحة</h1>
            <p className="muted" style={{ margin: "10px 0 20px" }}>تحتاج لتسجيل الدخول بحساب المالك للمتابعة.</p>
            <Link href="/auth/login" className="btn">تسجيل الدخول</Link>
          </>
        ) : (
          <>
            <h1>ليس لديك صلاحية الوصول</h1>
            <p className="muted" style={{ margin: "10px 0 20px" }}>هذه الصفحة مخصصة لحساب المالك (SUPER_ADMIN) فقط.</p>
            <Link href="/" className="btn">العودة للرئيسية</Link>
          </>
        )}
      </section>
    </main>
  );
}
