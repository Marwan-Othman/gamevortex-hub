import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import AdminShell from "@/components/admin/AdminShell";
import ContentManager from "./ContentManager";

export const dynamic = "force-dynamic";

export default async function AdminContentPage() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  return (
    <AdminShell ownerLabel={gate.owner.username || gate.owner.email}>
      <ContentManager />
    </AdminShell>
  );
}
