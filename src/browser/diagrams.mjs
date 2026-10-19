import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  theme: 'neutral',
  layout: 'dagre',
  fontFamily: 'system-ui, sans-serif',
  htmlLabels: false,
  flowchart: {htmlLabels: false},
});

// Render individually so a malformed diagram never prevents the next one.
for (const [index, figure] of [...document.querySelectorAll('.mermaid-diagram')].entries()) {
  const output = figure.querySelector('.mermaid-output');
  const source = figure.querySelector('.mermaid-source');
  output.setAttribute('aria-busy', 'true');
  try {
    const {svg} = await mermaid.render('taelgar-diagram-' + index, source.querySelector('code').textContent);
    output.innerHTML = svg;
    const drawing = output.querySelector('svg');
    // Keep text readable; the surrounding region scrolls on narrow screens.
    drawing.style.maxWidth = 'none';
    drawing.setAttribute('width', drawing.viewBox.baseVal.width);
    drawing.setAttribute('role', 'img');
    if (!drawing.hasAttribute('aria-labelledby')) drawing.setAttribute('aria-label', 'Diagram');
    if (output.scrollWidth > output.clientWidth) {
      const firstNode = drawing.querySelector('.node');
      const node = firstNode?.getBoundingClientRect(), region = output.getBoundingClientRect();
      output.scrollLeft = node ? node.left - region.left + node.width / 2 - output.clientWidth / 2 :
        (output.scrollWidth - output.clientWidth) / 2;
    }
    source.open = false;
  } catch {
    output.textContent = 'This diagram could not be rendered. Its source is shown below.';
    output.classList.add('mermaid-error');
    source.open = true;
  } finally {
    output.removeAttribute('aria-busy');
  }
}
