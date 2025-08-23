
# natwerth.com → GitHub Pages (project site)

**Drop this at the root of a repo** (e.g., `sample-site`) and enable GitHub Pages (deploy from `main` root).  
It works under `/{REPO-NAME}/` thanks to a dynamic `<base>` tag.

## What I did
- Converted `.html` files to **pretty URLs** (`page.html` → `page/index.html`)
- Injected a **header partial** placeholder on each page: `<div data-include="partials/header.html"></div>`
- Added **assets/js/site.js** that loads the header partial and wires a basic mobile toggle (no-op if elements absent)
- Mirrored all static files under **assets/vendor/site/** to avoid broken references

## Notes
- If a page used WP/PHP features (shortcodes, loops), it’s now static markup.
- Paths inside your old HTML may still point to `/wp-content/...`. I mirrored the original structure at `assets/vendor/site/wp-content/...`, so they should resolve via the dynamic base. If you spot a 404, search/replace that path in your page.

## Local test
```bash
python3 -m http.server 5500
# open http://localhost:5500/{REPO-NAME}/  (when served as a project site path)
```
