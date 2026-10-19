import {escapeHtml} from './common.mjs';

function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
}

export function releaseFooter({core = {},content = {},local = false} = {}) {
  const published = timestamp(content.publishedAt);
  const updated = published ? '<span title="' + escapeHtml('Content published ' + published.toISOString()) + '">Updated <time datetime="' +
    published.toISOString() + '">' + published.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) + '</time></span>' :
    '<span>' + (local ? 'Local preview' : 'Update date unavailable') + '</span>';
  const version = (label,release) => {
    if (!/^[a-f0-9]{40,64}$/.test(release.commit || '')) return '<span>' + label + ' unavailable</span>';
    const date = timestamp(release.publishedAt);
    const details = label + ' ' + release.commit + (release.dirty ? ' (uncommitted changes)' : '') +
      (date ? '\nPublished ' + date.toISOString() : '') + '\nClick to copy full commit ID';
    return '<button type="button" class="release-commit" data-copy-commit="' + release.commit + '" title="' + escapeHtml(details) +
      '" aria-label="' + escapeHtml(details) + '">' + label + ' <code>' + release.commit.slice(0,7) +
      (release.dirty ? '*' : '') + '</code></button>';
  };
  return '<footer class="site-footer" aria-label="Site version">' + [updated,version('Core',core),version('Content',content)].join('<span aria-hidden="true">·</span>') +
    '<span class="release-status" role="status"></span></footer>';
}
