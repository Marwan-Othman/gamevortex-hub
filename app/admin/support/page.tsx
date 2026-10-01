import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import OwnerSupportCenter from "@/components/support/OwnerSupportCenter";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;
  return <OwnerSupportCenter />;
}