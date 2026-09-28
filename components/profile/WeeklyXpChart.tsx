import styles from "../../app/profile/profile.module.css";

export default function WeeklyXpChart({ points, totalLabel }: { points: { label: string; value: number }[]; totalLabel: string }) {
  const width = 320;
  const height = 130;
  const padding = 10;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padding + i * step,
    y: height - padding - (p.value / max) * (height - padding * 2),
    ...p,
  }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1]?.x ?? padding},${height - padding} L${padding},${height - padding} Z`;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span>سجل النشاطات الأسبوعي</span>
        <span style={{ color: "#FFAB92" }}>{totalLabel}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="140" preserveAspectRatio="none">
        <defs>
          <linearGradient id="xpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF835D" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#FF835D" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#xpFill)" />
        <path d={linePath} fill="none" stroke="#FFAB92" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c) => (
          <circle key={c.label} cx={c.x} cy={c.y} r="3" fill="#F4EEE1" stroke="#FF835D" strokeWidth="1.5" />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {points.map((p) => (
          <span key={p.label} style={{ fontSize: 10, color: "#FF8C69" }}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}
