import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/auth";
import SupportCenter from "@/components/support/SupportCenter";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/auth/login?next=/support");
  return <SupportCenter />;
}