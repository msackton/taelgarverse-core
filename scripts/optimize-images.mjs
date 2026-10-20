import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import sharp from 'sharp';

export const IMAGE_DEFAULTS = {maxSize: 2560, quality: 82};
export const IMAGE_VERSION = {sharp: sharp.versions.sharp, vips: sharp.versions.vips};
const formats = new Map([['.jpg', 'jpeg'], ['.jpeg', 'jpeg'], ['.png', 'png'], ['.webp', 'webp']]);

function animatedPNG(input) {
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  for (let offset = 8; offset + 12 <= input.length;) {
    const size = input.readUInt32BE(offset);
    const type = input.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += size + 12;
  }
  return false;
}

export async function fileHash(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

// Only call this with disposable exported files, never with source-vault files.
// Preserve names/formats so existing Markdown links and MIME types stay valid.
export async function optimizeImages(entries, cacheDir, options = {}, onProgress = () => {}) {
  const settings = {...IMAGE_DEFAULTS, ...options};
  if (!Number.isInteger(settings.maxSize) || settings.maxSize < 1 ||
      !Number.isInteger(settings.quality) || settings.quality < 1 || settings.quality > 100) {
    throw new Error('Image size must be a positive integer and quality must be 1–100.');
  }
  await fs.mkdir(cacheDir, {recursive: true});
  const recipe = createHash('sha256').update(JSON.stringify({...settings, ...IMAGE_VERSION})).digest('hex');
  const stats = {images: 0, optimized: 0, cached: 0, animated: 0, inputBytes: 0, outputBytes: 0};
  for (const entry of entries) {
    const format = formats.get(path.extname(entry.filename).toLowerCase());
    if (entry.note || !format) continue;
    const filename = entry.filename;
    const original = await fs.stat(filename);
    const hash = await fileHash(filename);
    const cacheKey = createHash('sha256').update(hash + recipe + (entry.mapImage ? ':map' : '')).digest('hex');
    const cached = path.join(cacheDir, `${cacheKey}.${format}`);
    stats.images++;
    stats.inputBytes += original.size;
    let exists = true;
    try { await fs.access(cached); } catch { exists = false; }
    if (exists) {
      stats.cached++;
    } else {
      // Buffer input prevents libvips' file cache from holding the exported
      // original open when we replace it on Windows. Process one image at a time.
      const input = await fs.readFile(filename);
      // libvips can expose APNG as a single page, so inspect its animation chunk.
      if (format === 'png' && animatedPNG(input)) {
        stats.animated++;
        stats.outputBytes += original.size;
        onProgress({...stats, currentFile: entry.id});
        continue;
      }
      const metadata = await sharp(input).metadata();
      if (metadata.format !== format) throw new Error(`Image extension does not match its format: ${entry.id}`);
      if ((metadata.pages || 1) > 1) {
        // Animated WebP/APNG must not silently become a single still image.
        stats.animated++;
        stats.outputBytes += original.size;
        onProgress({...stats, currentFile: entry.id});
        continue;
      }
      // Short filenames also work when Windows has its legacy path limit.
      const temporary = path.join(cacheDir, randomUUID() + '.' + format);
      try {
        let image = sharp(input).autoOrient();
        if (!entry.mapImage) image = image.resize({
          width: settings.maxSize, height: settings.maxSize, fit: 'inside', withoutEnlargement: true,
        });
        if (format === 'jpeg') image = image.jpeg({quality: settings.quality, mozjpeg: true});
        if (format === 'png') image = image.png({compressionLevel: 9, adaptiveFiltering: true});
        if (format === 'webp') image = image.webp({quality: settings.quality});
        await image.toFile(temporary);
        if ((await fs.stat(temporary)).size >= original.size) await fs.copyFile(filename, temporary);
        await fs.rename(temporary, cached);
      } finally {
        await fs.rm(temporary, {force: true});
      }
    }
    const size = (await fs.stat(cached)).size;
    if (size < original.size) stats.optimized++;
    stats.outputBytes += size;
    await fs.copyFile(cached, filename);
    onProgress({...stats, currentFile: entry.id});
  }
  return stats;
}
