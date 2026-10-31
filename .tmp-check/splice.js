const fs = require('fs');
const p = 'public/index.html';
let html = fs.readFileSync(p, 'utf8');
const css = fs.readFileSync('.tmp-check/shell.css', 'utf8');
const hud = fs.readFileSync('.tmp-check/hud.html', 'utf8');
const screens = fs.readFileSync('.tmp-check/screens.html', 'utf8');

function cut(startMarker, endMarker, replacement, label) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a + 1);
  if (a < 0 || b < 0) throw new Error('markers not found: ' + label + ' ' + a + ' ' + b);
  html = html.slice(0, a) + replacement + html.slice(b);
}

// 1. Stylesheet, immediately before the closing style tag.
const styleClose = '\n  </style>';
if (!html.includes(styleClose)) throw new Error('style close missing');
html = html.replace(styleClose, '\n' + css + styleClose);

// 2. Menu FX canvas sits above the WebGL canvas, below the DOM menus.
const flash = '  <div id="flashOverlay"></div>';
if (!html.includes(flash)) throw new Error('flash overlay marker missing');
html = html.replace(flash, flash + '\n  <canvas id="menuFx" aria-hidden="true"></canvas>');

// 3. HUD.
cut('  <!-- ─── HUD ─── -->', '  <!-- ─── MODAL 1: LOBBY & CLASS SELECTION ─── -->', hud, 'hud');

// 4. All lobby/modals replaced by the shell screens. Keep the stage closing div.
cut('  <!-- ─── MODAL 1: LOBBY & CLASS SELECTION ─── -->', '<!-- Three.js Library -->', screens + '</div>\n\n', 'screens');

fs.writeFileSync(p, html);
console.log('wrote', p, html.length, 'bytes');
