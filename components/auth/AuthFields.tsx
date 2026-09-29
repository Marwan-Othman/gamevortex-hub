"use client";

import styles from "../../app/auth/auth.module.css";

const ICONS: Record<string, React.ReactNode> = {
  user: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  ),
  mail: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  ),
  lock: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
};

type Props = {
  id: string;
  icon: keyof typeof ICONS;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export function AuthTextField({ id, icon, type = "text", value, onChange, ...rest }: Props) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{rest.placeholder}</label>
      <div className={styles.inputRow}>
        <span className={styles.inputIcon}>{ICONS[icon]}</span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      </div>
    </div>
  );
}

export function AuthPasswordField({
  id,
  value,
  onChange,
  visible,
  onToggleVisible,
  ...rest
}: Omit<Props, "icon" | "type"> & { visible: boolean; onToggleVisible: () => void }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{rest.placeholder}</label>
      <div className={styles.inputRow}>
        <span className={styles.inputIcon}>{ICONS.lock}</span>
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        <button
          type="button"
          className={styles.eyeToggle}
          onClick={onToggleVisible}
          aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        >
          {visible ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.24A9.1 9.1 0 0 1 12 4c5 0 9 4 10 8-.32 1.05-.86 2.15-1.6 3.16M6.6 6.6C4.35 8.1 2.7 10 2 12c1 4 5 8 10 8 1.4 0 2.7-.27 3.9-.75" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
