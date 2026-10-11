/**
 * Shared loading skeleton for list/grid routes (Phase 16). Server Component, no JS.
 * Used by the route-level `loading.tsx` files so navigation shows the page shape immediately
 * instead of a blank screen / full-page spinner while the server fetches data.
 */
export default function ListSkeleton({ cards = 8, label = "جارٍ التحميل..." }: { cards?: number; label?: string }) {
  return (
    <main className="wrap" aria-busy="true" aria-live="polite">
      <span className="muted" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {label}
      </span>
      <div className="gv-skel gv-skel-hero" />
      <div className="gv-skel gv-skel-title" />
      <div className="grid">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={index} className="gv-skel gv-skel-card" />
        ))}
      </div>
    </main>
  );
}
