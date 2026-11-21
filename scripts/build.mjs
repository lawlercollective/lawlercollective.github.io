// Builds the site into _site/.
//
//   photos/<folder>/*.jpg  ->  optimized AVIF + WebP images + static HTML pages
//
// Every folder in photos/ becomes a gallery page (gallery-<folder>.html),
// except the "home" folder from site.json, which fills "Our Recent Work".
// Processed images are cached in .cache/ by content hash, so only new or
// changed photos are re-encoded.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FINAL = path.join(ROOT, '_site');
const OUT = path.join(ROOT, '_site.tmp'); // built here, then swapped into _site/ in one step
const CACHE = path.join(ROOT, '.cache', 'images');
const PHOTOS = path.join(ROOT, 'photos');
const SRC = path.join(ROOT, 'src');

// Bump PIPELINE when changing sizes/quality so cached images are regenerated.
const PIPELINE = 'v2';
// Widths made for every photo. The page tells the browser each photo's exact
// on-screen width (src/grid.js), so it can pick the smallest one that's sharp.
const WIDTHS = [400, 800, 1200, 1600];
const FULL_SIZE = 2400;            // long edge: full-screen viewer and landing slideshow
// AVIF is ~20-30% smaller than WebP at the same quality; browsers without AVIF get WebP.
const FORMATS = {
  avif: (img) => img.avif({ quality: 52, effort: 4 }),
  webp: (img) => img.webp({ quality: 80 }),
};
const PHOTO_EXT = /\.(jpe?g|png|webp|avif|tiff?|heic|heif)$/i;

// Fallback size hint before src/grid.js sets each photo's exact width.
const GRID_SIZES = '(max-width: 700px) 45vw, (max-width: 1200px) 30vw, 360px';
// Landing slideshow: the photo covers the screen, so on tall screens it's wider than the screen.
const HERO_SIZES = '(max-aspect-ratio: 3/2) 150vh, 100vw';
const HERO_COUNT = 5;
const EAGER_COUNT = 8;

// site.json is re-read at the start of every build, so edits (including the photo
// manager's) show up in the running preview without restarting it.
let config = {};
const readConfig = async () => JSON.parse(await fs.readFile(path.join(ROOT, 'site.json'), 'utf8'));

const log = (...a) => console.log(...a);
const sha = (buf, n = 10) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const title = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const naturalSort = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

// ---------- images ----------

// Cache files used by this build; everything else in .cache/images is removed at the end.
const usedCache = new Set();

