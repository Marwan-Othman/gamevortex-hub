import { Amiri, Aref_Ruqaa, Bebas_Neue, Katibeh, Lalezar, Reem_Kufi } from "next/font/google";

/**
 * خطوط عارض الخلفيات (ساعة / يوم / تاريخ / اقتباس).
 * preload:false حتى لا تُحمَّل إلا عند استخدامها فعلًا (لا تثقل بقية صفحات الموقع).
 */
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", display: "swap", preload: false });
const ruqaa = Aref_Ruqaa({ subsets: ["arabic", "latin"], weight: ["400", "700"], display: "swap", preload: false });
const kufi = Reem_Kufi({ subsets: ["arabic", "latin"], display: "swap", preload: false });
const amiri = Amiri({ subsets: ["arabic", "latin"], weight: ["400", "700"], display: "swap", preload: false });
const katibeh = Katibeh({ subsets: ["arabic", "latin"], weight: "400", display: "swap", preload: false });
const lalezar = Lalezar({ subsets: ["arabic", "latin"], weight: "400", display: "swap", preload: false });

export const VIEWER_FONTS = {
  bebas: bebas.style.fontFamily,
  ruqaa: ruqaa.style.fontFamily,
  kufi: kufi.style.fontFamily,
  amiri: amiri.style.fontFamily,
  katibeh: katibeh.style.fontFamily,
  lalezar: lalezar.style.fontFamily,
  sys: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

export type ViewerFontKey = keyof typeof VIEWER_FONTS;
