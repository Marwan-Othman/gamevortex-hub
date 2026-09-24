import Link from "next/link";
import OrderHistory from "@/components/marketplace/OrderHistory";

export const metadata = {
  title: "طلباتي | GameVortex Hub",
  description: "تابع حالة طلباتك ومدفوعاتك في GameVortex.",
};

export default function OrdersPage() {
  return (
    <main className="wrap" dir="rtl">
      <section className="section-head">
        <div>
          <div className="eyebrow">VORTEX ORDERS</div>
          <h1>طلباتي</h1>
          <p className="muted">تُحدّث حالة الدفع من الخادم. لا تعتمد على صفحة العودة من مزود الدفع وحدها.</p>
        </div>
        <Link className="btn secondary" href="/marketplace">العودة إلى المتجر</Link>
      </section>
      <OrderHistory />
    </main>
  );
}
