"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../../app/home.module.css";

const SLIDES = [
  {
    number: "01",
    eyebrow: "WELCOME TO GAMEVORTEX",
    title: "WELCOME TO GAMEVORTEX",
    subtitle:
      "PLAY • EARN • CREATE • CONNECT",
    href: "/games",
    cta: "استكشف الألعاب",
    accent: "#6C63FF",
    accent2: "#00E5FF",
    badge: "NEXT LEVEL GAMING",
    visual: "GV",
  },
  {
    number: "02",
    eyebrow: "DISCOVER MORE",
    title: "DISCOVER YOUR NEXT GAME",
    subtitle:
      "Explore worlds beyond reality.",
    href: "/games?sort=newest",
    cta: "شاهد الإصدارات الجديدة",
    accent: "#00D4FF",
    accent2: "#8B5CF6",
    badge: "NEW WORLDS",
    visual: "PLAY",
  },
  {
    number: "03",
    eyebrow: "PLAYER’S CHOICE",
    title: "كل شيء في مكان واحد",
    subtitle:
      "Your games, rewards, library and VIP in one vortex.",
    href: "/rewards",
    cta: "اكتشف VIP",
    accent: "#A855F7",
    accent2: "#FFD166",
    badge: "VIP ACCESS",
    visual: "VIP",
  },
];

