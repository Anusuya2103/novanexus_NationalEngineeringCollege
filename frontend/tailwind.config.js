/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        brand: { 400: '#22D3EE', 500: '#06B6D4', 600: '#0891B2' },
      },
      maxWidth: { '8xl': '1920px' },
    },
  },
  plugins: [],
}
