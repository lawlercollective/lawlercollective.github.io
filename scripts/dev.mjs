// Local preview + photo manager.
//
//   npm run dev  ->  http://localhost:8080        the site (rebuilds when photos/, src/ or site.json change)
//                    http://localhost:8080/admin  the photo manager (add, move, delete, categories, slideshow)
//
// Only reachable from this computer. Nothing here is published: changes land in
// photos/ and site.json, which you then commit and push.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { build } from './build.mjs';
import {
  ROOT, PHOTOS, TRASH, isCategory, isPhotoName, slugify, readConfig, writeConfig,
  listPhotos, listCategories, nextName, renameHeroRefs, renumberCategory,
} from './photos.mjs';

const OUT = path.join(ROOT, '_site');
const THUMBS = path.join(ROOT, '.cache', 'admin');
const PORT = Number(process.env.PORT) || 8080;
const HOST = '127.0.0.1';
const MAX_UPLOAD = 150 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

// ---------- builds ----------

let building = null, queued = false, version = 0;
async function rebuild() {
  if (building) { queued = true; return; }
  building = build().catch((e) => console.error(e));
  await building;
  building = null;
  version++;
  if (queued) { queued = false; rebuild(); }
}

await rebuild();

// Only rebuild when a file's size or modified time actually changes. On Windows,
// fs.watch also fires when files are merely read, which would loop forever.
const WATCHED = ['photos', 'src', 'site.json'];
function snapshot() {
  const parts = [];
  const walk = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) fs.readdirSync(p).sort().forEach((f) => walk(path.join(p, f)));
    else parts.push(`${p}:${st.size}:${st.mtimeMs}`);
  };
  WATCHED.forEach((p) => walk(path.join(ROOT, p)));
  return parts.join('|');
}
let last = snapshot();
let timer;
for (const p of WATCHED) {
  fs.watch(path.join(ROOT, p), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const now = snapshot();
      if (now === last) return;
      last = now;
      rebuild();
    }, 300);
  });
}

// ---------- photo manager API ----------

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const need = (ok, msg) => { if (!ok) fail(400, msg); };