export default function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % SLIDES.length);
    }, 6500);

    return () => window.clearInterval(timer);
  }, [isPaused]);

  const slide = SLIDES[index];

  const go = (delta: number) => {
    setIndex(
      (current) =>
        (current + delta + SLIDES.length) % SLIDES.length
    );
  };

  return (
    <>
      <section
        className={`${styles.hero} gv-new-hero`}
        aria-label="محتوى GameVortex المميز"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {/* Animated background */}
        <div
          className="gv-hero-background"
          style={
            {
              "--gv-accent": slide.accent,
              "--gv-accent-2": slide.accent2,
            } as React.CSSProperties
          }
          aria-hidden="true"
        >
          <div className="gv-grid" />
          <div className="gv-glow gv-glow-one" />
          <div className="gv-glow gv-glow-two" />
          <div className="gv-orbit gv-orbit-one" />
          <div className="gv-orbit gv-orbit-two" />
        </div>

        {/* Main slide */}
        <div
          className={styles.heroSlide}
          style={
            {
              "--slide-bg": `
                radial-gradient(
                  circle at 78% 42%,
                  ${slide.accent}55,
                  transparent 25%
                ),
                radial-gradient(
                  circle at 65% 85%,
                  ${slide.accent2}35,
                  transparent 34%
                ),
                linear-gradient(
                  135deg,
                  #070914 0%,
                  #0B1020 48%,
                  #080914 100%
                )
              `,
            } as React.CSSProperties
          }
        >
          {/* Decorative side number */}
          <div className="gv-hero-number" aria-hidden="true">
            {slide.number}
          </div>

          {/* Content */}
          <div className={styles.heroContent}>
            <div className="gv-hero-eyebrow">
              <span className="gv-status-dot" />
              {slide.eyebrow}
            </div>

            <div className="gv-hero-title-wrap">
              <span className="gv-hero-badge">{slide.badge}</span>

              <h1 key={slide.title} className="gv-hero-title">
                {slide.title}
              </h1>
            </div>

            <p key={slide.subtitle} className="gv-hero-subtitle">
              {slide.subtitle}
            </p>

            <div className="gv-hero-actions">
              <Link
                href={slide.href}
                className={`${styles.heroCta} gv-primary-button`}
              >
                <span>{slide.cta}</span>

                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  aria-hidden="true"
                >
                  <path d="M5 12h13" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </Link>

              <Link href="/games" className="gv-secondary-button">
                تصفح المنصة
              </Link>
            </div>
          </div>

          {/* 3D visual */}
          <div
            className="gv-hero-visual"
            aria-hidden="true"
          >
            <div className="gv-visual-shadow" />

            <div className="gv-visual-orbit gv-visual-orbit-a" />
            <div className="gv-visual-orbit gv-visual-orbit-b" />

            <div
              className="gv-visual-core"
              style={
                {
                  "--visual-accent": slide.accent,
                  "--visual-accent-2": slide.accent2,
                } as React.CSSProperties
              }
            >
              <div className="gv-core-inner">
                <span className="gv-core-small">
                  GAME
                </span>

                <strong>{slide.visual}</strong>

                <span className="gv-core-small">
                  VORTEX
                </span>
              </div>
            </div>

            <div className="gv-floating-card gv-card-one">
              <span>GAMES</span>
              <strong>∞</strong>
            </div>

            <div className="gv-floating-card gv-card-two">
              <span>PLATFORMS</span>
              <strong>ALL</strong>
            </div>

            <div className="gv-floating-card gv-card-three">
              <span>EXPERIENCE</span>
              <strong>01</strong>
            </div>
          </div>
        </div>

        {/* Previous */}
        <button
          type="button"
          className={`${styles.heroArrow} ${styles.prev} gv-hero-arrow`}
          onClick={() => go(-1)}
          aria-label="الشريحة السابقة"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            aria-hidden="true"
          >
            <path d="M15 6 9 12l6 6" />
          </svg>
        </button>

        {/* Next */}
        <button
          type="button"
          className={`${styles.heroArrow} ${styles.next} gv-hero-arrow`}
          onClick={() => go(1)}
          aria-label="الشريحة التالية"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>

        {/* Slide navigation */}
        <div
          className={styles.heroDots}
          aria-label="التنقل بين الشرائح"
        >
          {SLIDES.map((item, slideIndex) => (
            <button
              key={item.title}
              type="button"
              className={
                slideIndex === index
                  ? "gv-dot-active"
                  : "gv-dot"
              }
              aria-current={
                slideIndex === index
              }
              aria-label={`الشريحة ${slideIndex + 1}: ${item.title}`}
              onClick={() => setIndex(slideIndex)}
            >
              <span>{item.number}</span>
            </button>
          ))}
        </div>

        {/* Progress */}
        <div className="gv-hero-progress" aria-hidden="true">
          <span
            key={index}
            style={{
              animationPlayState: isPaused
                ? "paused"
                : "running",
            }}
          />
        </div>

        {/* Bottom label */}
        <div className="gv-hero-bottom-label">
          <span>GAMEVORTEX HUB</span>
          <i />
          <span>PLAY WITHOUT LIMITS</span>
        </div>
      </section>

      <style jsx>{`
        .gv-new-hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          min-height: clamp(430px, 58vw, 650px);
          border-radius: 28px;
          background: #070914;
          border: 1px solid rgba(255, 255, 255, 0.09);
          box-shadow:
            0 25px 80px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        .gv-hero-background {
          position: absolute;
          inset: 0;
          z-index: -2;
          pointer-events: none;
        }

        .gv-grid {
          position: absolute;
          inset: -30%;
          opacity: 0.22;
          transform: perspective(500px) rotateX(58deg)
            translateY(35%);
          background-image:
            linear-gradient(
              rgba(255, 255, 255, 0.06) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.06) 1px,
              transparent 1px
            );
          background-size: 45px 45px;
          mask-image: linear-gradient(
            to bottom,
            transparent,
            black 35%,
            transparent
          );
        }

        .gv-glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.42;
        }

        .gv-glow-one {
          width: 320px;
          height: 320px;
          top: -100px;
          right: 18%;
          background: var(--gv-accent);
        }

        .gv-glow-two {
          width: 280px;
          height: 280px;
          bottom: -150px;
          left: 18%;
          background: var(--gv-accent-2);
        }

        .gv-orbit {
          position: absolute;
          border: 1px solid
            color-mix(
              in srgb,
              var(--gv-accent) 35%,
              transparent
            );
          border-radius: 50%;
          transform: rotate(-22deg);
        }

        .gv-orbit-one {
          width: 550px;
          height: 180px;
          right: -130px;
          top: 80px;
        }

        .gv-orbit-two {
          width: 450px;
          height: 150px;
          right: -80px;
          top: 95px;
          transform: rotate(28deg);
          opacity: 0.55;
        }

        .gv-hero-number {
          position: absolute;
          left: 32px;
          top: 28px;
          font-size: 11px;
          letter-spacing: 0.25em;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.38);
          writing-mode: vertical-rl;
        }

        .gv-hero-eyebrow {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 16px;
          color: rgba(255, 255, 255, 0.62);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.14em;
        }

        .gv-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--gv-accent);
          box-shadow: 0 0 14px var(--gv-accent);
        }

        .gv-hero-title-wrap {
          position: relative;
          width: fit-content;
        }

        .gv-hero-badge {
          display: inline-flex;
          margin-bottom: 10px;
          padding: 5px 10px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.045);
          color: rgba(255, 255, 255, 0.58);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.16em;
        }

        .gv-hero-title {
          margin: 0;
          max-width: 720px;
          font-size: clamp(38px, 6vw, 78px);
          line-height: 0.98;
          font-weight: 950;
          letter-spacing: -0.045em;
          color: #fff;
          text-wrap: balance;
          text-shadow: 0 15px 50px rgba(0, 0, 0, 0.35);
          animation: gv-title-in 0.5s ease both;
        }

        .gv-hero-subtitle {
          max-width: 620px;
          margin: 22px 0 0;
          color: rgba(255, 255, 255, 0.64);
          font-size: clamp(13px, 1.6vw, 16px);
          line-height: 1.9;
          animation: gv-content-in 0.6s ease both;
        }

        .gv-hero-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 28px;
          animation: gv-content-in 0.7s ease both;
        }

        .gv-primary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 48px;
          padding: 0 22px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          background:
            linear-gradient(
              135deg,
              var(--gv-accent),
              var(--gv-accent-2)
            );
          color: #fff;
          box-shadow:
            0 12px 30px
              color-mix(
                in srgb,
                var(--gv-accent) 25%,
                transparent
              ),
            inset 0 1px 0 rgba(255, 255, 255, 0.28);
          transition:
            transform 0.25s ease,
            box-shadow 0.25s ease;
        }

        .gv-primary-button:hover {
          transform: translateY(-3px);
          box-shadow:
            0 18px 42px
              color-mix(
                in srgb,
                var(--gv-accent) 35%,
                transparent
              ),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }

        .gv-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 48px;
          padding: 0 19px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.045);
          color: rgba(255, 255, 255, 0.78);
          backdrop-filter: blur(14px);
          transition:
            background 0.25s ease,
            transform 0.25s ease;
        }

        .gv-secondary-button:hover {
          background: rgba(255, 255, 255, 0.09);
          transform: translateY(-2px);
        }

        .gv-hero-visual {
          position: absolute;
          width: min(47%, 570px);
          aspect-ratio: 1;
          right: 3%;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
        }

        .gv-visual-shadow {
          position: absolute;
          width: 55%;
          height: 18%;
          left: 23%;
          bottom: 16%;
          border-radius: 50%;
          background: #000;
          filter: blur(25px);
          opacity: 0.7;
        }

        .gv-visual-orbit {
          position: absolute;
          inset: 14%;
          border: 1px solid
            color-mix(
              in srgb,
              var(--gv-accent) 45%,
              transparent
            );
          border-radius: 50%;
          transform: rotate(35deg) scaleY(0.35);
          animation: gv-spin 12s linear infinite;
        }

        .gv-visual-orbit-b {
          inset: 5%;
          transform: rotate(-45deg) scaleY(0.35);
          border-color: color-mix(
            in srgb,
            var(--gv-accent-2) 40%,
            transparent
          );
          animation-duration: 16s;
          animation-direction: reverse;
        }

        .gv-visual-core {
          position: absolute;
          width: 48%;
          aspect-ratio: 1;
          left: 26%;
          top: 24%;
          display: grid;
          place-items: center;
          border-radius: 32%;
          transform: rotate(-8deg);
          background:
            radial-gradient(
              circle at 35% 25%,
              rgba(255, 255, 255, 0.28),
              transparent 18%
            ),
            linear-gradient(
              145deg,
              var(--visual-accent),
              #11152c 48%,
              var(--visual-accent-2)
            );
          box-shadow:
            0 0 70px
              color-mix(
                in srgb,
                var(--visual-accent) 35%,
                transparent
              ),
            inset 0 1px 1px rgba(255, 255, 255, 0.4),
            inset 0 -20px 50px rgba(0, 0, 0, 0.45);
          animation: gv-float 5s ease-in-out infinite;
        }

        .gv-core-inner {
          width: 75%;
          height: 75%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-radius: 26%;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(4, 6, 18, 0.58);
          backdrop-filter: blur(12px);
          transform: rotate(8deg);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
        }

        .gv-core-small {
          color: rgba(255, 255, 255, 0.5);
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.3em;
        }

        .gv-core-inner strong {
          margin: 6px 0;
          color: #fff;
          font-size: clamp(22px, 4vw, 46px);
          font-weight: 950;
          letter-spacing: -0.06em;
        }

        .gv-floating-card {
          position: absolute;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 90px;
          padding: 11px 14px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          background: rgba(10, 13, 30, 0.6);
          backdrop-filter: blur(18px);
          box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
        }

        .gv-floating-card span {
          color: rgba(255, 255, 255, 0.42);
          font-size: 7px;
          font-weight: 800;
          letter-spacing: 0.12em;
        }

        .gv-floating-card strong {
          color: #fff;
          font-size: 16px;
          font-weight: 900;
        }

        .gv-card-one {
          right: 5%;
          top: 18%;
          animation: gv-float-card 4.5s ease-in-out infinite;
        }

        .gv-card-two {
          left: 2%;
          top: 42%;
          animation: gv-float-card 5.5s 0.5s ease-in-out infinite;
        }

        .gv-card-three {
          right: 13%;
          bottom: 10%;
          animation: gv-float-card 5s 1s ease-in-out infinite;
        }

        .gv-hero-arrow {
          z-index: 5;
          width: 42px !important;
          height: 42px !important;
          border-radius: 13px !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
          background: rgba(255, 255, 255, 0.045) !important;
          backdrop-filter: blur(12px);
          transition:
            transform 0.2s ease,
            background 0.2s ease;
        }

        .gv-hero-arrow:hover {
          transform: scale(1.08);
          background: rgba(255, 255, 255, 0.1) !important;
        }

        .gv-dot,
        .gv-dot-active {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 22px;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
        }

        .gv-dot span,
        .gv-dot-active span {
          font-size: 8px;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.35);
        }

        .gv-dot::after,
        .gv-dot-active::after {
          content: "";
          position: absolute;
          bottom: -2px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
        }

        .gv-dot-active span {
          color: #fff;
        }

        .gv-dot-active::after {
          width: 18px;
          border-radius: 99px;
          background: var(--gv-accent);
          box-shadow: 0 0 12px var(--gv-accent);
        }

        .gv-hero-progress {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: rgba(255, 255, 255, 0.05);
        }

        .gv-hero-progress span {
          display: block;
          width: 100%;
          height: 100%;
          transform-origin: right;
          background: linear-gradient(
            90deg,
            var(--gv-accent),
            var(--gv-accent-2)
          );
          animation: gv-progress 6.5s linear;
        }

        .gv-hero-bottom-label {
          position: absolute;
          left: 30px;
          bottom: 23px;
          display: flex;
          align-items: center;
          gap: 9px;
          color: rgba(255, 255, 255, 0.28);
          font-size: 7px;
          font-weight: 800;
          letter-spacing: 0.18em;
        }

        .gv-hero-bottom-label i {
          width: 20px;
          height: 1px;
          background: rgba(255, 255, 255, 0.18);
        }

        @keyframes gv-title-in {
          from {
            opacity: 0;
            transform: translateY(15px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes gv-content-in {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes gv-float {
          0%,
          100% {
            transform: rotate(-8deg) translateY(0);
          }
          50% {
            transform: rotate(-5deg) translateY(-12px);
          }
        }

        @keyframes gv-float-card {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }

        @keyframes gv-spin {
          from {
            transform: rotate(0deg) scaleY(0.35);
          }
          to {
            transform: rotate(360deg) scaleY(0.35);
          }
        }

        @keyframes gv-progress {
          from {
            transform: scaleX(0);
          }
          to {
            transform: scaleX(1);
          }
        }

        @media (max-width: 900px) {
          .gv-new-hero {
            min-height: 570px;
            border-radius: 22px;
          }

          .gv-hero-visual {
            width: 58%;
            right: -8%;
            top: 48%;
            opacity: 0.72;
          }

          .gv-hero-number {
            left: 18px;
          }

          .gv-hero-bottom-label {
            left: 20px;
          }
        }

        @media (max-width: 640px) {
          .gv-new-hero {
            min-height: 570px;
            border-radius: 18px;
          }

          .gv-hero-visual {
            width: 72%;
            right: -18%;
            top: 51%;
            opacity: 0.38;
          }

          .gv-hero-number {
            display: none;
          }

          .gv-hero-title {
            max-width: 88%;
            font-size: clamp(36px, 11vw, 52px);
            line-height: 1.04;
          }

          .gv-hero-subtitle {
            max-width: 94%;
            margin-top: 17px;
            font-size: 12px;
            line-height: 1.85;
          }

          .gv-hero-actions {
            flex-direction: column;
            align-items: stretch;
            width: min(100%, 250px);
            margin-top: 22px;
          }

          .gv-primary-button,
          .gv-secondary-button {
            width: 100%;
          }

          .gv-secondary-button {
            min-height: 42px;
          }

          .gv-floating-card {
            transform: scale(0.78);
          }

          .gv-card-one {
            right: 0;
          }

          .gv-card-two {
            left: 0;
          }

          .gv-card-three {
            right: 8%;
          }

          .gv-hero-bottom-label {
            bottom: 17px;
            font-size: 6px;
          }

          .gv-hero-arrow {
            width: 36px !important;
            height: 36px !important;
          }

          .gv-grid {
            background-size: 32px 32px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gv-new-hero *,
          .gv-new-hero *::before,
          .gv-new-hero *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
    </>
  );
}
