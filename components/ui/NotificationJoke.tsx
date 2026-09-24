 "use client";

import { useEffect, useState } from "react";

export default function NotificationJoke() {
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const saved = (localStorage.getItem("selectedLanguage") as "ar" | "en" | null) || "ar";
    setLanguage(saved);

    const handler = () => {
      const next = (localStorage.getItem("selectedLanguage") as "ar" | "en" | null) || "ar";
      setLanguage(next);
    };
    window.addEventListener("gv-language-change", handler);
    return () => window.removeEventListener("gv-language-change", handler);
  }, []);

  if (!visible) return null;

  const ar = language === "ar";
  return (
    <div className="notifications-container" id="notification" dir={ar ? "rtl" : "ltr"} role="status">
      <div className="success">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="succes-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 0l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="success-prompt-wrap">
            <p className="success-prompt-heading">
              {ar ? "لماذا أصبحت الطماطم حمراء؟" : "Why did the tomato turn red?"}
            </p>
            <div className="success-prompt-prompt">
              <p>{ar ? "لأنها رأت تتبيلة السلطة! فهمت النكتة؟" : "Because it saw the salad dressing! Get it?"}</p>
            </div>
            <div className="success-button-container">
              <button type="button" className="success-button-main" onClick={() => setVisible(false)}>
                {ar ? "هاها، مضحكة!" : "Haha, funny!"}
              </button>
              <button type="button" className="success-button-secondary" onClick={() => setVisible(false)}>
                {ar ? "إغلاق" : "Dismiss"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
