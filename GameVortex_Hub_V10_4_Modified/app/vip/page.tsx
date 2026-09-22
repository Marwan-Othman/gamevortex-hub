import VipPlansClient from "./VipPlansClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameVortex VIP",
  description:
    "اشترك في GameVortex VIP واحصل على مزايا حصرية، نقاط أكثر، ورصيد AI أكبر.",
};

export default function VipPage() {
  return <VipPlansClient />;
}
