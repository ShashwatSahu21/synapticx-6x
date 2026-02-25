/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        neural: {
          bg: "#06060f",
          panel: "#0d0d1a",
          border: "#1a1a2e",
          cyan: "#00d4ff",
          blue: "#0057ff",
          dim: "#1e2440",
          muted: "#3a3f5c",
          text: "#c8d0e8",
          glow: "rgba(0,212,255,0.15)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(0,212,255,0.18), 0 0 60px rgba(0,212,255,0.06)",
        "glow-sm": "0 0 10px rgba(0,212,255,0.15)",
        panel: "0 4px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "fade-in": "fadeIn 0.4s ease-out",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: 0, transform: "translateY(4px)" }, "100%": { opacity: 1, transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};
