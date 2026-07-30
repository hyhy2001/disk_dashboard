import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--bg-base)',
        ring: 'var(--accent)',
        background: 'var(--bg-base)',
        foreground: 'var(--text)',
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: '#000',
        },
        secondary: {
          DEFAULT: 'var(--bg-raised)',
          foreground: 'var(--text-muted)',
        },
        muted: {
          DEFAULT: 'var(--bg-hover)',
          foreground: 'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--bg-active)',
          foreground: 'var(--accent)',
        },
        destructive: {
          DEFAULT: 'var(--rose-400)',
          foreground: '#fff',
        },
        card: {
          DEFAULT: 'var(--bg-surface)',
          foreground: 'var(--text)',
        },
        popover: {
          DEFAULT: 'var(--bg-surface)',
          foreground: 'var(--text)',
        },
        sidebar: {
          DEFAULT: 'var(--bg-raised)',
          foreground: 'var(--text)',
          muted: 'var(--text-muted)',
          accent: 'var(--bg-active)',
          'accent-foreground': 'var(--accent)',
          border: 'var(--border)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        sans: ['Fira Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'SFMono-Regular', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s var(--ease-out)',
        'slide-up': 'slide-up 0.2s var(--ease-spring)',
      },
    },
  },
  plugins: [animate],
} satisfies Config
