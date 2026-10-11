import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import AiAdminMonitor from "@/components/ai/AiAdminMonitor";

export const dynamic = "force-dynamic";

export default async function AiAdminPage() {
  // Same owner gate as every other admin page: a logged-out visitor sees a
  // "log in" screen instead of being silently bounced to the home page.
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;
  return <AiAdminMonitor />;
}
