import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPigment } from '@pigment-css/nextjs-plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@prisma/client', '@openai/agents'],
};

// Pigment CSS runs alongside Emotion. It only processes files that import
// from '@pigment-css/react', so the interactive MUI/Emotion tree is
// untouched. Used by the static Explorer index and its presentational
// components so they can render as pure server components with
// zero-runtime CSS. Turbopack is not supported by the plugin — keep
// `next dev` on Webpack.
//
// The `asyncResolve` override redirects every @mui/* and @emotion/*
// import to a Proxy dummy during Pigment's static-analysis walk of the
// module graph. wyw-in-js (Pigment's engine) walks user-code imports to
// evaluate expressions; the installed @mui/system 6.5.x ESM crashes
// wyw's shaker (Pigment 0.0.31 targets ^6.1). The Pigment components
// on this app don't reach into @mui at all, so a dummy is safe. Webpack
// still bundles the real modules at runtime — this only intercepts
// Pigment's analysis pass.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUI_DUMMY = path.join(__dirname, 'src', 'lib', 'pigment', 'muiDummy.cjs');
const MUI_EMOTION_RE = /^(@mui\/|@emotion\/)/;

export default withPigment(nextConfig, {
  // Pigment's `sx` babel transform is global — it rewrites every
  // `sx={{...}}` prop on any element, including MUI Box/Typography.
  // It doesn't know MUI's shorthands (`p`, `mt`, spacing units), so
  // `<Box sx={{ p: 3 }}>` gets emitted as invalid CSS (`p: 3px`) and
  // MUI's real padding is lost. Emotion still owns MUI's sx at
  // runtime, so opting Pigment out is safe.
  transformSx: false,
  async asyncResolve(what) {
    if (MUI_EMOTION_RE.test(what)) {
      return MUI_DUMMY;
    }
    return null;
  },
});
