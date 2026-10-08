import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: "#0D1215",
        elevated: "#151C20",
        subtle: "#1C252A",
        line: "#2C393E",
        ink: {
          950: "#0D1215",
          900: "#151C20",
          800: "#1C252A",
          700: "#2C393E",
        },
        accent: {
          DEFAULT: "#6DE0C5",
          dim: "#0F766E",
          soft: "#A3EEDC",
        },
        gold: {
          DEFAULT: "#E8C547",
          soft: "#F5E6A3",
        },
        signal: {
          ok: "#6DE0C5",
          raise: "#38BDF8",
          grad: "#34D399",
          warn: "#FBBF24",
          danger: "#F87171",
        },
        fg: {
          primary: "#F0F4F3",
          secondary: "#ACB8BC",
          muted: "#899B9F",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "16px",
        pill: "999px",
        input: "10px",
      },
      boxShadow: {
        glow: "0 0 40px rgba(45, 212, 191, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
