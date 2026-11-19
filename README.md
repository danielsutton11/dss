# DSS — Dsuttz Scripts

Unified Torn userscript manager. The source lives in `src/`; `npm run build` produces the single
`dist/dss.user.js` that gets published to Greasy Fork.

## Setup

```bash
npm install
npm run build      # → dist/dss.user.js
npm run watch      # rebuild on every save
```

Requires Node 20.19+ (Vite 8).

## Layout

```
src/
  main.js                 entry: imports every module (order = settings-page order), then boots
  core/
    constants.js          DSS_VERSION, IS_PDA, API_BASE, tornAuth, escHtml, storage keys
    registry.js           MODULES, registerModule, factionAllowed
    storage.js            Storage (GM_getValue/GM_setValue wrapper)
    loader.js             Loader — decides which modules run on the current page
    api.js                validateApiKey
    sidebar.js            sidebar button + nav highlighting
    ui.js                 settings page UI, module icons/categories
    init.js               init()
  modules/<id>/
    index.js              registerModule('<id>', { ... })
    guide.html            the module's guide page (imported as raw text)
build/
  userscript-header.js    writes the ==UserScript== block
vite.config.js            metadata (@match, @grant, @connect…) lives here
```

## Adding a module

1. Create `src/modules/<id>/index.js` calling `registerModule('<id>', { … })` and, if it has a guide,
   `src/modules/<id>/guide.html` + `import guide from './guide.html?raw';`.
2. Import only what it uses from `../../core/…`.
3. Add `import './modules/<id>/index.js';` to `src/main.js`.
4. Add its icon/category in `src/core/ui.js` (`MODULE_ICONS`, `MODULE_CATEGORIES`).
5. If it calls a new host, add it to `connect` in `vite.config.js`.

## Releasing

1. Bump `version` in `package.json` — this sets both `@version` and `DSS_VERSION`.
2. `npm run build`
3. Upload `dist/dss.user.js` to Greasy Fork (or let Greasy Fork sync it from GitHub once the repo is public).

## Testing locally in Tampermonkey

Allow Tampermonkey file access (browser extension settings → "Allow access to file URLs"), then install
a tiny stub script that `@require`s the build output, and run `npm run watch`:

```js
// ==UserScript==
// @name         DSS (local dev)
// @match        https://www.torn.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      *
// @require      file:///ABSOLUTE/PATH/TO/dss/dist/dss.user.js
// ==/UserScript==
```

Disable the Greasy Fork copy while doing this so DSS doesn't run twice.

## Notes on the build

- `minify: false`, Rolldown's `output.minify: false` and `treeshake: false` together keep the published
  file a faithful copy of `src/` (Greasy Fork rejects minified code, and tree-shaking would also
  constant-fold and inline variables).
- Rolldown strips ordinary `//` comments from the output; the commented source is in `src/`.
