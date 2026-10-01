import Link from "next/link";
export default function NotFound(){ return <main className="wrap" dir="rtl"><section className="glass hero"><span className="badge">404</span><h1>الصفحة غير موجودة</h1><p className="muted">الرابط الذي طلبته غير متاح أو لم يعد منشورًا.</p><Link className="btn" href="/games">العودة إلى الألعاب</Link></section></main>; }
