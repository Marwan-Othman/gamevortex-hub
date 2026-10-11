import type { Metadata } from "next";
import { getOptionalUser } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GameVortex Admin",
  robots: { index: false, follow: false },
};

/**
 * Single shared frame for every /admin/* page: sidebar, top bar, mobile menu.
 *
 * Before this file existed only four pages (dashboard, control-center, mods,
 * trading) wrapped themselves in <AdminShell>; every other admin page had no
 * navigation at all and users had to use the browser back button.
 *
 * This layout is NOT the security boundary — each page and each API route
 * still verifies SUPER_ADMIN on the server. It only decides whether to draw
 * the frame: a logged-out or non-owner visitor gets the page's own
 * "log in" / "no permission" screen without the admin menu around it.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ownerLabel: string | null = null;

  try {
    const user = await getOptionalUser();

    if (user && user.role === "SUPER_ADMIN") {
      ownerLabel = user.username || user.email;
    }
  } catch {
    // A database hiccup must not turn into a blank crash here. The page
    // underneath runs its own check and shows the proper message.
    ownerLabel = null;
  }

  if (!ownerLabel) {
    return <>{children}</>;
  }

  return <AdminShell ownerLabel={ownerLabel}>{children}</AdminShell>;
}
