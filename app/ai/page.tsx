import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/auth";
import AiHubClient from "@/components/ai/AiHubClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "GameVortex AI", description: "مساعد ألعاب يعمل على محرك محلي مستضاف ذاتيًا" };

export default async function AiPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/auth/login?next=/ai");
  return <AiHubClient />;
}
