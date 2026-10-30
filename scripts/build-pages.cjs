const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs');
const files = [
  'index.html',
  'app.css',
  'script/app.js',
  'script/api.js',
  'script/music-data.js'
];
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.ico']);
const csp = "default-src 'self'; script-src 'self' https://api.deezer.com; connect-src 'self'; img-src 'self' https:; media-src 'self' blob: https:; object-src 'none'; base-uri 'self'";

function copyImageTree(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyImageTree(from, to);
    else if (imageExtensions.has(path.extname(entry.name).toLowerCase())) fs.copyFileSync(from, to);
  }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of files) {
  const source = path.join(root, file);
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (file.endsWith('.html')) {
    const html = fs.readFileSync(source, 'utf8').replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
    fs.writeFileSync(target, html);
  } else {
    fs.copyFileSync(source, target);
  }
}

copyImageTree(path.join(root, 'Imagens'), path.join(output, 'Imagens'));
fs.mkdirSync(path.join(output, 'script'), { recursive: true });
fs.writeFileSync(path.join(output, 'script/runtime-config.js'), "window.FORMREPORT_MODE = 'static';\n");
fs.writeFileSync(path.join(output, '.nojekyll'), '');

console.log('GitHub Pages regenerado em docs/ apenas com arquivos públicos e imagens permitidas.');