// Makes every size/format of one photo (cached by content hash).
// Returns { hash, width, height, color, sizes: [{ key, width }], files }.
async function processPhoto(file) {
  const buf = await fs.readFile(file);
  const hash = sha(Buffer.concat([buf, Buffer.from(PIPELINE)]));
  const metaFile = path.join(CACHE, `${hash}.json`);
  usedCache.add(`${hash}.json`);
  if (existsSync(metaFile)) {
    const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
    if (meta.files.every((f) => existsSync(path.join(CACHE, f)))) { meta.files.forEach((f) => usedCache.add(f)); return meta; }
  }

  // Decode once; every output is a clone. rotate() applies EXIF orientation, and
  // sharp drops all metadata (including GPS) from the outputs.
  const source = sharp(buf, { failOn: 'none' }).rotate();
  const m = await sharp(buf, { failOn: 'none' }).metadata(); // header only, no full decode
  const turned = (m.orientation || 1) >= 5; // EXIF orientations 5-8 swap width and height
  const ow = turned ? m.height : m.width;
  const oh = turned ? m.width : m.height;
  const longFull = Math.min(FULL_SIZE, Math.max(ow, oh));
  const fullW = ow >= oh ? longFull : Math.round((longFull * ow) / oh);

  // Unique output widths (a small original doesn't get upscaled copies).
  const sizes = [...new Set([...WIDTHS.filter((w) => w < fullW), fullW])].map((w) => ({ key: w === fullW ? 'full' : String(w), width: w }));
  const files = [];
  let height = 0;
  await Promise.all(sizes.flatMap(({ key, width }) => Object.entries(FORMATS).map(async ([ext, encode]) => {
    const { data, info } = await encode(source.clone().resize({ width })).toBuffer({ resolveWithObject: true });
    const name = `${hash}-${key}.${ext}`;
    await fs.writeFile(path.join(CACHE, name), data);
    files.push(name);
    if (key === 'full') height = info.height;
  })));

  const { dominant } = await source.clone().resize(64).stats();
  const color = '#' + [dominant.r, dominant.g, dominant.b].map((v) => Math.round(v * 0.6).toString(16).padStart(2, '0')).join('');

  files.forEach((f) => usedCache.add(f));
  const meta = { hash, width: fullW, height, color, sizes, files };
  await fs.writeFile(metaFile, JSON.stringify(meta));
  return meta;
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

function altText(filename, categoryTitle, n) {
  const stem = path.parse(filename).name
    .replace(/^(law|img|dsc[f]?|pxl|_mg|dji|gopr)[-_ ]?\d*/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return /[a-z]{3,}/i.test(stem) ? title(stem) : `${categoryTitle} photograph ${n}`;
}

async function buildCategory(slug) {
  const dir = path.join(PHOTOS, slug);
  const names = (await fs.readdir(dir)).filter((f) => PHOTO_EXT.test(f)).sort(naturalSort);
  const ignored = (await fs.readdir(dir)).filter((f) => !PHOTO_EXT.test(f) && !f.startsWith('.'));
  if (ignored.length) log(`  ! ${slug}: skipping non-photo files: ${ignored.join(', ')}`);

  const outDir = path.join(OUT, 'img', slug);
  await fs.mkdir(outDir, { recursive: true });
  const catTitle = title(slug);

  // AVIF encoding is CPU-heavy, so leave a core free.
  const photos = await pool(names, Math.max(1, os.cpus().length - 1), async (name, i) => {
    let meta;
    try {
      meta = await processPhoto(path.join(dir, name));
    } catch (err) {
      log(`  ! ${slug}/${name}: could not read this photo (${err.message.split('\n')[0]}). Export it as JPEG and try again.`);
      return null;
    }
    const stem = path.parse(name).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photo';
    const out = (key, ext) => `${stem}-${meta.hash.slice(0, 8)}-${key}.${ext}`;
    await Promise.all(meta.files.map((f) => {
      const [, key, ext] = f.match(/-([^-]+)\.(\w+)$/);
      return fs.copyFile(path.join(CACHE, f), path.join(outDir, out(key, ext)));
    }));
    const url = (key, ext) => `/img/${slug}/${out(key, ext)}`;
    const set = (ext, minWidth = 0) => meta.sizes
      .filter((s) => s.width >= minWidth || s.key === 'full')
      .map((s) => `${url(s.key, ext)} ${s.width}w`).join(', ');
    const mid = meta.sizes.find((s) => s.width >= 800) || meta.sizes[meta.sizes.length - 1];
    return {
      alt: altText(name, catTitle, i + 1),
      width: meta.width,
      height: meta.height,
      color: meta.color,
      srcset: { avif: set('avif'), webp: set('webp') },
      src: url(mid.key, 'webp'),
      full: url('full', 'webp'),
      fullAvif: url('full', 'avif'),
      big: { avif: set('avif', 800), webp: set('webp', 800) }, // landing slideshow
      file: name,
      hash: meta.hash,
      source: path.join(dir, name),
      slug,
    };
  });
  const ok = photos.filter(Boolean);
  log(`  ${slug}: ${ok.length} photos`);
  return ok;
}

// Right after each grid, src/grid.js (inlined in the page head) shuffles it (unless
// "shuffle": false in site.json), sets each photo's exact display width so the
// browser downloads the right size, marks the first few to load first, and lays
// out the rows, all before the grid is first drawn.
const gridScript = (eager, shuffled) =>
  `<script>__grid(document.currentScript.previousElementSibling,${eager},${shuffled})</script>`;

function gridHtml(photos, { eager = 0 } = {}) {
  const shuffled = config.shuffle !== false;
  const items = photos.map((p, i) => {
    const lazy = shuffled || i >= eager;
    const r = (p.width / p.height).toFixed(4);
    return `<a class="ph" href="${p.full}" data-avif="${p.fullAvif}" data-w="${p.width}" data-h="${p.height}" data-r="${r}" style="--r:${r}">` +
      `<picture><source type="image/avif" srcset="${p.srcset.avif}" sizes="${GRID_SIZES}">` +
      `<img src="${p.src}" srcset="${p.srcset.webp}" sizes="${GRID_SIZES}" width="${p.width}" height="${p.height}" ` +
      `alt="${esc(p.alt)}" style="background:${p.color}" decoding="async"` +
      (lazy ? ' loading="lazy"' : i < 2 ? ' fetchpriority="high"' : '') + `></picture></a>`;
  });
  return `<div class="grid">\n${items.join('\n')}\n</div>` + gridScript(eager, shuffled);
}

// ---------- pages ----------

async function main() {
  const started = Date.now();
  config = await readConfig();
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(CACHE, { recursive: true });
  await fs.mkdir(OUT, { recursive: true });

  // Categories: site.json order first, then any new folders alphabetically.
  const folders = (await fs.readdir(PHOTOS, { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name).sort(naturalSort);
  const galleries = [
    ...config.galleries.filter((g) => folders.includes(g)),
    ...folders.filter((f) => f !== config.home && !config.galleries.includes(f)),
  ];

  log('Processing photos…');
  const photos = {};
  for (const slug of [config.home, ...galleries]) {
    if (folders.includes(slug)) photos[slug] = await buildCategory(slug);
  }

  // Static assets
  await fs.cp(path.join(SRC, 'assets'), path.join(OUT, 'assets'), { recursive: true });
  const fontSrc = path.join(ROOT, 'node_modules/@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2');
  const fontBuf = await fs.readFile(fontSrc);
  const fontUrl = `/assets/montserrat-${sha(fontBuf, 8)}.woff2`;
  await fs.writeFile(path.join(OUT, fontUrl), fontBuf);
  if (existsSync(path.join(ROOT, 'CNAME'))) await fs.copyFile(path.join(ROOT, 'CNAME'), path.join(OUT, 'CNAME'));
  await fs.writeFile(path.join(OUT, '.nojekyll'), '');

  // Icons for every browser, phone and app. All are drawn from the white icon SVG
  // on black, so they stay visible on light and dark tabs alike.
  //  favicon.svg / favicon.ico / favicon-*.png: browser tabs, bookmarks, Windows, Google results
  //  apple-touch-icon.png: iPhone/iPad home screen (iOS also asks for it at the site root)
  //  icon-192/512 + icon-maskable-512: Android home screen and installed app (manifest)
  //  og-image.png: link previews in iMessage, Facebook, Slack, Discord and others
  const iconInner = (await inlineSvg('Lawler_Collective_Icon_White.svg', { label: '', width: 500, height: 500 }))
    .replace(/^<svg[^>]*>|<\/svg>$/g, '');
  // scale: how much of the square the round icon fills; round: corner rounding (0 = full square).
  const iconSvg = (scale, round) => {
    const off = (500 - 500 * scale) / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">` +
      `<rect width="500" height="500" rx="${round * 500}" fill="#000"/>` +
      `<g transform="translate(${off} ${off}) scale(${scale})">${iconInner}</g></svg>`;
  };
  const tabSvg = iconSvg(0.92, 0.22);
  const png = (svg, size) => sharp(Buffer.from(svg), { density: Math.max(72, Math.ceil((size / 500) * 72 * 4)) })
    .resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await fs.writeFile(path.join(OUT, 'favicon.svg'), tabSvg);
  const [p16, p32, p48, p96, p180, p192, p512, pMask] = await Promise.all([
    png(tabSvg, 16), png(tabSvg, 32), png(tabSvg, 48), png(tabSvg, 96),
    png(iconSvg(0.74, 0), 180), // iOS rounds the corners itself
    png(iconSvg(0.92, 0.22), 192), png(iconSvg(0.92, 0.22), 512),
    png(iconSvg(0.7, 0), 512), // Android crops maskable icons to a circle or squircle
  ]);
  await Promise.all([
    fs.writeFile(path.join(OUT, 'favicon.ico'), ico([[16, p16], [32, p32], [48, p48]])),
    fs.writeFile(path.join(OUT, 'favicon-96x96.png'), p96),
    fs.writeFile(path.join(OUT, 'apple-touch-icon.png'), p180),
    fs.writeFile(path.join(OUT, 'icon-192.png'), p192),
    fs.writeFile(path.join(OUT, 'icon-512.png'), p512),
    fs.writeFile(path.join(OUT, 'icon-maskable-512.png'), pMask),
  ]);
  // Link preview: the wordmark centered on black, 1200x630 (the size every platform expects).
  const wordSvg = (await fs.readFile(path.join(SRC, 'assets', 'Lawler_Collective_Wordmark_White.svg')));
  const word = await sharp(wordSvg, { density: 300 }).resize({ width: 760 }).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#000000' } })
    .composite([{ input: word, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'og-image.png'));
  await fs.writeFile(path.join(OUT, 'site.webmanifest'), JSON.stringify({
    id: '/',
    name: `${config.name} LLC`,
    short_name: config.name,
    description: config.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }, null, 2));

  const layout = await fs.readFile(path.join(SRC, 'layout.html'), 'utf8');
  const css = (await fs.readFile(path.join(SRC, 'site.css'), 'utf8')).replace('{{font}}', fontUrl);
  const js = await fs.readFile(path.join(SRC, 'site.js'), 'utf8');
  // Logos are embedded straight into the page, so they show instantly instead of
  // flashing their alt text while a separate file downloads.
  const wordmark = await inlineSvg('Lawler_Collective_Wordmark_White.svg', { label: 'Lawler Collective LLC', width: 1050, height: 350 });
  const footerIcon = await inlineSvg('Lawler_Collective_Icon_White.svg', { label: 'Lawler Collective LLC', width: 36, height: 36, cls: 'footer-logo' });
  const gridJs = await fs.readFile(path.join(SRC, 'grid.js'), 'utf8');

  const galleryLinks = (current) => galleries
    .map((g) => `<li><a href="/gallery-${g}"${g === current ? ' aria-current="page"' : ''}>${esc(title(g))}</a></li>`)
    .join('\n');

  const render = (vars) => layout.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
  const common = {
    css: minifyCss(css),
    js,
    gridJs,
    wordmark,
    footerIcon,
    font: fontUrl,
    galleryLinks: galleryLinks(null),
    year: new Date().getFullYear(),
    version: esc(config.version),
  };

  // Home: hero slideshow. site.json "hero" can list files like "cars/LAW-05.jpg";
  // otherwise the first few landscape photos from the home folder are used.
  const all = Object.entries(photos).flatMap(([slug, list]) => list.map((p) => ({ ...p, key: `${slug}/${p.file}` })));
  let heroPhotos = (config.hero || []).map((k) => all.find((p) => p.key.toLowerCase() === k.toLowerCase())).filter(Boolean);
  if (!heroPhotos.length) heroPhotos = (photos[config.home] || []).filter((p) => p.width > p.height * 1.2).slice(0, HERO_COUNT);
  // Phones: the slideshow covers a tall screen, so a wide photo only shows its middle.
  // Each slideshow photo also gets a centered portrait crop that phones download instead.
  const PORTRAIT = 0.6; // width / height of the crop
  const PORTRAIT_WIDTHS = [600, 900, 1200];
  const portraits = await Promise.all(heroPhotos.map(async (p) => {
    const m = await sharp(p.source, { failOn: 'none' }).metadata();
    const turned = (m.orientation || 1) >= 5;
    const W = turned ? m.height : m.width;
    const H = turned ? m.width : m.height;
    const cw = Math.min(W, Math.round(H * PORTRAIT));
    const ch = Math.min(H, Math.round(cw / PORTRAIT));
    const widths = [...new Set(PORTRAIT_WIDTHS.map((w) => Math.min(w, cw)))];
    const names = widths.flatMap((w) => Object.keys(FORMATS).map((ext) => ({ w, ext, file: `${p.hash}-p${w}.${ext}` })));
    names.forEach((n) => usedCache.add(n.file));
    if (!names.every((n) => existsSync(path.join(CACHE, n.file)))) {
      const crop = sharp(p.source, { failOn: 'none' }).rotate()
        .extract({ left: Math.round((W - cw) / 2), top: Math.round((H - ch) / 2), width: cw, height: ch });
      await Promise.all(names.map(({ w, ext, file }) =>
        FORMATS[ext](crop.clone().resize({ width: w })).toFile(path.join(CACHE, file))));
    }
    const stem = path.parse(p.file).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photo';
    const url = (w, ext) => `/img/${p.slug}/${stem}-${p.hash.slice(0, 8)}-p${w}.${ext}`;
    await Promise.all(names.map(({ w, ext, file }) => fs.copyFile(path.join(CACHE, file), path.join(OUT, url(w, ext)))));
    const set = (ext) => widths.map((w) => `${url(w, ext)} ${w}w`).join(', ');
    return { avif: set('avif'), webp: set('webp') };
  }));
  const PHONE = '(max-aspect-ratio: 4/5)';
  const NOT_PHONE = '(min-aspect-ratio: 801/1000)';
  const PHONE_SIZES = `${PORTRAIT * 100}vh`; // the crop covers the screen's full height

  // Only the first slide loads with the page; the others carry data-srcset and are
  // loaded one at a time, just before they're shown (site.js).
  const heroSlides = heroPhotos.map((p, i) => {
    const first = i === 0;
    const s = first ? 'srcset' : 'data-srcset';
    const pt = portraits[i];
    return `<picture>` +
      `<source media="${PHONE}" type="image/avif" ${s}="${pt.avif}" sizes="${PHONE_SIZES}">` +
      `<source media="${PHONE}" type="image/webp" ${s}="${pt.webp}" sizes="${PHONE_SIZES}">` +
      `<source type="image/avif" ${s}="${p.big.avif}" sizes="${HERO_SIZES}">` +
      `<img class="hero-slide${first ? ' is-active' : ''}"${first ? ` src="${p.full}"` : ''} ${s}="${p.big.webp}" sizes="${HERO_SIZES}" ` +
      `width="${p.width}" height="${p.height}" alt=""${first ? ' fetchpriority="high"' : ''} decoding="async"></picture>`;
  }).join('\n');
  // Preload the first slide (phone crop on tall screens, the wide photo elsewhere).
  // type="image/avif": browsers without AVIF skip these and use the WebP instead.
  const heroPreload = heroPhotos[0]
    ? `<link rel="preload" as="image" type="image/avif" media="${PHONE}" imagesrcset="${portraits[0].avif}" imagesizes="${PHONE_SIZES}" fetchpriority="high">` +
      `<link rel="preload" as="image" type="image/avif" media="${NOT_PHONE}" imagesrcset="${heroPhotos[0].big.avif}" imagesizes="${HERO_SIZES}" fetchpriority="high">`
    : '';
  const home = (await fs.readFile(path.join(SRC, 'home.html'), 'utf8'))
    .replace('{{heroSlides}}', heroSlides)
    .replace('{{grid}}', gridHtml(photos[config.home] || []));
  await fs.writeFile(path.join(OUT, 'index.html'), render({
    ...common,
    title: `${config.name} LLC`,
    description: esc(config.description),
    preload: heroPreload,
    bodyClass: 'is-home',
    homePrefix: '',
    content: home,
  }));

  // Galleries: one page holds every gallery, so switching tabs happens in place
  // (site.js) without reloading. Each /gallery-<slug> URL is that same page with a
  // different gallery shown first. Hidden galleries don't load photos until opened.
  for (const slug of galleries) {
    const t = title(slug);
    const list = photos[slug];
    const tabs = galleries.map((g) => `<a href="/gallery-${g}" data-slug="${g}" data-title="${esc(title(g))}" data-count="${photos[g].length}"` +
      `${g === slug ? ' aria-current="page"' : ''}>${esc(title(g))}</a>`).join('');
    const panels = galleries.map((g) => `<section class="gallery-panel" data-slug="${g}" aria-label="${esc(title(g))}"${g === slug ? '' : ' hidden'}>
${gridHtml(photos[g], { eager: g === slug ? EAGER_COUNT : 0 })}
</section>`).join('\n');
    const content = `<main class="section gallery-page" id="main">
<header class="gallery-head">
  <p class="eyebrow">Gallery</p>
  <h1 class="gallery-title">${esc(t)}</h1>
  <p class="gallery-count">${list.length} photographs</p>
  <nav class="gallery-tabs" aria-label="Galleries"><span class="tab-pill" aria-hidden="true"></span>${tabs}</nav>
</header>
${panels}
</main>`;
    const first = list[0];
    await fs.writeFile(path.join(OUT, `gallery-${slug}.html`), render({
      ...common,
      title: `${t} Gallery | ${config.name}`,
      description: esc(`${t} photography by ${config.name}.`),
      preload: first && config.shuffle === false ? `<link rel="preload" as="image" type="image/avif" imagesrcset="${first.srcset.avif}" imagesizes="${GRID_SIZES}" fetchpriority="high">` : '',
      homePrefix: '/',
      galleryLinks: galleryLinks(slug),
      galleryCurrent: ' aria-current="true"',
      content,
    }));
  }

  // 404: GitHub Pages shows this for any address that doesn't exist. Every link and
  // asset on it is absolute, so it works at any depth (e.g. /old/page/here).
  await fs.writeFile(path.join(OUT, "404.html"), render({
    ...common,
    title: `Page not found | ${config.name}`,
    description: "This page doesn't exist.",
    head: '<meta name="robots" content="noindex">\n',
    homePrefix: "/",
    bodyClass: "is-404",
    content: `<main class="section notfound" id="main">
<header class="section-head">
  <p class="eyebrow">Error 404</p>
  <h1 class="section-title">This page is out of frame.</h1>
</header>
<p class="notfound-text">The page you're looking for doesn't exist or has moved. Try one of these instead.</p>
<div class="notfound-actions">
  <a class="btn btn-solid" href="/">Home</a>
${galleries.map((g) => `  <a class="btn" href="/gallery-${g}">${esc(title(g))}</a>`).join("\n")}
</div>
</main>`,
  }));

  const total = Object.values(photos).reduce((n, l) => n + l.length, 0);
  log(`Built ${galleries.length + 2} pages, ${total} photos in ${((Date.now() - started) / 1000).toFixed(1)}s -> _site/`);
  // Drop cached images no current photo uses (removed photos, old settings).
  let pruned = 0;
  for (const f of await fs.readdir(CACHE)) {
    if (!usedCache.has(f)) { await fs.rm(path.join(CACHE, f), { force: true }); pruned++; }
  }
  if (pruned) log(`Removed ${pruned} unused cached images`);
  usedCache.clear();

  await fs.rm(FINAL, { recursive: true, force: true });
  await fs.rename(OUT, FINAL);
  return { galleries };
}

// Packs PNG images into one .ico file (modern .ico files can hold PNGs directly).
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([size, buf], i) => {
    const e = 6 + i * 16;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...images.map(([, buf]) => buf)]);
}

// Turns an SVG file from src/assets into markup that can sit inside the page:
// its class-based colors become plain fill attributes (so two logos can't clash),
// and the XML header, ids and <style> block are removed.
async function inlineSvg(file, { label, width, height, cls = '' }) {
  let svg = await fs.readFile(path.join(SRC, 'assets', file), 'utf8');
  const fills = Object.fromEntries([...svg.matchAll(/\.([\w-]+)\s*\{\s*fill:\s*([^;}\s]+)/g)].map((m) => [m[1], m[2]]));
  svg = svg
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<defs>[\s\S]*?<\/defs>/, '')
    .replace(/\sclass="([\w-]+)"/g, (m, c) => (fills[c] ? ` fill="${fills[c]}"` : m))
    .replace(/\sid="[^"]*"/g, '')
    .replace(/<svg\b/, `<svg${cls ? ` class="${cls}"` : ''} width="${width}" height="${height}" role="img" aria-label="${esc(label)}" focusable="false"`)
    .replace(/>\s+</g, '><')
    .trim();
  return svg;
}

function minifyCss(s) {
  // Never remove the space *before* a colon: ".a :is(b)" (descendant) and
  // ".a:is(b)" (same element) mean different things.
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/:\s+/g, ':').replace(/;}/g, '}').trim();
}

export { main as build };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
