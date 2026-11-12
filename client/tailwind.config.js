/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#000000',
        surface: '#0a0a0a',
        surfaceHover: '#141414',
        borderMuted: '#222222',
        foreground: '#ededed',
        muted: '#888888',
      },
      fontFamily: {
        display: ['Pobeda', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        inter: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
