// Shared by the renderer and the bundled Obsidian prototype; no platform APIs.
export function pronunciationPaths(notePath) {
  const normalized = String(notePath).replaceAll('\\', '/');
  if (!normalized.endsWith('.md') || normalized.split('/').some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\[\]|:#]/.test(part))) {
    throw new Error('Pronunciation requires a vault-relative Markdown path');
  }
  const stem = 'assets/pronunciation/' + normalized.slice(0, -3);
  return {audio: stem + '.wav', mock: stem + '.mock.wav', candidates: [stem + '.wav', stem + '.mp3', stem + '.mock.wav']};
}

export const LINK_START = '<!-- taelgar:pronunciation -->';
export const LINK_END = '<!-- /taelgar:pronunciation -->';
function headerOffset(source) {
  return /^(?:---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n)?[ \t\r\n]*/.exec(source)[0].length;
}
export function stripPronunciationLink(source) {
  const offset = headerOffset(source);
  if (!/^# [^\r\n]+/.test(source.slice(offset))) return source;
  const boundary = source.slice(offset).search(/\r?\n[ \t]*\r?\n/);
  const end = boundary < 0 ? source.length : offset + boundary + (source.slice(offset + boundary).startsWith('\r\n') ? 2 : 1);
  return source.slice(0, offset) + source.slice(offset, end).replace(/<!-- taelgar:pronunciation -->\r?\n[\s\S]*?<!-- \/taelgar:pronunciation -->\r?\n?/g, '') + source.slice(end);
}

// A small owned block survives as an ordinary native audio embed without the plugin.
// Only the first heading in the leading header is eligible, never headings in prose/fences.
export function linkPronunciation(source, audioPath) {
  const clean = stripPronunciationLink(source);
  if (!audioPath) return clean;
  if (!/^assets\/pronunciation\/[^\r\n\[\]|]+\.(?:mp3|wav)$/.test(audioPath)) throw new Error('Invalid pronunciation audio path');
  const offset = headerOffset(clean);
  const heading = /^# [^\r\n]+(?:\r?\n|$)/.exec(clean.slice(offset));
  if (!heading) return clean;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const end = offset + heading[0].length;
  const block = [LINK_START, ...(audioPath.endsWith('.mock.wav') ? ['*Prototype test tone — not speech.*'] : []), '![[' + audioPath + ']]', LINK_END, ''].join(newline);
  return clean.slice(0, end).replace(/([^\n])$/, '$1' + newline) + block + clean.slice(end);
}

const xml = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
export function synthesisInput(metadata, fallback, defaults = {}) {
  const name = typeof metadata.name === 'string' && metadata.name.trim() || fallback;
  const ipa = typeof metadata.pronunciationIPA === 'string' ? metadata.pronunciationIPA.trim().replace(/^\/|\/$/g, '') : '';
  const locale = metadata.pronunciationLocale || defaults.locale || 'en-US';
  const voice = metadata.pronunciationVoice || defaults.voice || 'en-US-JennyNeural';
  if (!/^[a-z]{2,3}-[A-Za-z0-9-]+$/.test(locale) || typeof voice !== 'string' || !voice.trim()) throw new Error('Invalid speech locale or voice');
  return {name, ipa, locale, voice, ssml: '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + xml(locale) + '"><voice name="' + xml(voice) + '"><phoneme alphabet="ipa" ph="' + xml(ipa) + '">' + xml(name) + '</phoneme></voice></speak>'};
}

// Intentionally a recognizable two-note tone, never presented as synthesized speech.
export function mockWav() {
  const rate = 24000, count = rate * 0.6;
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const ascii = (at, value) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate, local = t % 0.3;
    const envelope = Math.min(1, local / 0.02, (0.3 - local) / 0.04);
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * (t < 0.3 ? 440 : 660) * t) * Math.max(0, envelope) * 4000, true);
  }
  return bytes.buffer;
}

export function validateWav(buffer) {
  const bytes = new Uint8Array(buffer);
  const text = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 44 || text(0, 4) !== 'RIFF' || text(8, 12) !== 'WAVE') throw new Error('Speech service did not return a WAV file');
  return buffer;
}
