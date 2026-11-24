import JSZip from 'jszip';
import { api } from './api.js';

/**
 * Collect DICOM files from: a folder picker, dropped folders/files, ZIP archives, or a CD (DICOMDIR is skipped,
 * the image files next to it are taken). Non-DICOM files are filtered by the "DICM" preamble.
 *
 * `onStats` receives {read, kept, skipped} so the UI can say what happened instead of silently importing
 * a single file out of a folder.
 */
export async function collectFromFileList(fileList, onStats) {
  const out = [];
  const stats = { read: 0, kept: 0, skipped: 0 };
  for (const f of fileList) {
    stats.read++;
    const r = await addFile(out, f, f.webkitRelativePath || f.name);
    r === 'kept' ? stats.kept++ : stats.skipped++;
  }
  onStats?.(stats);
  return out;
}

/**
 * Dropped items. Chrome's DataTransferItems die as soon as the drop handler returns, so the entries are
 * snapshotted synchronously here and then drained through the File System Access API when available
 * (reliable for folders), falling back to webkitGetAsEntry.
 */
export async function collectFromDrop(dataTransfer, onStats) {
  const stats = { read: 0, kept: 0, skipped: 0 };
  const items = [...dataTransfer.items];
  const handles = [];
  const entries = [];
  for (const it of items) {
    if (it.kind !== 'file') continue;
    if (it.getAsFileSystemHandle) {
      handles.push(it.getAsFileSystemHandle().catch(() => null));
    } else if (it.webkitGetAsEntry) {
      const e = it.webkitGetAsEntry();
      if (e) entries.push(e);
    }
  }
  const out = [];
  const resolved = await Promise.all(handles);
  const realHandles = resolved.filter(Boolean);
  if (realHandles.length) {
    for (const h of realHandles) await walkHandle(h, out, stats);
  } else {
    for (const e of entries) await walkEntry(e, out, stats);
  }
  if (!realHandles.length && !entries.length) {
    return collectFromFileList(dataTransfer.files, onStats);
  }
  onStats?.(stats);
  return out;
}

/** File System Access API: a dropped folder becomes a FileSystemDirectoryHandle. */
async function walkHandle(handle, out, stats) {
  if (handle.kind === 'file') {
    const file = await handle.getFile();
    stats.read++;
    const r = await addFile(out, file, handle.name);
    r === 'kept' ? stats.kept++ : stats.skipped++;
    return;
  }
  for await (const child of handle.values()) await walkHandle(child, out, stats);
}

/** Legacy path: FileSystemEntry (webkitGetAsEntry). readEntries keeps being called inside its own callback so
 * Chrome never invalidates the directory reader between batches. */
function walkEntry(entry, out, stats) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file(
        async (file) => {
          stats.read++;
          const r = await addFile(out, file, entry.fullPath || file.name);
          r === 'kept' ? stats.kept++ : stats.skipped++;
          resolve();
        },
        () => {
          stats.read++;
          stats.skipped++;
          resolve();
        }
      );
    });
  }
  if (!entry.isDirectory) return Promise.resolve();
  const reader = entry.createReader();
  return new Promise((resolve) => {
    const children = [];
    const drain = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) return resolve(children);
          children.push(...batch);
          drain();
        },
        () => resolve(children)
      );
    };
    drain();
  }).then(async (children) => {
    for (const c of children) await walkEntry(c, out, stats);
  });
}

async function addFile(out, file, path) {
  const name = file.name.toUpperCase();
  if (name === 'DICOMDIR' || name.startsWith('.')) return 'skipped';
  if (name.endsWith('.ZIP')) {
    const zip = await JSZip.loadAsync(file);
    let added = 0;
    for (const z of Object.values(zip.files)) {
      if (z.dir) continue;
      const base = z.name.split('/').pop().toUpperCase();
      if (base === 'DICOMDIR' || base.startsWith('.') || z.name.includes('__MACOSX')) continue;
      const buf = await z.async('arraybuffer');
      if (isDicom(buf)) {
        out.push({ name: `${file.name}/${z.name}`, size: buf.byteLength, buffer: buf });
        added++;
      }
    }
    return added ? 'kept' : 'skipped';
  }
  if (file.size < 132) return 'skipped';
  const head = await file.slice(0, 132).arrayBuffer();
  if (!isDicom(head)) return 'skipped';
  out.push({ name: path, size: file.size, file });
  return 'kept';
}

function isDicom(buf) {
  if (buf.byteLength < 132) return false;
  const b = new Uint8Array(buf, 128, 4);
  return b[0] === 0x44 && b[1] === 0x49 && b[2] === 0x43 && b[3] === 0x4d;
}

/**
 * Upload in parallel with retry. Calls onProgress({done, failed, total, bytesDone}).
 * Returns the set of Orthanc study IDs touched.
 */
export async function uploadAll(items, { concurrency = 4, onProgress, signal } = {}) {
  const studies = new Set();
  let done = 0, failed = 0, bytesDone = 0, idx = 0;
  const errors = [];

  async function one(item) {
    const buf = item.buffer || (await item.file.arrayBuffer());
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await api.raw('/upload/instance', buf, { signal });
        studies.add(r.study);
        return;
      } catch (e) {
        if (signal?.aborted || e.status === 400 || attempt === 3) throw e;
        await new Promise((res) => setTimeout(res, 600 * attempt));
      }
    }
  }

  async function worker() {
    while (idx < items.length && !signal?.aborted) {
      const item = items[idx++];
      try {
        await one(item);
        done++;
        bytesDone += item.size;
      } catch (e) {
        if (signal?.aborted) return;
        failed++;
        errors.push({ name: item.name, error: e.message });
      }
      onProgress?.({ done, failed, total: items.length, bytesDone });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { studies: [...studies], errors };
}
