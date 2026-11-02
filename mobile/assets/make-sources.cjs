const sharp = require("sharp");
const BUBBLE = 'M32 14c-9.4 0-17 7-17 15.6 0 4.9 2.5 9.3 6.4 12.1L20 50l8.6-4.3c1.1.2 2.2.3 3.4.3 9.4 0 17-7 17-15.6S41.4 14 32 14z';
// Full-bleed square icon (stores round the corners themselves; iOS forbids transparency).
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024"><rect width="64" height="64" fill="#16161d"/><path d="${BUBBLE}" fill="#8b93ff"/></svg>`;
// Android adaptive icon foreground: bubble inside the 66% safe zone, transparent around it.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024"><path d="${BUBBLE}" fill="#8b93ff"/></svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#16161d"/></svg>`;
// Splash: black screen with the rounded app icon in the middle.
const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732" width="2732" height="2732"><rect width="2732" height="2732" fill="#000"/><g transform="translate(1146 1146) scale(7.1875)"><rect width="64" height="64" rx="15" fill="#16161d"/><path d="${BUBBLE}" fill="#8b93ff"/></g></svg>`;
(async () => {
  await sharp(Buffer.from(full)).png().toFile("icon-only.png");
  await sharp(Buffer.from(fg)).png().toFile("icon-foreground.png");
  await sharp(Buffer.from(bg)).png().toFile("icon-background.png");
  await sharp(Buffer.from(splash)).png().toFile("splash.png");
  await sharp(Buffer.from(splash)).png().toFile("splash-dark.png");
  console.log("ok");
})();
