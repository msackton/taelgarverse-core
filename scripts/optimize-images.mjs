import sharp from 'sharp';

export const IMAGE_DEFAULTS = {maxSize: 2560, quality: 82};
export const IMAGE_VERSION = {sharp: sharp.versions.sharp, vips: sharp.versions.vips};

export function animatedPNG(input) {
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
