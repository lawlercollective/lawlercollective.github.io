// Renames the photos in each photos/<folder>/ to LAW-01.jpg, LAW-02.jpg, ...
// with no gaps, keeping their current order. Slideshow picks in site.json are
// updated to the new names. Run with: npm run renumber   (add -- --dry to preview)

import { listCategories, renumberCategory } from './photos.mjs';

const dry = process.argv.includes('--dry');
const { order } = await listCategories();
let changed = 0;
for (const cat of order) {
  const { plan, total } = await renumberCategory(cat, { dry });
  if (!plan.length) { console.log(`${cat}: already numbered 1-${total}`); continue; }
  console.log(`${cat}: ${plan.length} of ${total} files renamed`);
  plan.forEach((p) => console.log(`  ${p.from} -> ${p.to}`));
  changed += plan.length;
}
console.log(dry ? '\nDry run, nothing renamed.' : `\nDone, ${changed} files renamed.`);
