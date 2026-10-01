import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import { db } from "@/lib/prisma";
import AdminShell from "@/components/admin/AdminShell";
import ModsManager from "./ModsManager";

export const dynamic = "force-dynamic";

export default async function AdminModsPage() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const mods = await db.mod.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: 250,
    select: {
      id: true,
      slug: true,
      titleAr: true,
      titleEn: true,
      descriptionAr: true,
      descriptionEn: true,
      imageUrl: true,
      modUrl: true,
      downloadUrl: true,
      sourceUrl: true,
      sourceProvider: true,
      sourceStatus: true,
      platform: true,
      gameId: true,
      published: true,
      featured: true,
      sortOrder: true,
    },
  });

  return (
    <AdminShell ownerLabel={gate.owner.username || gate.owner.email}>
      <ModsManager initialMods={mods} />
    </AdminShell>
  );
}
