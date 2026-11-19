// Prepends the ==UserScript== metadata block to the built file.
// Keys map 1:1 to @-tags; arrays become one line per value.
export function userscriptHeader(meta) {
    const pad = Math.max(...Object.keys(meta).map(k => k.length)) + 2;
    const lines = ['// ==UserScript=='];
    for (const [key, value] of Object.entries(meta)) {
        for (const v of [].concat(value)) lines.push(`// @${key.padEnd(pad)}${v}`);
    }
    lines.push('// ==/UserScript==', '', '');
    const header = lines.join('\n');

    return {
        name: 'userscript-header',
        generateBundle(_, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === 'chunk' && chunk.isEntry) chunk.code = header + chunk.code;
            }
        },
    };
}
