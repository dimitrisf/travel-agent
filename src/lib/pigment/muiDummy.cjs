// Dummy module returned to Pigment CSS's static-analysis phase for any
// import from @mui/* or @emotion/*. Pigment (wyw-in-js) walks the
// module graph of user files and tries to load these packages so it
// can evaluate expressions — the newer @mui/system ESM output crashes
// wyw's shaker (Pigment 0.0.31 targets ^6.1, installed is 6.5.x).
//
// The dummy is a Proxy that answers every property access with a
// no-op function or itself, and behaves as a callable/constructable
// so patterns like `styled(...)`, `createTheme(...)`, `Box.<x>` all
// evaluate to something without triggering further module loads.
//
// This only affects Pigment's build-time analysis. At runtime, the
// real @mui and @emotion modules are bundled by webpack as normal.

const noop = function () {
  return handler;
};
const handler = new Proxy(noop, {
  get(target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return handler;
    if (typeof prop === 'symbol') return undefined;
    return handler;
  },
  apply() {
    return handler;
  },
  construct() {
    return handler;
  },
});

module.exports = handler;
module.exports.default = handler;
