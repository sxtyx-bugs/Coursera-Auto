const fs = require('fs');
const popup = fs.readFileSync('popup.js', 'utf8');
const content = fs.readFileSync('content.js', 'utf8');

console.log('--- PROVIDER_DEFAULTS in popup.js ---');
const idx = popup.indexOf('PROVIDER_DEFAULTS');
if (idx !== -1) console.log(popup.substring(idx, idx + 1000));

console.log('--- PROVIDERS in content.js ---');
const idx2 = content.indexOf('const DEFAULT_PROVIDERS =');
if (idx2 !== -1) console.log(content.substring(idx2, idx2 + 1000));
const idx3 = content.indexOf('MultiProviderAISolver');
if (idx3 !== -1) console.log(content.substring(idx3, idx3 + 1200));
