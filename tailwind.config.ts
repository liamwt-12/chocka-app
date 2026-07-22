import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sourced from the resolved tenant via CSS vars injected on :root
        // (see lib/tenant.ts tenantCssVars). Channel form keeps Tailwind opacity
        // modifiers (bg-brand/20, ring-brand/50, shadow-brand/30) working.
        brand: {
          DEFAULT: 'rgb(var(--brand-rgb) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark-rgb) / <alpha-value>)',
          light: 'var(--brand-light)',
        },
        slate: '#1C2331',
        cream: '#F8F6F3',
        gold: '#E7C36A',
        charcoal: '#1C2331',
        muted: '#7A8190',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
