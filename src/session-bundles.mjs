// Keep the folder grammar in sync with the vault's _scripts/session_bundles.py.
const numberedBundle = /^[a-z0-9]+(?:-[a-z0-9]+)*-([0-9]{3}|[1-9][0-9]{3,})(\.[0-9]+)?$/;

export function sessionNumber(value) {
  const match = /^([0-9]+)(\.[0-9]+)?$/.exec(String(value));
  return match ? match[1].replace(/^0+(?=[0-9])/, '') + (match[2] ?? '') : null;
}

export function indexSessionBundles(registry, listFolders) {
  const byPath = new Map(), bySession = new Map();
  for (const [campaign, {sessionBundleDirectory: directory}] of Object.entries(registry.campaigns)) {
    if (!directory) continue;
    for (const name of listFolders(directory)) {
      const suffix = numberedBundle.exec(name);
      if (!suffix) continue;
      const number = sessionNumber(suffix[1] + (suffix[2] ?? ''));
      const path = directory + '/' + name, key = campaign + ':' + number;
      const other = bySession.get(key);
      if (other) throw new Error('Duplicate bundles for session ' + key + ': ' + other + ', ' + path);
      byPath.set(path, {campaign, number});
      bySession.set(key, path);
    }
  }
  return {
    entries: () => byPath.entries(),
    identify: path => byPath.get(path) ?? null,
  };
}

export function bundleArtifactIdentity(bundles, artifactPath) {
  const parts = artifactPath.split('/');
  return parts.at(-2) === 'cleaned' ? bundles.identify(parts.slice(0, -2).join('/')) : null;
}
