import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/auth";
import AiAdminMonitor from "@/components/ai/AiAdminMonitor";

export const dynamic = "force-dynamic";

export default async function AiAdminPage() {
  const user = await getOptionalUser();
  if (!user || user.role !== "SUPER_ADMIN") redirect("/");
  return <AiAdminMonitor />;
}
