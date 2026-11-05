import type { Config } from "tailwindcss"
import tailwindcssAnimate from "tailwindcss-animate"

const config = {
  darkMode: ['class'],
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      fontFamily: {
        sans: ['Euclid Circular A', 'system-ui', 'sans-serif'],
        serif: ['Crimson Pro', 'Georgia', 'serif'],
      },
      colors: {
        /**
         * KU red. Use `brand`/`brand-foreground` (or `primary`, which points at
         * the same token) instead of Tailwind's `red-*` scale — the literals
         * are what let /project and the rest of the app drift into two
         * different brand colours. `scripts/check-brand-literals.sh` fails CI
         * on a new hardcoded `red-<n>` utility.
         *
         * `tint` and `line` are the low-alpha variants /project used for card
         * hovers and gradient stops, named so they survive a palette change.
         */
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
          tint: 'hsl(var(--brand) / 0.05)',
          line: 'hsl(var(--brand) / 0.4)',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        // Floating surfaces (menus, popovers, dialogs, toasts) and cards. Until
        // 2026-11-05 these were undefined here, so `bg-card` / `bg-popover`
        // compiled to NOTHING: every workbench card was transparent, and so was
        // ChatRevealTab, which floats over content. Ported from platform-source
        // (b374e6b9, 2026-10-02). Falls back to the page colours.
        popover: {
          DEFAULT: 'hsl(var(--popover, var(--background)))',
          foreground: 'hsl(var(--popover-foreground, var(--foreground)))',
        },
        card: {
          DEFAULT: 'hsl(var(--card, var(--background)))',
          foreground: 'hsl(var(--card-foreground, var(--foreground)))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config

export default config
