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
      // Accessibility bump: the default 12px xs / 14px sm body text is too small
      // for most screens, so every named size is raised while keeping the same
      // relative hierarchy. The line-heights stay in step so descenders and
      // tight rows are not clipped.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
        sm: ['1rem', { lineHeight: '1.5rem' }],
        base: ['1.125rem', { lineHeight: '1.75rem' }],
        lg: ['1.25rem', { lineHeight: '1.875rem' }],
        xl: ['1.375rem', { lineHeight: '2rem' }],
        '2xl': ['1.625rem', { lineHeight: '2.25rem' }],
        '3xl': ['2rem', { lineHeight: '2.5rem' }],
        '4xl': ['2.375rem', { lineHeight: '2.75rem' }],
        '5xl': ['3rem', { lineHeight: '1' }],
        '6xl': ['3.75rem', { lineHeight: '1' }],
        '7xl': ['4.5rem', { lineHeight: '1' }],
        '8xl': ['6rem', { lineHeight: '1' }],
        '9xl': ['8rem', { lineHeight: '1' }],
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
