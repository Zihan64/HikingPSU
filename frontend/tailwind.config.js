export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Penn State navy palette: kept for the logo and badge only.
        psu: {
          navy: '#001E44',
          beaver: '#1E407C',
          pugh: '#96BEE6',
          slate: '#475A73',
          mist: '#F3F8FC',
        },
        // Outdoor theme: sky above, sun, forest and warm earth below.
        trail: {
          ink: '#173A40',     // text: deep teal ink, reads on both sky and meadow
          slate: '#4F6466',   // secondary text
          forest: '#2F6B47',  // primary buttons
          leaf: '#3E8558',    // hover
          sage: '#EEF5E8',    // light fills
          sky: '#2C7FBF',     // links
          sun: '#F5B83D',     // sunlight accents
          bark: '#7A5434',    // tree trunks, warm earth
          amber: '#D2873C',   // autumn foliage
        },
      },
      fontFamily: {
        landing: ['"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
