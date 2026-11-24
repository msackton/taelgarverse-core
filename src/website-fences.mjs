import {campaignFences} from './campaign-blocks.mjs';

const nativeFences=new Set(['mermaid','taelgar-events','taelgar-index','taelgar-interactions','taelgar-map',...Object.values(campaignFences)]);
const codeLanguages=new Set([
  '', 'text', 'plaintext', 'txt', 'markdown', 'md', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'csv', 'ini', 'diff',
  'bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'sql',
  'javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'python', 'py', 'ruby', 'rb', 'perl', 'php', 'lua',
  'c', 'cpp', 'csharp', 'cs', 'java', 'kotlin', 'go', 'rust', 'swift', 'r',
]);

export function isWebsiteFence(language) {
  return nativeFences.has(language) || codeLanguages.has(language);
}
