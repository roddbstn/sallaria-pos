/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        green:  '#017333',
        'green-soft': '#E6F4EC',
        ink:    '#1E1E1E',
        'gray-text':   '#727272',
        'gray-border': '#D7D7D7',
        'gray-bg':     '#FAFAFA',
        danger: '#C92A2A',
      },
    },
  },
  plugins: [],
}
