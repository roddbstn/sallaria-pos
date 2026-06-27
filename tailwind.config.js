/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        green:         'var(--green)',
        'green-soft':  'var(--green-soft)',
        ink:           'var(--ink)',
        'gray-text':   'var(--gray-text)',
        'gray-border': 'var(--gray-border)',
        'gray-bg':     'var(--gray-bg)',
        danger:        'var(--danger)',
        surface:       'var(--surface)',
      },
    },
  },
  plugins: [],
}
