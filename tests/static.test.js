// Static assets that ship to browsers without going through the Vite build must at least parse.
// (A syntax error in simple-viewer.html or app-config.js would otherwise reach a radiologist untested.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.join(import.meta.dirname, '..');
const compile = (code, file) => {
  try {
    new vm.Script(code, { filename: file });
  } catch (e) {
    assert.fail(`${file}: ${e.message}`);
  }
};

test('infra/ohif/app-config.js parses', () => {
  const file = path.join(root, 'infra/ohif/app-config.js');
  compile(fs.readFileSync(file, 'utf8'), file);
});

test('every inline <script> in infra/nginx/*.html parses, and every page is shipped by the image', () => {
  const dir = path.join(root, 'infra/nginx');
  const dockerfile = fs.readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(dir, page), 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    scripts.forEach((code, i) => compile(code, `${page} <script #${i + 1}>`));
    assert.ok(dockerfile.includes(`infra/nginx/${page}`), `${page} is not copied into the nginx image`);
  }
});
