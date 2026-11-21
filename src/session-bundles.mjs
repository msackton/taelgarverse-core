// Keep the folder grammar in sync with the vault's _scripts/session_bundles.py.
const numberedBundle = /^[a-z0-9]+(?:-[a-z0-9]+)*-([0-9]{3}|[1-9][0-9]{3,})(\.[0-9]+)?$/;

export function sessionNumber(value) {
  const match = /^([0-9]+)(\.[0-9]+)?$/.exec(String(value));
  return match ? match[1].replace(/^0+(?=[0-9])/, '') + (match[2] ?? '') : null;
}

export function bundleArtifactIdentity(registry, artifactPath) {
  const parts = artifactPath.split('/');
  if (parts.at(-2) !== 'cleaned') return null;
  const suffix = numberedBundle.exec(parts.at(-3) ?? '');
  if (!suffix) return null;
  const directory = parts.slice(0, -3).join('/');
  for (const [campaign, entry] of Object.entries(registry.campaigns)) {
    if (entry.sessionBundleDirectory === directory) {
      return {campaign, number: sessionNumber(suffix[1] + (suffix[2] ?? ''))};
    }
  }
  return null;
}
