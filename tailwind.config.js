/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './app/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brutalist minimal palette
        primary: '#222222',   // dark gray
        secondary: '#f5f5f5', // off‑white
        accent: '#ff6f61',    // muted coral for accents
      },
      boxShadow: {
        brutal: '4px 4px 0 0 #000',
      },
      borderWidth: {
        brutal: '2px',
      },
    },
  },
  plugins: [],
};
