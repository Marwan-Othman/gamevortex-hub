import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/auth";
import ApiAccessClient from "@/components/games/ApiAccessClient";

export const dynamic = "force-dynamic";

export default async function ApiAccessPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/auth/login?next=/api-access");
  return <ApiAccessClient />;
}