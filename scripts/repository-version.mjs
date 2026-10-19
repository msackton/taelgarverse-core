import {execFileSync} from 'node:child_process';

// This runs only on the build machine or in the local Node preview.
export function repositoryVersion(directory) {
  const git = args => execFileSync('git', ['-C', directory, ...args],
    {encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  try {
    return {commit:git(['rev-parse','HEAD']),dirty:Boolean(git(['status','--porcelain','--untracked-files=normal']))};
  } catch { return {}; } // Source archives and preview fixtures may have no Git checkout.
}
