import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: "#0B0F14",
        elevated: "#121821",
        subtle: "#1A2330",
        line: "#243044",
        ink: {
          950: "#0B0F14",
          900: "#121821",
          800: "#1A2330",
          700: "#243044",
        },
        accent: {
          DEFAULT: "#2DD4BF",
          dim: "#0F766E",
          soft: "#5EEAD4",
        },
        gold: {
          DEFAULT: "#E8C547",
          soft: "#F5E6A3",
        },
        signal: {
          raise: "#38BDF8",
          grad: "#34D399",
          warn: "#FBBF24",
          danger: "#F87171",
        },
        fg: {
          primary: "#F4F7FB",
          secondary: "#9AA8BC",
          muted: "#6B7A8F",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "12px",
        pill: "999px",
        input: "8px",
      },
      boxShadow: {
        glow: "0 0 40px rgba(45, 212, 191, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
