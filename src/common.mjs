export class RenderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function dateKey(value, partial = false) {
  const text = String(value);
  const pattern = partial ? /^[0-9]{1,4}(?:-[0-9]{1,2})?(?:-[0-9]{1,2})?$/ : /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
  if (!pattern.test(text)) throw new RenderError(400, 'date must be YYYY-MM-DD in the Taelgar DR calendar');
  const [year, month = 1, day = 1] = text.split('-').map(Number);
  const days = [31,28,31,30,31,30,31,31,30,31,30,31];
  if (!(year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1])) {
    throw new RenderError(400, 'date is not a valid Taelgar DR date (no leap days)');
  }
  return year * 10000 + month * 100 + day;
}
export function validateDate(value) { dateKey(value); return value; }
export function parseDM(value) {
  if (value === undefined || value === null || value === false || value === 'false' || value === '0') return false;
  if (value === true || value === 'true' || value === '1') return true;
  throw new RenderError(400, 'dm must be 1, 0, true, or false');
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const slugify = value => String(value).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'untitled';
export function targetPath(relative) {
  const parts = relative.split('/');
  const name = parts.pop();
  const dot = name.indexOf('.', 1);
  return [...parts.map(slugify), slugify(dot < 0 ? name : name.slice(0, dot)) + (dot < 0 ? '' : name.slice(dot).toLowerCase())].join('/');
}
const lowerWords = new Set('a an the and but or for nor as at by from in into near of on onto to with de about'.split(' '));
export function titleCase(value) {
  return String(value).split(/\s+/).map((word, i) => {
    const stripped = word.replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase();
    if (stripped === 'dr') return word.toUpperCase();
    if (i && lowerWords.has(stripped)) return word.toLowerCase();
    return word.replace(/\p{L}/u, c => c.toUpperCase());
  }).join(' ');
}
export const pageUrl = (slug, date, context) => '/page/' + slug.split('/').map(encodeURIComponent).join('/') +
  (context && context.kind !== 'custom' ? '?context=' + encodeURIComponent(context.id) : '?date=' + encodeURIComponent(date)) +
  (context?.dm ? '&dm=1' : '');
