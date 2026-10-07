import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/auth";
import AiMediaClient from "@/components/ai/AiMediaClient";

export const dynamic = "force-dynamic";

export default async function AIWallpapersPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/auth/login?next=/ai/wallpapers");
  return <AiMediaClient />;
}
