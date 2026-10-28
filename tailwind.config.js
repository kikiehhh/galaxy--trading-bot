/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        galaxy: {
          50: '#f0f4ff',
          100: '#dbe6ff',
          200: '#bccfff',
          300: '#8eadff',
          400: '#5b82ff',
          500: '#3358ff',
          600: '#1e3df5',
          700: '#172ee0',
          800: '#1828b4',
          900: '#1a288e',
          950: '#131a58',
        },
        neon: {
          cyan: '#22d3ee',
          green: '#34d399',
          lime: '#a3e635',
          yellow: '#facc15',
          orange: '#fb923c',
          red: '#f87171',
          pink: '#f472b6',
          purple: '#a78bfa',
        },
        space: {
          900: '#060818',
          800: '#0a0e26',
          700: '#101436',
          600: '#171c4a',
          500: '#1f2566',
          400: '#2a3290',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'spin-slow': 'spin 8s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'ticker': 'ticker 30s linear infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.7', filter: 'brightness(1.3)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'galaxy-radial': 'radial-gradient(ellipse at top, #171c4a 0%, #060818 60%)',
        'star-field': "radial-gradient(1px 1px at 25% 15%, rgba(255,255,255,0.5), transparent), radial-gradient(1px 1px at 60% 40%, rgba(255,255,255,0.3), transparent), radial-gradient(1px 1px at 80% 70%, rgba(255,255,255,0.4), transparent), radial-gradient(1px 1px at 15% 80%, rgba(255,255,255,0.3), transparent)",
      },
    },
  },
  plugins: [],
};
