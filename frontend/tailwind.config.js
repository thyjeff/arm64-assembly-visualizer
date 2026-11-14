/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        piDark: '#0f172a',
        piCard: '#1e293b',
        piAccent: '#38bdf8',
        piHighlight: '#f59e0b',
        piSuccess: '#10b981',
        piRaspberry: '#c51a4a'
      }
    },
  },
  plugins: [],
}
