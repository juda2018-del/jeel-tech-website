import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const fail = (message) => failures.push(message);

const pages = ['index.html', 'privacy.html'];
const html = {};

for (const page of pages) {
  const file = join(root, page);
  if (!existsSync(file)) fail(`missing required page ${page}`);
  else html[page] = readFileSync(file, 'utf8');
}

function attrs(source, name) {
  const found = [];
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi');
  let match;
  while ((match = re.exec(source))) found.push(match[1] ?? match[2]);
  return found;
}

function idSet(source) {
  return new Set(attrs(source, 'id'));
}

const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function checkLinks(page, source) {
  for (const href of attrs(source, 'href')) {
    const value = href.trim();
    if (!value || value === '#') {
      fail(`${page} contains a broken internal link (${JSON.stringify(href)})`);
      continue;
    }
    if (external.test(value)) continue;
    const [rawPath, hash = ''] = value.split('#');
    const targetPage = rawPath === '' ? page : rawPath;
    if (targetPage.startsWith('/') || targetPage.split(/[\\/]/).includes('..')) {
      fail(`${page} contains an unsafe link ${value}`);
      continue;
    }
    const targetFile = join(root, targetPage);
    if (!existsSync(targetFile)) {
      fail(`${page} links to missing file ${value}`);
      continue;
    }
    if (hash) {
      const targetHtml = html[targetPage] ?? (extname(targetFile) === '.html' ? readFileSync(targetFile, 'utf8') : '');
      if (!idSet(targetHtml).has(hash)) fail(`${page} links to missing section #${hash} in ${targetPage}`);
    }
  }

  for (const src of attrs(source, 'src')) {
    if (!src.trim() || external.test(src) || src.startsWith('data:')) continue;
    if (!existsSync(join(root, src.split('#')[0]))) fail(`${page} references missing asset ${src}`);
  }
}

for (const [page, source] of Object.entries(html)) checkLinks(page, source);

const index = html['index.html'] ?? '';
const privacy = html['privacy.html'] ?? '';
const script = existsSync(join(root, 'script.js')) ? readFileSync(join(root, 'script.js'), 'utf8') : '';
const indexIds = idSet(index);

for (const id of ['home', 'services', 'projects', 'process', 'about', 'contact']) {
  if (!indexIds.has(id)) fail(`index.html is missing #${id}`);
}

const preserved = [
  ['index email', index, 'hello@jeeltech.iq'],
  ['index phone', index, '+964 772 455 4424'],
  ['index whatsapp', index, 'https://wa.me/9647724554424'],
  ['privacy email', privacy, 'hello@jeeltech.iq'],
  ['privacy phone', privacy, '+964 772 455 4424'],
  ['script whatsapp number', script, "const WHATSAPP_NUMBER='9647724554424'"],
  ['fuse link', index, 'href="https://www.fuseiraq.com"'],
  ['suqly link', index, 'href="https://www.suqly.cloud"'],
  ['jazal link', index, 'href="https://jazal.vercel.app"'],
  ['footer privacy link', index, 'href="privacy.html"'],
];

for (const [label, source, needle] of preserved) {
  if (!source.includes(needle)) fail(`${label} is missing (${needle})`);
}

if (!index.includes('<article class="project-card fancy')) fail('Fancy Hub is no longer an unlinked project card');
if (/<form[^>]*\saction\s*=/i.test(index)) fail('contact form has an action attribute and could post away from the page');
if (!script.includes('preventDefault()')) fail('contact form does not cancel the browser submit');
if (!script.includes('https://wa.me/${WHATSAPP_NUMBER}?text=')) fail('contact form does not open WhatsApp with the entered fields');
if (/\b(fetch|XMLHttpRequest|emailjs|formspree|smtp)\b/i.test(`${script}\n${index}`)) fail('site contains an unexpected mail or network submit path');
if (/سجل تجاري|رقم التسجيل|الرقم الضريبي|رقم الإجازة/.test(privacy)) fail('privacy page includes company registration details that are not published on the site');

const types = new Map([
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.js', 'text/javascript'],
  ['.png', 'image/png'],
  ['.txt', 'text/plain'],
]);

function insideRoot(file) {
  const resolved = resolve(file);
  return resolved === root || resolved.startsWith(`${root}${sep}`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = resolve(root, pathname.replace(/^\/+/, ''));
  if (!insideRoot(file) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const type = types.get(extname(file)) ?? 'application/octet-stream';
  const charset = type.startsWith('text/') || type.includes('javascript') ? '; charset=utf-8' : '';
  res.writeHead(200, { 'Content-Type': `${type}${charset}` });
  res.end(readFileSync(file));
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;

const routes = [
  ['/', 200, 'text/html', 'JEEL TECH'],
  ['/index.html', 200, 'text/html', 'projectForm'],
  ['/privacy.html', 200, 'text/html', 'سياسة الخصوصية'],
  ['/styles.css', 200, 'text/css', '--navy'],
  ['/script.js', 200, 'text/javascript', 'WHATSAPP_NUMBER'],
  ['/assets/jeel-tech-logo.png', 200, 'image/png', null],
  ['/missing-page.html', 404, 'text/plain', null],
];

for (const [path, status, type, bodyNeedle] of routes) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (response.status !== status) fail(`${path} returned ${response.status}, expected ${status}`);
  const header = response.headers.get('content-type') ?? '';
  if (!header.includes(type)) fail(`${path} content-type ${header} does not include ${type}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (bodyNeedle && !body.includes(Buffer.from(bodyNeedle))) fail(`${path} response did not include expected content`);
  if (path.endsWith('.png') && body.length < 8) fail(`${path} response was empty`);
}

await new Promise((resolveClose) => server.close(resolveClose));

if (failures.length) {
  console.error(`Site check failed with ${failures.length} problem(s):`);
  for (const problem of failures) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Site check passed: ${pages.length} pages, internal links, and ${routes.length} HTTP responses.`);
