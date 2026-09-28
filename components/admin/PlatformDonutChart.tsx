import styles from "../../app/admin/admin.module.css";

export default function PlatformDonutChart({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span>توزيع الإيرادات حسب المنصة</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <svg viewBox="0 0 100 100" width="130" height="130" style={{ flexShrink: 0 }}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(244,238,225,0.06)" strokeWidth="14" />
          {segments.map((s) => {
            const fraction = s.value / total;
            const dash = fraction * circumference;
            const circle = (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 50 50)"
              />
            );
            offset += dash;
            return circle;
          })}
          <text x="50" y="47" textAnchor="middle" fontSize="13" fontWeight="800" fill="#F4EEE1">{centerValue}</text>
          <text x="50" y="60" textAnchor="middle" fontSize="7" fill="#FF8C69">{centerLabel}</text>
        </svg>
        <div className={styles.legendRow} style={{ flex: 1, marginTop: 0 }}>
          {segments.map((s) => (
            <div className={styles.legendItem} key={s.label}>
              <span className={styles.legendDot} style={{ background: s.color }} />
              {s.label}
              <strong>{total ? Math.round((s.value / total) * 100) : 0}%</strong>
            </div>
          ))}
          {!segments.length && <span style={{ color: "#FF8C69", fontSize: 11.5 }}>لا توجد مبيعات مدفوعة بعد.</span>}
        </div>
      </div>
    </div>
  );
}
