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
      },
      fontFamily: {
        landing: ['"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
