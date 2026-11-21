(() => {
  const body = document.body;
  const hd = document.querySelector('.hd');
  const still = matchMedia('(prefers-reduced-motion: reduce)');

  // ----- header: hairline + solid background once the page scrolls -----
  const onScroll = () => hd.classList.toggle('is-stuck', scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ----- gallery dropdown (tap on phones, hover on desktop via CSS) -----
  const drop = document.querySelector('.nav-drop');
  const dropBtn = drop.querySelector('.nav-drop-btn');
  const setDrop = (open) => {
    drop.classList.toggle('open', open);
    dropBtn.setAttribute('aria-expanded', String(open));
  };
  dropBtn.addEventListener('click', () => setDrop(!drop.classList.contains('open')));
  document.addEventListener('click', (e) => { if (!drop.contains(e.target)) setDrop(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drop.classList.contains('open')) { setDrop(false); dropBtn.focus(); }
  });
  drop.addEventListener('focusout', (e) => { if (!drop.contains(e.relatedTarget)) setDrop(false); });

  // ----- smooth, interruptible scrolling to sections -----
  let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };
  ['wheel', 'touchstart', 'keydown'].forEach((e) => addEventListener(e, stop, { passive: true }));

  // Visible header height (on phones the logo row scrolls away, leaving just the links).
  const headH = () => hd.offsetHeight + Math.min(0, parseFloat(getComputedStyle(hd).top) || 0);

  // Where a #link should land: a section's heading sits a comfortable gap under the header.
  const targetFor = (id) => {
    if (id === 'home' || id === 'main') return { y: 0 };
    const el = document.getElementById(id);
    if (!el) return null;
    const anchor = el.querySelector('.section-head') || el;
    const y = anchor.getBoundingClientRect().top + scrollY - headH() - 48;
    return { el, y: Math.max(0, Math.round(y)) };
  };

  const glide = (to) => {
    const from = scrollY;
    const dist = to - from;
    stop();
    if (still.matches || Math.abs(dist) < 2) { scrollTo(0, to); return; }
    const dur = Math.min(1100, 420 + Math.abs(dist) * 0.22);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const k = t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2; // ease-in-out quart
      scrollTo(0, from + dist * k);
      raf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  };

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href*="#"]');
    if (!a) return;
    const url = new URL(a.href);
    if (url.pathname !== location.pathname || !url.hash) return;
    const t = targetFor(decodeURIComponent(url.hash.slice(1)));
    if (!t) return;
    e.preventDefault();
    glide(t.y);
  });

  // Arriving from another page at a section (/#contact): put it in place before the
  // page is first drawn, in one move, instead of a browser jump and a correction.
  if (location.hash) {
    const id = decodeURIComponent(location.hash.slice(1));
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    history.replaceState(null, '', location.pathname + location.search);
    if (targetFor(id)) {
      const land = () => { const t = targetFor(id); if (t) scrollTo(0, t.y); };
      land();
      let moved = false;
      ['wheel', 'touchstart', 'keydown'].forEach((ev) => addEventListener(ev, () => (moved = true), { passive: true, once: true }));
      const settle = () => { if (!moved) land(); };
      document.fonts?.ready.then(settle);
      addEventListener('load', settle, { once: true });
    }
  }

  // ----- page-to-page smoothness for browsers without View Transitions / prerender -----
  const isPageLink = (a) => {
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return null;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/img/') || url.pathname === location.pathname) return null;
    return url;
  };

  // Fade the content out, then leave (Firefox and others). Chromium browsers
  // cross-fade natively via @view-transition instead.
  if (document.documentElement.classList.contains('no-vt') && !still.matches) {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const url = isPageLink(e.target.closest('a[href]'));
      if (!url) return;
      e.preventDefault();
      document.documentElement.classList.add('page-out');
      setTimeout(() => { location.href = url.href; }, 200);
    });
    // Coming back with the Back button restores the page from memory: show it again.
    addEventListener('pageshow', (e) => { if (e.persisted) document.documentElement.classList.remove('page-out'); });
  }

  // Fetch a page as soon as a link is hovered or touched, so the click feels instant
  // (Chromium already prerenders via the speculation rules in the page head).
  if (!HTMLScriptElement.supports?.('speculationrules')) {
    const fetched = new Set();
    const warm = (e) => {
      const url = isPageLink(e.target.closest?.('a[href]'));
      if (!url || fetched.has(url.pathname)) return;
      fetched.add(url.pathname);
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = url.pathname;
      document.head.append(link);
    };
    document.addEventListener('pointerover', warm, { passive: true });
    document.addEventListener('touchstart', warm, { passive: true });
  }

  // ----- home page: underline the section you're looking at -----
  const navLinks = [...document.querySelectorAll('.nav > a[data-section]')];
  const sections = navLinks.map((a) => document.getElementById(a.dataset.section)).filter(Boolean);
  if (sections.length) {
    const visible = new Set();
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? visible.add(en.target.id) : visible.delete(en.target.id)));
      const current = sections.find((s) => visible.has(s.id))?.id;
      navLinks.forEach((a) => {
        if (a.dataset.section === current) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  // ----- scroll reveal: pieces rise into place one after another -----
  const io = new IntersectionObserver((entries) => {
    entries
      .filter((en) => en.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left)
      .forEach((en, n) => {
        en.target.style.setProperty('--rd', Math.min(n, 9) * 70 + 'ms');
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  document.querySelectorAll('.section-head, .text-content > p, .grid .ph').forEach((el) => io.observe(el));

  // ----- photo grids: redo the row layout when the width changes -----
  const grids = [...document.querySelectorAll('.grid')];
  if (grids.length && window.__layoutGrid) {
    let pending = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => grids.forEach((g) => {
        if (+g.dataset.w !== g.clientWidth) window.__layoutGrid(g);
      }));
    });
    grids.forEach((g) => ro.observe(g));
    // The font can change the scrollbar/width slightly once it loads.
    document.fonts?.ready.then(() => grids.forEach((g) => window.__layoutGrid(g)));
  }

  // ----- landing hero slideshow -----
  // The first photo loads with the page. Each following photo is only downloaded
  // while the one before it is on screen (saves data on phones), and the slides
  // rotate in a random order. A slide only appears once its image is ready.
  const slides = [...document.querySelectorAll('.hero-slide')];
  if (slides.length > 1 && !still.matches) {
    const order = slides.slice(1);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [order[i], order[j]] = [order[j], order[i]];
    }
    const cycle = [slides[0], ...order];
    let cur = 0;
    const fetchSlide = (img) => {
      img.parentElement.querySelectorAll('[data-srcset]').forEach((el) => {
        el.srcset = el.dataset.srcset;
        delete el.dataset.srcset;
      });
    };
    const ready = (img) => (img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => {}));
    addEventListener('load', () => {
      fetchSlide(cycle[1]);
      setInterval(async () => {
        if (document.hidden) return;
        const next = (cur + 1) % cycle.length;
        fetchSlide(cycle[next]);
        await ready(cycle[next]);
        fetchSlide(cycle[(next + 1) % cycle.length]); // get the one after ready in the background
        const prev = cycle[cur];
        // Swap classes in one step so the outgoing photo's zoom keeps running
        // while the new one fades in on top of it.
        prev.classList.replace('is-active', 'is-prev');
        cycle[next].classList.add('is-active');
        cur = next;
        setTimeout(() => prev.classList.remove('is-prev'), 1800);
      }, 6500);
    });
  }

  // ----- lightbox -----
  // The photo is animated directly (movement + scale only, which every browser runs
  // smoothly): it grows out of its spot in the grid, cross-fades between photos, and
  // shrinks back into its spot on close.
  const items = [...document.querySelectorAll('.grid .ph')]; // in shuffled order
  if (!items.length) return;
  const lb = document.getElementById('lightbox');
  const lbImg = lb.querySelector('img');
  const ui = lb.querySelector('.lb-ui');
  const count = lb.querySelector('.lb-count');
  const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const BACKDROP = 'rgba(0, 0, 0, 0.85)';
  const CLEAR = 'rgba(0, 0, 0, 0)';
  let index = -1;
  let anims = [];
  let closing = null;
  const fulls = new Map(); // href -> Image

  const thumbOf = (i) => items[i].querySelector('img');
  // Full-size copy: AVIF when this browser is already showing AVIF thumbnails, else WebP.
  let avif = null; // unknown until a thumbnail has loaded
  const fullUrl = (a) => {
    if (avif === null) {
      const seen = items.map((x) => x.querySelector('img').currentSrc).find(Boolean);
      if (seen) avif = /\.avif$/.test(seen);
    }
    return avif && a.dataset.avif ? a.dataset.avif : a.href;
  };
  const loadFull = (a) => {
    const url = fullUrl(a);
    if (!fulls.has(url)) { const im = new Image(); im.src = url; fulls.set(url, im); }
    return fulls.get(url);
  };
  const ready = (im) => im.complete && im.naturalWidth > 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const stopAnims = () => { anims.forEach((a) => a.cancel()); anims = []; };

  // Start fetching the sharp copy as soon as a photo is pointed at or touched,
  // so it's usually ready by the time it's clicked.
  items.forEach((a) => {
    a.addEventListener('pointerenter', () => loadFull(a), { passive: true });
    a.addEventListener('touchstart', () => loadFull(a), { passive: true });
  });

  // Fills the viewer with photo i. Waits briefly for the sharp copy so it doesn't
  // pop from blurry to sharp mid-animation; falls back to the grid copy if slow.
  const show = async (i) => {
    index = (i + items.length) % items.length;
    const a = items[index];
    const thumb = thumbOf(index);
    const full = loadFull(a);
    if (!ready(full)) await Promise.race([full.decode().catch(() => {}), wait(160)]);
    if (items[index] !== a) return;
    lbImg.src = ready(full) ? full.src : (thumb.currentSrc || thumb.src);
    lbImg.width = a.dataset.w;
    lbImg.height = a.dataset.h;
    lbImg.style.setProperty('--r', a.dataset.w / a.dataset.h);
    lbImg.alt = thumb.alt;
    if (!ready(full)) full.decode().then(() => { if (items[index] === a) lbImg.src = full.src; }).catch(() => {});
    count.textContent = `${index + 1} / ${items.length}`;
    loadFull(items[(index + 1) % items.length]);
    loadFull(items[(index - 1 + items.length) % items.length]);
    await lbImg.decode().catch(() => {});
  };

  // What the thumbnail looks like right now, expressed as a transform + clip on the
  // viewer photo. The grid image is enlarged (and drifting) inside its frame, so the
  // viewer photo is moved/scaled onto the grid *image* and then trimmed to the *frame*:
  // that way the first/last animation frame is pixel-for-pixel the thumbnail.
  const FULL = { transform: 'none', clipPath: 'inset(0px 0px 0px 0px round 12px)' };
  const asThumb = (i) => {
    const f = items[i].getBoundingClientRect();
    const m = thumbOf(i).getBoundingClientRect();
    // The viewer photo's untransformed box (offset* ignore running animations).
    const t = { left: lbImg.offsetLeft, top: lbImg.offsetTop, width: lbImg.offsetWidth, height: lbImg.offsetHeight };
    const sx = m.width / t.width;
    const sy = m.height / t.height;
    const dx = m.left + m.width / 2 - (t.left + t.width / 2);
    const dy = m.top + m.height / 2 - (t.top + t.height / 2);
    const px = (v) => `${Math.max(0, v).toFixed(2)}px`;
    const clip = `inset(${px((f.top - m.top) / sy)} ${px((m.right - f.right) / sx)} ${px((m.bottom - f.bottom) / sy)} ${px((f.left - m.left) / sx)} round ${px(6 / sx)})`;
    return { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, clipPath: clip };
  };
  // Current on-screen values (including any running animation), to start from.
  const current = (el, props) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, cs[p]]));
  };

  const open = async (i) => {
    if (!lb.hidden && !closing) return;
    if (closing) closing();
    endFade();
    await show(i);
    stopAnims();
    lb.hidden = false;
    body.classList.add('no-scroll');
    if (still.matches) return;
    anims = [
      lbImg.animate([asThumb(index), FULL], { duration: 500, easing: EASE }),
      lb.animate([{ backgroundColor: CLEAR }, { backgroundColor: BACKDROP }], { duration: 400, easing: 'ease' }),
      ui.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, delay: 150, easing: 'ease-out', fill: 'backwards' }),
    ];
  };

  const close = () => {
    if (lb.hidden || closing) return;
    endFade();
    const frame = items[index];
    const thumb = thumbOf(index);
    // Make sure the spot it shrinks back into is on screen and shown.
    const r = frame.getBoundingClientRect();
    if (r.bottom < headH() || r.top > innerHeight) frame.scrollIntoView({ block: 'center' });
    frame.style.transition = thumb.style.transition = 'none';
    frame.classList.add('is-in');
    io.unobserve(frame);
    requestAnimationFrame(() => { frame.style.transition = thumb.style.transition = ''; });
    body.classList.remove('no-scroll');

    const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);
    const onKey = (e) => { if (SCROLL_KEYS.has(e.key)) end(); };
    const end = () => {
      if (!closing) return;
      closing = null;
      removeEventListener('wheel', end);
      removeEventListener('touchmove', end);
      removeEventListener('keydown', onKey);
      stopAnims();
      lb.hidden = true;
      frame.focus({ preventScroll: true });
    };
    closing = end;
    if (still.matches) { end(); return; }

    // Start from exactly where things are now (even if the open animation is still
    // running), then hand over in the same frame, so there's no jump.
    const imgNow = current(lbImg, ['transform', 'clipPath']);
    if (imgNow.transform === 'none' && imgNow.clipPath === 'none') Object.assign(imgNow, FULL);
    if (imgNow.clipPath === 'none') imgNow.clipPath = FULL.clipPath;
    const bgNow = current(lb, ['backgroundColor']);
    const uiNow = current(ui, ['opacity']);
    const target = asThumb(index);
    stopAnims();
    const shrink = lbImg.animate([imgNow, target], { duration: 380, easing: EASE, fill: 'forwards' });
    anims = [
      shrink,
      lb.animate([bgNow, { backgroundColor: CLEAR }], { duration: 320, easing: 'ease', fill: 'forwards' }),
      ui.animate([uiNow, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' }),
    ];
    shrink.finished.then(end, () => {});
    // Scrolling while it shrinks ends it at once, so the photo never chases an old position.
    addEventListener('wheel', end, { passive: true });
    addEventListener('touchmove', end, { passive: true });
    addEventListener('keydown', onKey);
  };

  // Next/previous: a true cross-fade. A copy of the current photo ("ghost") stays on
  // screen while the next one loads, then the new photo fades in as the ghost fades
  // out, so there's never an empty frame. Pressing again skips the current fade.
  let fade = null;
  let stepToken = null;
  const endFade = () => {
    if (fade) fade.forEach((a) => a.finish());
    fade = null;
    stepToken = null;
    lb.querySelectorAll('.lb-ghost').forEach((g) => g.remove());
    lbImg.style.opacity = '';
  };
  const step = async (d) => {
    if (lb.hidden || closing) return;
    if (still.matches) { await show(index + d); return; }
    endFade();
    const token = (stepToken = {});
    const r = lbImg.getBoundingClientRect();
    const ghost = lbImg.cloneNode();
    ghost.alt = '';
    ghost.className = 'lb-ghost';
    ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none;`;
    lbImg.after(ghost);
    lbImg.style.opacity = '0';
    await show(index + d);
    if (stepToken !== token) { ghost.remove(); return; } // a newer step took over
    lbImg.style.opacity = '';
    const fadeIn = lbImg.animate([{ opacity: 0, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE });
    const fadeOut = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: 'ease', fill: 'forwards' });
    fade = [fadeIn, fadeOut];
    fadeOut.finished.then(() => ghost.remove(), () => ghost.remove());
    fadeIn.finished.then(() => { if (fade && fade[0] === fadeIn) fade = null; }, () => {});
  };

  items.forEach((a, i) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // allow open-in-new-tab
    e.preventDefault();
    open(i);
  }));

  lb.addEventListener('click', (e) => {
    if (e.target.closest('.lb-prev')) return step(-1);
    if (e.target.closest('.lb-next')) return step(1);
    close();
  });

  addEventListener('keydown', (e) => {
    if (lb.hidden || closing) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });


  // ----- touch: the photo follows your finger -----
  // Drag sideways for the next/previous photo, drag down to close, or let go early
  // and it springs back. Two-finger pinch-zoom is left to the browser.
  let drag = null;
  const zoomed = () => (window.visualViewport ? visualViewport.scale > 1.01 : false);
  const setDrag = (x, y) => {
    lbImg.style.translate = `${x}px ${y}px`;
    if (y > 0) lb.style.backgroundColor = `rgba(0, 0, 0, ${(0.85 * (1 - Math.min(y / 400, 0.75))).toFixed(3)})`;
  };
  const clearDrag = () => { lbImg.style.translate = ''; lb.style.backgroundColor = ''; };

  lb.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || zoomed() || closing) { drag = null; return; }
    drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, dy: 0, axis: null };
  }, { passive: true });

  lb.addEventListener('touchmove', (e) => {
    if (!drag) return;
    if (e.touches.length !== 1 || zoomed()) { drag = null; clearDrag(); return; }
    drag.dx = e.touches[0].clientX - drag.x;
    drag.dy = e.touches[0].clientY - drag.y;
    if (!drag.axis && Math.hypot(drag.dx, drag.dy) > 8) drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'x' : 'y';
    if (drag.axis === 'x') setDrag(drag.dx, 0);
    else if (drag.axis === 'y') setDrag(0, Math.max(0, drag.dy) + Math.min(0, drag.dy) * 0.2); // resist upward drags
  }, { passive: true });

  lb.addEventListener('touchend', (e) => {
    if (!drag) return;
    const { dx, dy, axis } = drag;
    drag = null;
    if (!axis) return; // a tap: let the normal click handling run
    e.preventDefault(); // a drag, not a tap: don't let it count as a click (which closes)
    const from = lbImg.style.translate || '0px 0px';
    const bg = lb.style.backgroundColor;
    if (axis === 'x' && Math.abs(dx) > 60) {
      // The outgoing copy is taken where your finger left it, then fades out.
      lb.style.backgroundColor = '';
      step(dx < 0 ? 1 : -1);
      requestAnimationFrame(() => { lbImg.style.translate = ''; });
      return;
    }
    if (axis === 'y' && dy > 110) {
      // Swipe down: carry on from where the finger let go into the normal close
      // (close() starts the backdrop fade from its current, already dimmed, value).
      lbImg.style.translate = '';
      lbImg.animate([{ translate: from }, { translate: '0px 0px' }], { duration: 380, easing: EASE });
      close();
      lb.style.backgroundColor = '';
      return;
    }
    // Not far enough: spring back.
    clearDrag();
    lbImg.animate([{ translate: from }, { translate: '0px 0px' }], { duration: 320, easing: EASE });
    if (bg) lb.animate([{ backgroundColor: bg }, { backgroundColor: BACKDROP }], { duration: 320, easing: 'ease' });
  });

  lb.addEventListener('touchcancel', () => { drag = null; clearDrag(); }, { passive: true });
})();