const readBody = (req, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > limit) { reject(new HttpError(413, 'File too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const readJson = async (req) => {
  try { return JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}'); } catch { return fail(400, 'Bad JSON'); }
};

// cat === '' means "Unsorted": photos sitting directly in photos/, not yet in a category.
const photoPath = (cat, name) => {
  need(cat === '' || isCategory(cat), 'Bad category');
  need(isPhotoName(name), 'Bad file name');
  return path.join(PHOTOS, cat, name);
};
const exists = (p) => fs.existsSync(p);

async function state() {
  const { config, order } = await listCategories();
  const categories = await Promise.all(order.map(async (slug) => ({
    slug,
    isHome: slug === config.home,
    photos: await listPhotos(slug),
  })));
  const unsorted = await listPhotos('');
  return { categories, unsorted, hero: config.hero || [], home: config.home, version, building: !!building };
}

// Small cached preview of an original (originals can be 5-10 MB).
const thumbJobs = new Map();
async function thumbnail(cat, name) {
  const file = photoPath(cat, name);
  const st = await fsp.stat(file).catch(() => fail(404, 'Not found'));
  const key = crypto.createHash('sha1').update(`${cat}/${name}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 16);
  const out = path.join(THUMBS, `${key}.webp`);
  if (exists(out)) return out;
  if (!thumbJobs.has(key)) {
    thumbJobs.set(key, (async () => {
      await fsp.mkdir(THUMBS, { recursive: true });
      await sharp(file, { failOn: 'none' }).rotate().resize(360, 360, { fit: 'inside' }).webp({ quality: 72 }).toFile(out);
    })().finally(() => thumbJobs.delete(key)));
  }
  await thumbJobs.get(key);
  return out;
}

const actions = {
  async upload(req, q) {
    const cat = q.get('cat');
    const original = q.get('name') || 'photo.jpg';
    need(isCategory(cat) && exists(path.join(PHOTOS, cat)), 'Unknown category');
    need(isPhotoName(path.basename(original)), 'Only photo files (JPEG, PNG, WebP, AVIF, TIFF, HEIC) can be added');
    const data = await readBody(req, MAX_UPLOAD);
    need(data.length > 0, 'Empty file');
    const name = await nextName(cat, original);
    await fsp.writeFile(path.join(PHOTOS, cat, name), data, { flag: 'wx' });
    return { name };
  },

  async move(req) {
    const { items, to } = await readJson(req);
    need(Array.isArray(items) && items.length, 'Nothing selected');
    need(isCategory(to) && exists(path.join(PHOTOS, to)), 'Unknown category');
    const map = new Map();
    for (const { cat, name } of items) {
      const from = photoPath(cat, name);
      if (cat === to || !exists(from)) continue;
      const newName = await nextName(to, name);
      await fsp.rename(from, path.join(PHOTOS, to, newName));
      map.set(`${cat}/${name}`, `${to}/${newName}`);
    }
    await renameHeroRefs(map);
    return { moved: map.size };
  },

  async delete(req) {
    const { items } = await readJson(req);
    need(Array.isArray(items) && items.length, 'Nothing selected');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const map = new Map();
    for (const { cat, name } of items) {
      const from = photoPath(cat, name);
      if (!exists(from)) continue;
      const dir = path.join(TRASH, stamp, cat);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.rename(from, path.join(dir, name));
      map.set(`${cat}/${name}`, null);
    }
    await renameHeroRefs(map);
    return { deleted: map.size, trash: path.relative(ROOT, path.join(TRASH, stamp)) };
  },

  async renumber(req) {
    const { cat } = await readJson(req);
    need(isCategory(cat) && exists(path.join(PHOTOS, cat)), 'Unknown category');
    const { plan } = await renumberCategory(cat);
    return { renamed: plan.length };
  },

  async hero(req) {
    const { items } = await readJson(req);
    need(Array.isArray(items), 'Bad list');
    items.forEach((k) => { const [cat, name] = String(k).split('/'); photoPath(cat, name); });
    const config = await readConfig();
    if (items.length) config.hero = items; else delete config.hero;
    await writeConfig(config);
    return { hero: items };
  },

  async category(req) {
    const body = await readJson(req);
    const config = await readConfig();
    const { order } = await listCategories();
    const galleries = order.filter((s) => s !== config.home);

    if (body.action === 'create') {
      const slug = slugify(body.name);
      need(isCategory(slug), 'Use letters and numbers for the name');
      need(!exists(path.join(PHOTOS, slug)), 'That category already exists');
      await fsp.mkdir(path.join(PHOTOS, slug));
      config.galleries = [...galleries, slug];
      await writeConfig(config);
      return { slug };
    }

    const slug = body.slug;
    need(isCategory(slug) && exists(path.join(PHOTOS, slug)), 'Unknown category');

    if (body.action === 'rename') {
      const to = slugify(body.name);
      need(isCategory(to), 'Use letters and numbers for the name');
      if (to === slug) return { slug };
      need(!exists(path.join(PHOTOS, to)), 'That name is already used');
      await fsp.rename(path.join(PHOTOS, slug), path.join(PHOTOS, to));
      if (config.home === slug) config.home = to;
      config.galleries = galleries.map((g) => (g === slug ? to : g));
      if (Array.isArray(config.hero)) config.hero = config.hero.map((k) => (k.startsWith(`${slug}/`) ? `${to}/${k.slice(slug.length + 1)}` : k));
      await writeConfig(config);
      return { slug: to };
    }

    if (body.action === 'move') {
      need(slug !== config.home, 'The home page section stays first');
      const i = galleries.indexOf(slug);
      const j = i + (body.dir < 0 ? -1 : 1);
      if (j >= 0 && j < galleries.length) [galleries[i], galleries[j]] = [galleries[j], galleries[i]];
      config.galleries = galleries;
      await writeConfig(config);
      return { order: galleries };
    }

    if (body.action === 'delete') {
      need(slug !== config.home, "The home page section can't be deleted");
      need((await listPhotos(slug)).length === 0, 'Move or delete its photos first');
      const leftovers = (await fsp.readdir(path.join(PHOTOS, slug))).filter((f) => !f.startsWith('.'));
      need(!leftovers.length, `The folder still has other files: ${leftovers.join(', ')}`);
      await fsp.rm(path.join(PHOTOS, slug), { recursive: true });
      config.galleries = galleries.filter((g) => g !== slug);
      await writeConfig(config);
      return { deleted: slug };
    }

    return fail(400, 'Unknown action');
  },
};

async function handleAdmin(req, res, url) {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    const route = url.pathname.slice('/__admin/'.length);
    if (req.method === 'GET' && route === 'state') return send(200, await state());
    if (req.method === 'GET' && route === 'thumb') {
      const file = await thumbnail(url.searchParams.get('cat'), url.searchParams.get('name'));
      res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'POST' && actions[route]) {
      // Only the photo manager page itself may change files: it sends this header,
      // which other websites can't send to localhost without the browser blocking them.
      if (req.headers['x-photo-manager'] !== '1') fail(403, 'Forbidden');
      return send(200, await actions[route](req, url.searchParams));
    }
    fail(404, 'Not found');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    send(status, { error: err.message || 'Something went wrong' });
  }
}

// ---------- server ----------

http.createServer((req, res) => {
  // Refuse requests addressed to any other host name (blocks DNS-rebinding tricks).
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) { res.writeHead(403).end(); return; }

  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/__admin/')) { handleAdmin(req, res, url); return; }
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    fs.createReadStream(path.join(ROOT, 'scripts', 'admin.html')).pipe(res);
    return;
  }

  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(OUT, path.normalize(p));
  if (!file.startsWith(OUT + path.sep)) { res.writeHead(403).end(); return; }
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html'; // /gallery-cars -> gallery-cars.html
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    // Cache like the live site: photos and the font have content-hashed names, so the
    // browser can keep them; pages are re-checked each time (cheap 304 when unchanged).
    const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
    const hashed = p.startsWith('/img/') || /-[0-9a-f]{8}\.woff2$/.test(p);
    const headers = {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : p.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, HOST, () => {
  console.log(`\nPreview:        http://localhost:${PORT}`);
  console.log(`Photo manager:  http://localhost:${PORT}/admin`);
  console.log('(Ctrl+C to stop)\n');
});
