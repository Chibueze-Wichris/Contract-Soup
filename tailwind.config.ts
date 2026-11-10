import type { Config } from "tailwindcss";

/**
 * Tailwind v4 reads this file through the `@config` directive in src/index.css.
 * Every colour maps to a CSS variable so light and dark themes switch
 * by changing variables only. Token values live in src/index.css.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        brand: {
          DEFAULT: "var(--brand)",
          hover: "var(--brand-hover)",
          soft: "var(--brand-soft)",
          on: "var(--brand-on)",
        },
        amber: {
          DEFAULT: "var(--amber)",
          soft: "var(--amber-soft)",
        },
        high: {
          DEFAULT: "var(--high)",
          ink: "var(--high-ink)",
          soft: "var(--high-soft)",
        },
        medium: {
          DEFAULT: "var(--medium)",
          ink: "var(--medium-ink)",
          soft: "var(--medium-soft)",
        },
        low: {
          DEFAULT: "var(--low)",
          ink: "var(--low-ink)",
          soft: "var(--low-soft)",
        },
        success: {
          DEFAULT: "var(--success)",
          ink: "var(--success-ink)",
          soft: "var(--success-soft)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      // Strict type scale: 12 / 14 / 16 / 20 / 28 / 40
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["14px", { lineHeight: "20px" }],
        base: ["16px", { lineHeight: "24px" }],
        lg: ["20px", { lineHeight: "28px", letterSpacing: "-0.015em" }],
        xl: ["28px", { lineHeight: "36px", letterSpacing: "-0.02em" }],
        display: ["40px", { lineHeight: "48px", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        pop: "var(--shadow-pop)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out both",
        "slide-up": "slide-up 180ms ease-out both",
        "slide-in-right": "slide-in-right 200ms ease-out both",
      },
    },
  },
};

export default config;
