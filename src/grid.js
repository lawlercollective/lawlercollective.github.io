// Photo grid layout. Inlined in the page <head> so each grid is shuffled and laid out
// the moment it's parsed, before it is first drawn (no visible reorder or jump).
//
// Rows follow a rhythm of heights (a big feature row, then normal, tight, medium...)
// and every row exactly fills the width, so photos are never cropped.
(() => {
  const RHYTHM_WIDE = [1.6, 1, 0.78, 1.08];
  const RHYTHM_NARROW = [1.7, 1, 1];

  window.__layoutGrid = (g) => {
    const W = g.clientWidth;
    if (!W) return;
    const cs = getComputedStyle(g);
    const base = parseFloat(cs.getPropertyValue('--row-h')) || 280;
    const gap = parseFloat(cs.columnGap) || 10;
    const rhythm = W < 700 ? RHYTHM_NARROW : RHYTHM_WIDE;
    const items = [...g.children].filter((el) => el.classList.contains('ph'));
    let i = 0;
    let row = 0;
    while (i < items.length) {
      const target = base * rhythm[row % rhythm.length];
      let sum = 0;
      let j = i;
      let full = false;
      while (j < items.length) {
        const r = +items[j].dataset.r;
        if ((sum + r) * target + (j - i) * gap >= W) {
          // Row is full: take this photo or stop before it, whichever gives a
          // row height closer to the target.
          const withH = (W - (j - i) * gap) / (sum + r);
          const withoutH = j > i ? (W - (j - i - 1) * gap) / sum : Infinity;
          if (Math.abs(withH - target) <= Math.abs(withoutH - target)) { sum += r; j++; }
          full = true;
          break;
        }
        sum += r;
        j++;
      }
      const n = j - i;
      const gaps = (n - 1) * gap;
      const h = full ? (W - gaps) / sum : target; // a short last row keeps its height
      let used = 0;
      for (let k = i; k < j; k++) {
        const el = items[k];
        const w = full && k === j - 1 ? W - gaps - used : Math.floor(+el.dataset.r * h);
        used += w;
        el.style.width = w + 'px';
        el.style.height = Math.round(h) + 'px';
        // Tell the browser the exact width (plus the 6% drift headroom) so it picks
        // the smallest file that's still sharp on this screen.
        const sizes = Math.ceil(w * 1.06) + 'px';
        el.querySelectorAll('source, img').forEach((s) => { if (s.sizes !== sizes) s.sizes = sizes; });
      }
      i = j;
      row++;
    }
    g.dataset.w = W;
    g.classList.add('is-laid');
  };

  window.__grid = (g, eager, shuffle) => {
    const items = [...g.children];
    if (shuffle) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [items[i], items[j]] = [items[j], items[i]];
      }
      g.append(...items);
    }
    window.__layoutGrid(g); // sets exact sizes first, so the early loads pick the right file
    items.slice(0, eager).forEach((a, i) => {
      const img = a.querySelector('img');
      img.loading = 'eager';
      if (i < 2) img.fetchPriority = 'high';
    });
  };
})();
