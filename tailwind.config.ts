import type { Config } from "tailwindcss"

// The design system lives in app/broker-theme.css as CSS custom properties (ported from
// fe-gmq's partner-theme.css, PLAN.md section 13). Tailwind reads those tokens rather than
// redefining them, so changing --p-brand in one place changes the whole product.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--p-brand)",
          dark: "var(--p-brand-dark)",
          light: "var(--p-brand-light)",
        },
        surface: "var(--p-surface)",
        canvas: "var(--p-bg)",
        line: "var(--p-border)",
        ink: {
          DEFAULT: "var(--p-text)",
          secondary: "var(--p-text-secondary)",
          tertiary: "var(--p-text-tertiary)",
        },
      },
      borderRadius: {
        card: "var(--p-radius)",
        lg: "var(--p-radius-lg)",
        xl: "var(--p-radius-xl)",
      },
      spacing: {
        nav: "var(--p-nav-h)",
        topbar: "var(--p-topbar-h)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

export default config
