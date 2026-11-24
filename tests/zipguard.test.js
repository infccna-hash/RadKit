// ZIP integrity guard: a valid archive must always pass (Orthanc writes a ZIP comment), a truncated one never.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { Readable, Writable, pipeline } from 'node:stream';
import { zipGuard } from '../api/src/lib/http.js';

const SEED = Number(process.env.PROP_SEED) || (Date.now() % 1e9);

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)) };
}

/** Minimal valid ZIP (one stored member) with an optional archive comment, like Orthanc produces */
function zip(dataLen, comment = '') {
  const name = Buffer.from('IMAGES/IM0001.dcm');
  const data = Buffer.alloc(dataLen, 0x41);
  const crc = zlib.crc32(data) >>> 0;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(dataLen, 18); lh.writeUInt32LE(dataLen, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(dataLen, 20); cd.writeUInt32LE(dataLen, 24); cd.writeUInt16LE(name.length, 28);
  const c = Buffer.from(comment);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(30 + name.length + dataLen, 16); eocd.writeUInt16LE(c.length, 20);
  return Buffer.concat([lh, name, data, cd, name, eocd, c]);
}

/** Push `buf` through the guard in the given chunk sizes; resolve 'ok' or 'error' */
function guard(buf, chunkSizes) {
  const chunks = [];
  for (let i = 0, k = 0; i < buf.length; k++) {
    const n = Math.max(1, chunkSizes[k % chunkSizes.length]);
    chunks.push(buf.subarray(i, i + n));
    i += n;
  }
  return new Promise((resolve) => {
    let bytes = 0;
    pipeline(
      Readable.from(chunks),
      zipGuard(),
      new Writable({ write(c, _e, cb) { bytes += c.length; cb(); } }),
      (err) => resolve({ result: err ? 'error' : 'ok', bytes })
    );
  });
}

test('regression: a ZIP ending with the comment "Created by Orthanc" passes (seen in production)', async () => {
  const z = zip(1200, 'Created by Orthanc');
  // exact tail observed on the live server: "...\x00\x00\x12\x00Created by Orthanc"
  assert.equal(z.subarray(-22).toString('hex'), '0000120043726561746564206279204f727468616e63');
  const r = await guard(z, [4096]);
  assert.equal(r.result, 'ok');
  assert.equal(r.bytes, z.length, 'every byte must be forwarded');
});

test('property: valid archives always pass, whatever the chunking and comment size', async () => {
  const r = rng(SEED);
  for (let k = 0; k < 300; k++) {
    const comment = (r.int(0, 1) ? 'C'.repeat(r.int(0, 300)) : '') + (r.int(0, 1) ? 'Created by Orthanc' : '');
    const z = zip(r.int(0, 5000), comment);
    const sizes = Array.from({ length: r.int(1, 5) }, () => r.int(1, 3000));
    const out = await guard(z, sizes);
    assert.equal(out.result, 'ok', `seed=${SEED} case=${k} comment=${comment.length} chunks=${sizes}`);
  }
});

test('property: a cut anywhere before the true end is always detected', async () => {
  const r = rng(SEED + 1);
  for (let k = 0; k < 300; k++) {
    const z = zip(r.int(0, 5000), r.int(0, 1) ? 'Created by Orthanc' : '');
    const cut = r.int(0, z.length - 1); // keep [0, cut): strictly shorter than the archive
    const sizes = Array.from({ length: r.int(1, 4) }, () => r.int(1, 3000));
    const out = await guard(z.subarray(0, cut), sizes);
    assert.equal(out.result, 'error', `seed=${SEED} case=${k} cut=${cut}/${z.length}`);
  }
});

test('a big archive with the maximum comment (65535 bytes) passes, with bounded memory', async () => {
  const z = zip(3_000_000, 'x'.repeat(0xffff));
  const r = await guard(z, [65536]);
  assert.equal(r.result, 'ok');
});
