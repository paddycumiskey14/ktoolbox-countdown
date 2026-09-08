// Piscina worker entry point. Runs GIF generation (color quantization and
// LZW encoding, both synchronous CPU-bound JS) in a separate thread, so a
// single slow render can no longer block the main thread from accepting and
// serving other requests -- important once many people open the same
// campaign around the same time.
const { renderCountdownGIF } = require('./lib/timer-render');

module.exports = async function generateGif(cfg) {
  return renderCountdownGIF(cfg);
};
