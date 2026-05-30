// Generates the Expo app icons from the Finlynq brand mark.
//
// The mark is the same geometry as src/components/FinlynqLogo.tsx — a rounded
// amber chart frame on the dark brand background (#0b0d10). Icons are baked at
// build time (not OTA-updatable), so re-run this then rebuild the APK/IPA via
// EAS to refresh the launcher icon + splash.
//
//   Run from pf-app/ (where `sharp` is installed):
//     node mobile/scripts/generate-app-icons.mjs
//
// Outputs (overwrites the Expo placeholders):
//   mobile/assets/icon.png           1024² dark bg, full mark   (iOS, no alpha)
//   mobile/assets/adaptive-icon.png  1024² transparent, mark in safe zone (Android fg)
//   mobile/assets/splash-icon.png    1024² transparent, centered mark (splash)
//   mobile/assets/favicon.png        196²  dark bg, mark        (web)

import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const AMBER = "#f5a623";
const BG = "#0b0d10"; // darkColors.background (matches the redesign theme)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const asset = (name) => path.join(__dirname, "..", "assets", name);

/** The amber mark, scaled+centered to occupy `fraction` of an S×S canvas. */
function mark(size, fraction) {
  const scale = (fraction * size) / 22; // mark artwork is authored in a 22-unit box
  const offset = (size * (1 - fraction)) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">
    <rect x="1" y="1" width="20" height="20" rx="2" fill="none" stroke="${AMBER}" stroke-width="1.5"/>
    <path d="M5 16 L5 9 L10 13 L10 6 L17 11" fill="none" stroke="${AMBER}" stroke-width="1.6" stroke-linejoin="miter" stroke-linecap="square"/>
    <circle cx="17" cy="11" r="1.6" fill="${AMBER}"/>
  </g>`;
}

function svg(size, fraction, { bg = null } = {}) {
  const background = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${background}${mark(size, fraction)}</svg>`;
}

async function render(name, size, fraction, opts) {
  const out = asset(name);
  await sharp(Buffer.from(svg(size, fraction, opts))).png().toFile(out);
  console.log(`wrote ${out} (${size}², mark ${Math.round(fraction * 100)}%${opts?.bg ? ", " + opts.bg : ", transparent"})`);
}

// iOS icon must be opaque (no alpha); Android adaptive foreground + splash are
// transparent so the platform background / splash color shows behind. The
// adaptive foreground is kept smaller so the mark stays inside Android's
// ~66%-diameter mask safe zone.
await render("icon.png", 1024, 0.52, { bg: BG });
await render("adaptive-icon.png", 1024, 0.46);
await render("splash-icon.png", 1024, 0.4);
await render("favicon.png", 196, 0.58, { bg: BG });

console.log("done.");
