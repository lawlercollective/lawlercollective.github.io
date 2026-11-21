// Shared helpers for managing photos/ and site.json, used by the photo manager
// (scripts/dev.mjs -> /admin) and `npm run renumber`.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PHOTOS = path.join(ROOT, 'photos');
export const TRASH = path.join(ROOT, '.trash');
export const CONFIG = path.join(ROOT, 'site.json');
export const PREFIX = 'LAW';
export const PHOTO_EXT = /\.(jpe?g|png|webp|avif|tiff?|heic|heif)$/i;
export const naturalSort = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

// Category folder names: lowercase letters, numbers and dashes (they become URLs).
export const isCategory = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(s);
// Photo file names: a plain file name with a photo extension, nothing path-like.
export const isPhotoName = (s) => typeof s === 'string' && s === path.basename(s) && !s.startsWith('.') && PHOTO_EXT.test(s);
export const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export const readConfig = async () => JSON.parse(await fs.readFile(CONFIG, 'utf8'));
export const writeConfig = async (c) => fs.writeFile(CONFIG, JSON.stringify(c, null, 2) + '\n');

export async function listPhotos(cat) {
  return (await fs.readdir(path.join(PHOTOS, cat))).filter(isPhotoName).sort(naturalSort);
}

export async function listCategories() {
  const config = await readConfig();
  const folders = (await fs.readdir(PHOTOS, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && isCategory(d.name)).map((d) => d.name).sort(naturalSort);
  const galleries = [
    ...config.galleries.filter((g) => folders.includes(g)),
    ...folders.filter((f) => f !== config.home && !config.galleries.includes(f)),
  ];
  return { config, order: folders.includes(config.home) ? [config.home, ...galleries] : galleries };
}

const normExt = (name) => {
  const ext = path.extname(name).toLowerCase();
  return ext === '.jpeg' ? '.jpg' : ext;
};

// Next free LAW-NN name in a folder.
export async function nextName(cat, original) {
  const names = await listPhotos(cat);
  const nums = names.map((n) => +(n.match(new RegExp(`^${PREFIX}-(\\d+)\\.`, 'i')) || [])[1] || 0);
  let n = Math.max(0, ...nums) + 1;
  const ext = normExt(original);
  let name;
  do { name = `${PREFIX}-${String(n).padStart(2, '0')}${ext}`; n++; } while (existsSync(path.join(PHOTOS, cat, name)));
  return name;
}

// Rewrites "cat/old" -> "cat/new" references in site.json's hero list.
export async function renameHeroRefs(map) {
  const config = await readConfig();
  if (!Array.isArray(config.hero) || !config.hero.length) return;
  const lower = new Map([...map].map(([k, v]) => [k.toLowerCase(), v]));
  config.hero = config.hero.map((k) => (lower.has(k.toLowerCase()) ? lower.get(k.toLowerCase()) : k)).filter(Boolean);
  if (!config.hero.length) delete config.hero; // no picks left: back to the default slideshow
  await writeConfig(config);
}

// Renames a folder's photos to LAW-01, LAW-02, ... (keeping their order) and
// returns a Map of "cat/old" -> "cat/new" for the ones that changed.
export async function renumberCategory(cat, { dry = false } = {}) {
  const dir = path.join(PHOTOS, cat);
  const files = await listPhotos(cat);
  const digits = Math.max(2, String(files.length).length);
  const plan = files.map((f, i) => ({ from: f, to: `${PREFIX}-${String(i + 1).padStart(digits, '0')}${normExt(f)}` }))
    .filter((p) => p.from !== p.to);
  const map = new Map(plan.map((p) => [`${cat}/${p.from}`, `${cat}/${p.to}`]));
  if (dry || !plan.length) return { plan, map, total: files.length };
  // Two steps so swaps like LAW-02 -> LAW-01 never overwrite another file.
  for (const p of plan) await fs.rename(path.join(dir, p.from), path.join(dir, `.renumber-${p.from}`));
  for (const p of plan) await fs.rename(path.join(dir, `.renumber-${p.from}`), path.join(dir, p.to));
  await renameHeroRefs(map);
  return { plan, map, total: files.length };
}
