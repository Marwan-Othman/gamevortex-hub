import WalletClient from "./WalletClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "المحفظة المالية | GameVortex Hub",
  description: "محفظة الأموال وسجل المعاملات المالية في GameVortex Hub.",
};

export default function WalletPage() {
  return <WalletClient />;
}
