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
          bg: '#050505', // Deep luxurious black
          card: '#11100e', // Very dark brown-tinted black for depth
          hover: '#1c1a17',
          accent: '#D4AF37', // Classic metallic gold
          'accent-hover': '#F3E5AB', // Light gold shimmer
          text: '#eaeaea',
          secondary: '#a19d94',
          muted: '#5e5a51',
          border: '#362b16', // Dark gold/bronze border
          gold: {
            light: '#F3E5AB',
            DEFAULT: '#D4AF37',
            dark: '#AA7C11',
          }
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #F3E5AB 0%, #D4AF37 50%, #AA7C11 100%)',
        'gold-border': 'linear-gradient(90deg, rgba(170,124,17,0.3), #D4AF37, rgba(170,124,17,0.3))',
        'gold-shimmer': 'linear-gradient(90deg, transparent, rgba(212,175,55,0.15), transparent)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.3s ease-out',
      }
    },
  },
  plugins: [],
};
export default config;
