import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { userscriptHeader } from './build/userscript-header.js';

export default defineConfig({
    define: {
        // Single source of truth for the version: package.json → @version and DSS_VERSION.
        __DSS_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // Greasy Fork does not accept minified code.
        minify: false,
        lib: {
            entry: 'src/main.js',
            formats: ['iife'],
            name: 'DSS',
            fileName: () => 'dss.user.js',
        },
        rolldownOptions: {
            // Tree-shaking also constant-folds and inlines single-use variables.
            // Turn it off so the published file stays a faithful copy of src/.
            treeshake: false,
            output: {
                // build.minify:false alone still leaves Rolldown's 'dce-only' pass on.
                minify: false,
                // The original script ran in strict mode; keep it that way.
                intro: "'use strict';",
            },
        },
    },
    plugins: [
        userscriptHeader({
            name: 'DSS: Unified Script Manager',
            namespace: 'http://tampermonkey.net/',
            version: pkg.version,
            description: 'Unified manager for DSS (Dsuttz Scripts) modules',
            author: 'Dsuttz [1561637]',
            match: 'https://www.torn.com/*',
            grant: [
                'GM_addStyle',
                'GM_getValue',
                'GM_setValue',
                'GM_deleteValue',
                'GM_listValues',
                'GM_xmlhttpRequest',
                'GM.xmlHttpRequest',
                'unsafeWindow',
            ],
            connect: [
                'tornprobability.com',
                'api.torn.com',
                'iwmpklkqwlniguyeaygv.supabase.co',
                'api.no1irishstig.co.uk',
                'tornarmourynotesmanager-production.up.railway.app',
                'medx.fun',
            ],
            'run-at': 'document-start',
            downloadURL: 'https://update.greasyfork.org/scripts/578862/DSS%3A%20Unified%20Script%20Manager.user.js',
            updateURL: 'https://update.greasyfork.org/scripts/578862/DSS%3A%20Unified%20Script%20Manager.meta.js',
        }),
    ],
});
