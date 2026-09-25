import VipPlansClient from "./VipPlansClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameVortex VIP",
  description:
    "اشترك في GameVortex VIP واحصل على مزايا حصرية، ونقاط أكثر ومزايا حصرية.",
};

export default function VipPage() {
  return <VipPlansClient />;
}
