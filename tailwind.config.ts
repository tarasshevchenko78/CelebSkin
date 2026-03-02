import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0a0a0f',
          card: '#12121a',
          hover: '#1a1a2e',
          accent: '#e50914',
          'accent-hover': '#ff1a25',
          text: '#e5e5e5',
          secondary: '#888888',
          muted: '#555555',
          border: '#1e1e2e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
