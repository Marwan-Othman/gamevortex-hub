import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import OwnerQuranCMS from "@/components/admin/OwnerQuranCMS";

export const dynamic = "force-dynamic";

export default async function AdminQuranPage() {
  const gate = await getOwnerOrAccessScreen();

  if ("screen" in gate) {
    return gate.screen;
  }

  return <OwnerQuranCMS />;
}
