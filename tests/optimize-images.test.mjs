import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {optimizeImages} from '../scripts/optimize-images.mjs';

test('web image preparation preserves names, format, alpha, aspect, and original files, and caches by content/settings', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taelgar-images-test-'));
  t.after(() => fs.rm(directory, {recursive: true}));
  const cache = path.join(directory, 'cache');
  const pixels = Buffer.alloc(600 * 300 * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
  const original = await sharp(pixels, {raw: {width: 600, height: 300, channels: 4}}).png().toBuffer();
  const source = path.join(directory, 'original.png');
  await fs.writeFile(source, original);
  const filename = path.join(directory, 'map with spaces.png');
  const entry = {id: 'assets/map with spaces.png', filename, note: null};
  await fs.copyFile(source, filename);
  const stats = await optimizeImages([entry], cache, {maxSize: 120});
  const metadata = await sharp(await fs.readFile(filename)).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 120);
  assert.equal(metadata.height, 60);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(stats.optimized, 1);
  assert.ok(stats.outputBytes < stats.inputBytes);
  assert.deepEqual(await fs.readFile(source), original);
  await fs.copyFile(source, filename);
  assert.equal((await optimizeImages([entry], cache, {maxSize: 120})).cached, 1);
  await fs.copyFile(source, filename);
  assert.equal((await optimizeImages([entry], cache, {maxSize: 80})).cached, 0);
  assert.equal((await sharp(await fs.readFile(filename)).metadata()).width, 80);
});

test('small images are never enlarged; animated and vector assets remain intact', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taelgar-images-test-'));
  t.after(() => fs.rm(directory, {recursive: true}));
  const jpeg = path.join(directory, 'small.jpg');
  await sharp({create: {width: 12, height: 8, channels: 3, background: 'red'}}).jpeg().toFile(jpeg);
  const animated = path.join(directory, 'animation.webp');
  const frames = Buffer.alloc(8 * 16 * 3, 140);
  frames.fill(230, frames.length / 2);
  const animation = await sharp(frames, {raw: {width: 8, height: 16, channels: 3, pageHeight: 8}})
    .webp({loop: 0, delay: [100, 100]}).toBuffer();
  await fs.writeFile(animated, animation);
  assert.equal((await sharp(await fs.readFile(animated)).metadata()).pages, 2);
  const vector = path.join(directory, 'drawing.svg');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>';
  await fs.writeFile(vector, svg);
  const entries = [jpeg, animated, vector].map(filename => ({id: path.basename(filename), filename, note: null}));
  const result = await optimizeImages(entries, path.join(directory, 'cache'), {maxSize: 100});
  assert.equal((await sharp(await fs.readFile(jpeg)).metadata()).width, 12);
  assert.equal(result.animated, 1);
  assert.deepEqual(await fs.readFile(animated), animation);
  assert.equal(await fs.readFile(vector, 'utf8'), svg);
});
