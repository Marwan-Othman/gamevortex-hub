import Link from "next/link";

import VipPlansClient from "./VipPlansClient";

export const dynamic =
  "force-dynamic";

export const metadata = {
  title:
    "GameVortex VIP",
  description:
    "خطط GameVortex VIP ومزايا النقاط والذكاء الاصطناعي.",
};

export default function VipPage() {
  return (
    <main className="wrap">
      <section className="hero">
        <div className="eyebrow">
          GAMEVORTEX VIP
        </div>

        <h1>
          عضوية VIP لمن يريد كل المزايا في مكان واحد.
        </h1>

        <p>
          اختر الخطة المناسبة لك. الأسعار والمدد
          والرصيد الفعلي تُحدد من الخادم، والدفع
          يمر عبر نظام الدفع الحالي في GameVortex.
        </p>

        <div className="actions">
          <Link
            className="btn secondary"
            href="/rewards"
          >
            العودة للمكافآت
          </Link>

          <Link
            className="btn secondary"
            href="/ai"
          >
            GameVortex AI
          </Link>
        </div>
      </section>

      <VipPlansClient />
    </main>
  );
}
