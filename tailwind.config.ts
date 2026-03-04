import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#D4622B', dark: '#C0571F', light: 'rgba(212,98,43,0.06)' },
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
