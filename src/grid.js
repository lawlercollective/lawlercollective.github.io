// Photo grid layout. Inlined in the page <head> so each grid is shuffled and laid out
// the moment it's parsed, before it is first drawn (no visible reorder or jump).
//
// Wider screens: rows follow a rhythm of heights (a big feature row, then normal,
// tight, medium...) and every row exactly fills the width, so photos are never cropped.
// Phones: two equal columns, each photo at its natural shape, placed in whichever
// column is shorter (a staggered "masonry" layout).
(() => {
  const RHYTHM = [1.6, 1, 0.78, 1.08];
  const PHONE = 600; // grid width below which the two-column layout is used

  // Tell the browser the exact display width (plus the 6% drift headroom) so it
  // picks the smallest file that's still sharp on this screen.
  const setSizes = (el, w) => {
    const sizes = Math.ceil(w * 1.06) + 'px';
    el.querySelectorAll('source, img').forEach((s) => { if (s.sizes !== sizes) s.sizes = sizes; });
  };

  // Whole pixels only: the grid can be e.g. 337.6px wide, and rounding that up would
  // make each row a fraction too wide, pushing its last photo onto a line of its own.
  const widthOf = (g) => Math.floor(g.getBoundingClientRect().width);

  function columns(g, items, W, gap) {
    const cols = 2;
    const cw = (W - gap * (cols - 1)) / cols;
    const heights = new Array(cols).fill(0);
    for (const el of items) {
      const c = heights.indexOf(Math.min(...heights));
      const h = Math.round(cw / +el.dataset.r);
      el.style.left = Math.round(c * (cw + gap)) + 'px';
      el.style.top = heights[c] + 'px';
      el.style.width = Math.floor(cw) + 'px';
      el.style.height = h + 'px';
      setSizes(el, cw);
      heights[c] += h + gap;
    }
    g.style.height = Math.max(0, Math.max(...heights) - gap) + 'px';
    g.classList.add('is-columns');
  }

  function rows(g, items, W, gap) {
    g.classList.remove('is-columns');
    g.style.height = '';
    const base = parseFloat(getComputedStyle(g).getPropertyValue('--row-h')) || 280;
    let i = 0;
    let row = 0;
    while (i < items.length) {
      const target = base * RHYTHM[row % RHYTHM.length];
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
        el.style.left = el.style.top = '';
        el.style.width = w + 'px';
        el.style.height = Math.round(h) + 'px';
        setSizes(el, w);
      }
      i = j;
      row++;
    }
  }

  window.__layoutGrid = (g) => {
    const W = widthOf(g);
    if (!W) return;
    const gap = parseFloat(getComputedStyle(g).columnGap) || 10;
    const items = [...g.children].filter((el) => el.classList.contains('ph'));
    (W < PHONE ? columns : rows)(g, items, W, gap);
    g.dataset.w = W;
    g.classList.add('is-laid');
  };
  window.__gridWidth = widthOf;

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
