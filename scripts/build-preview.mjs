import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const output = path.join(root, 'dist/preview');
fs.rmSync(output, {recursive: true, force: true}); // Generated frontend only, never visitor data.
fs.mkdirSync(output, {recursive: true});
for (const file of ['style.css', 'app.js']) fs.copyFileSync(path.join(root, 'web', file), path.join(output, file));
fs.copyFileSync(path.join(root, 'runtime/preview-bridge.js'), path.join(output, 'preview-bridge.js'));
fs.cpSync(path.join(root, 'dist/edgeboard'), path.join(output, 'edgeboard'), {recursive: true});
const transport = rootPath => `<script>window.__PREVIEW_API_BASE__='__PORT_8080__';window.__PREVIEW_ROOT__='${rootPath}';</script>`;
let html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8')
  .replace('href="/style.css"', 'href="./style.css"')
  .replace('<script defer src="/app.js"></script>', `${transport('./')}<script src="./preview-bridge.js"></script><script defer src="./app.js"></script>`);
fs.writeFileSync(path.join(output, 'index.html'), html);
html = fs.readFileSync(path.join(output, 'edgeboard/index.html'), 'utf8')
  .replaceAll('"/edgeboard/assets/', '"./assets/')
  .replace('</head>', `${transport('../')}<script src="../preview-bridge.js"></script></head>`);
fs.writeFileSync(path.join(output, 'edgeboard/index.html'), html);
console.log(`Private preview frontend built at ${output}`);
