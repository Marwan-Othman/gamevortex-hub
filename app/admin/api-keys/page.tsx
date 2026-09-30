import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import OwnerApiKeysClient from "@/components/admin/OwnerApiKeysClient";
import LocaleText from "@/components/ui/LocaleText";

export const dynamic = "force-dynamic";

export default async function OwnerApiKeysPage() {
  const result = await getOwnerOrAccessScreen();
  if ("screen" in result) return result.screen;
  return <main className="wrap">
    <h1><LocaleText ar="إدارة مفاتيح API" en="API key management" /></h1>
    <p className="muted"><LocaleText ar="تُعرض القيمة السرية مرة واحدة فقط. خزّنها لدى المستخدم عبر قناة آمنة؛ لا ترسلها بالبريد العادي." en="The secret is shown once. Deliver it through a secure channel; do not send it by plain email." /></p>
    <OwnerApiKeysClient />
  </main>;
}