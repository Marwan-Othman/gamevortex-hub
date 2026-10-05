import SmartMerge from "./SmartMergeV2";
import SmartMergeLauncher from "./SmartMergeLauncher";

export const dynamic = "force-dynamic";

export default function WallpaperMergePage() {
  return (
    <>
      <SmartMerge />
      <div className="wrap" dir="rtl" style={{ maxWidth: 1180, paddingBottom: 48 }}>
        <SmartMergeLauncher />
      </div>
    </>
  );
}
