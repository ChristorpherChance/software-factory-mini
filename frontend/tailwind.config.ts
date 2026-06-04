import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
          subtle: "var(--primary-subtle)",
        },
        text: {
          DEFAULT: "var(--text)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        bg: {
          DEFAULT: "var(--bg)",
          subtle: "var(--bg-subtle)",
          elevated: "var(--bg-elevated)",
        },
        border: "var(--border)",
        success: { DEFAULT: "var(--success)", subtle: "var(--success-subtle)" },
        warning: { DEFAULT: "var(--warning)", subtle: "var(--warning-subtle)" },
        error: { DEFAULT: "var(--error)", subtle: "var(--error-subtle)" },
        info: "var(--info)",
        diff: {
          add: "var(--diff-add)",
          del: "var(--diff-del)",
          mod: "var(--diff-mod)",
        },
        pending: "var(--pending)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,.06)",
        md: "0 4px 12px rgba(0,0,0,.10)",
      },
      zIndex: {
        dropdown: "1000",
        drawer: "1100",
        modal: "1200",
        toast: "1300",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
