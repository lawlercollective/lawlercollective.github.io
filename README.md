# Lawler Collective website

www.lawlercollective.com, a photography portfolio built automatically from the photos in `photos/`.

## Managing photos

Each folder in `photos/` is one category:

| Folder | Shows up on |
|---|---|
| `photos/recent/` | Home page, under "Our Recent Work" |
| `photos/portraits/` | Gallery → Portraits |
| `photos/cars/` | Gallery → Cars |
| `photos/environments/` | Gallery → Environments |

You never need to resize, compress or rename photos. Add the full-size JPEGs (PNG, WebP, AVIF, TIFF and HEIC also work), and the build makes every size the site needs.

### The photo manager (easiest)

1. Start the preview (see [Previewing locally](#previewing-locally)) and open **http://localhost:8080/admin**.
2. In the photo manager you can:
   - **Add photos:** drag them from File Explorer onto a category, or click **+ Add photos**. They're named `LAW-NN` automatically.
   - **Move photos:** drag thumbnails onto another category, or click to select several and use **Move to**.
   - **Delete photos:** select them and click **Delete**. They go to the `.trash` folder (not published), so you can still get them back.
   - **Categories:** **+ New category** adds a gallery page and menu entry. **Rename**, **↑ / ↓** (menu order) and **Delete** (only when empty) are on each category.
   - **Landing slideshow:** click the **★** on any photo to put it in the full-screen slideshow on the home page.
   - **Renumber:** tidies a category's file names to `LAW-01`, `LAW-02`, … with no gaps.
3. The preview at http://localhost:8080 updates by itself after each change.
4. To publish, commit and push (for example in GitHub Desktop). The live site updates a few minutes later.

### Without any software (GitHub website)

1. Open the repository on github.com and go into `photos/`, then the category folder.
2. Click **Add file → Upload files**, drag the photos in, and click **Commit changes**. To remove a photo, open it and use the **…** menu → **Delete file**.
3. Watch the **Actions** tab. When the run turns green, the site is updated.

### Good to know

- **Order:** every gallery is shuffled into a new random order each time the page is opened. To show photos in filename order instead, add `"shuffle": false` to [site.json](site.json).
- **Slideshow default:** with no ★ picks, the slideshow uses the first 5 wide photos in `photos/recent/`. The picks are stored as `"hero"` in [site.json](site.json). Wide (landscape) photos work best.
- **Alt text:** a descriptive file name like `red-mustang-at-sunset.jpg` becomes the image's description for screen readers and search engines ("Red Mustang At Sunset"). Camera-style names like `LAW-12.jpg` get a generic description.
- **Tidy numbering from the command line:** `npm run renumber` (add `-- --dry` to preview).

## Previewing locally

It requires [Node.js](https://nodejs.org) 20 or newer. The first time only:

```powershell
npm install
```

Then, each time:

```powershell
npm run dev
```

Open http://localhost:8080 (the site) or http://localhost:8080/admin (the photo manager). The preview only answers your own computer. The first start after adding many photos takes a few minutes while they're converted; after that, only new photos take time.

## How it works

- **Images:** `npm run build` converts every photo to AVIF and WebP at 400, 800, 1200 and 1600px wide, plus a 2400px version for full screen. On each page, the browser is told every photo's exact on-screen width, so a phone downloads small files and a large screen gets sharp ones. Browsers that can't show AVIF get WebP. Photos are auto-rotated and stripped of metadata, including GPS location.
- **Speed:** styles and scripts are built into each page (no extra requests), the font is self-hosted with a size-matched fallback so text doesn't jump, below-the-fold photos load as you scroll, the slideshow downloads each photo just before it's shown, and Google Analytics loads after the page is ready.
- **Cache:** converted photos are cached in `.cache/` by their content, so only new or changed photos take time. Unused cached files are removed automatically.
- **Publishing:** `.github/workflows/deploy.yml` runs the build on every push to `main` and publishes `_site/` to GitHub Pages.

| Path | What it is |
|---|---|
| `src/layout.html` | Shared page shell: header, footer, photo viewer |
| `src/home.html` | Home page text (about, contact) |
| `src/site.css` | All styles |
| `src/site.js` | Menus, scrolling, slideshow, photo viewer, swipe gestures |
| `src/grid.js` | Photo grid layout (shuffle, row rhythm, exact image sizes) |
| `src/assets/` | Logos and favicons |
| `site.json` | Site name, footer version number, gallery menu order, slideshow picks |
| `scripts/build.mjs` | The build: image processing and page generation |
| `scripts/dev.mjs` | Local preview server and photo manager |
| `scripts/admin.html` | The photo manager page |

`_site/`, `.cache/`, `.trash/` and `node_modules/` are generated or local-only, so they're git-ignored.
