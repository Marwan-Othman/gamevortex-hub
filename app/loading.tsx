export default function Loading() {
  return (
    <main className="gv-state-page" dir="rtl" aria-busy="true">
      <section className="gv-state-card">
        <div className="gv-state-icon" aria-hidden="true">✦</div>
        <h1>GameVortex</h1>
        <p>جارٍ تحميل الصفحة...</p>
        <div className="gv-loading-bar" aria-hidden="true" />
      </section>
    </main>
  );
}
