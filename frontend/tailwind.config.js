export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Penn State blue-and-white palette, used by the sign-in page.
      colors: {
        psu: {
          navy: '#001E44',    // Nittany Navy: text, primary button
          beaver: '#1E407C',  // Beaver Blue: hover, near ridge
          pugh: '#96BEE6',    // Pugh Blue: sky, far ridge
          slate: '#475A73',   // secondary text on white/sky
          mist: '#F3F8FC',    // horizon haze
        },
        // Neutral greys used across the widgets (`stone-*`), cooled toward PSU navy
        // so cards, reviews and the profile page match the blue-and-white theme.
        stone: {
          50: '#F6F8FB',
          100: '#EEF2F7',
          200: '#DFE6EF',
          300: '#C9D3E0',
          400: '#97A6BA',
          500: '#6B7B90',
          600: '#4F6178',
          700: '#3A4B62',
          800: '#24354C',
          900: '#13243A',
        },
      },
      fontFamily: {
        landing: ['"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
