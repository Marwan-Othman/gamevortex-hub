import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="wrap" dir="rtl">
      <section
        className="glass card"
        style={{
          textAlign: "center",
          padding: 60,
          margin: "40px auto",
          maxWidth: 560,
        }}
      >
        <h1>403 — ممنوع الوصول</h1>
        <p className="muted" style={{ margin: "10px 0 20px" }}>
          ليس لديك صلاحية الوصول إلى هذا المورد.
        </p>
        <Link href="/" className="btn">
          العودة للرئيسية
        </Link>
      </section>
    </main>
  );
}
