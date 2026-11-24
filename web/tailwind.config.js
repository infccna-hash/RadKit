/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#14232e', soft: '#3d4f5c', mute: '#6b7c88' },
        paper: { DEFAULT: '#f6f4ef', card: '#ffffff', line: '#e4e0d6' },
        brand: { 50: '#ecf6f5', 100: '#d0ebe8', 500: '#1f8a83', 600: '#167069', 700: '#115752' },
        signal: { urgent: '#c2410c', ok: '#15803d', warn: '#b45309' },
      },
      boxShadow: { card: '0 1px 0 rgba(20,35,46,.04), 0 1px 3px rgba(20,35,46,.06)' },
    },
  },
  plugins: [],
};
