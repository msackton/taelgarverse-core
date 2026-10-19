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

function button(label) {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = label;
  return control;
}

function popup(title, name) {
  const dialog = document.createElement('dialog');
  if (typeof dialog.showModal !== 'function') return null;
  dialog.className = 'diagram-popup';
  const heading = document.createElement('h2');
  heading.id = 'diagram-popup-' + name;
  heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = document.createElement('div');
  header.className = 'diagram-popup-header';
  const close = button('Close');
  close.autofocus = true;
  header.append(heading, close);
  const content = document.createElement('div');
  content.className = 'diagram-popup-content';
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', title);
  dialog.append(header, content);
  document.body.append(dialog);
  let opener, revision = 0, startedOutside = false;
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    revision++;
    content.replaceChildren();
    document.documentElement.classList.remove('diagram-popup-open');
    opener?.focus({preventScroll: true});
  });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled),[tabindex="0"]')];
    if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault(); controls[0].focus();
    } else if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault(); controls.at(-1).focus();
    }
  });
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener('pointerdown', event => { startedOutside = outside(event); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog && startedOutside && outside(event)) dialog.close();
  });
  return {
    header, close, content,
    open(control) {
      opener = control;
      dialog.showModal();
      content.scrollTop = 0;
      content.scrollLeft = 0;
      document.documentElement.classList.add('diagram-popup-open');
      return ++revision;
    },
    current: token => dialog.open && revision === token,
  };
}

function describe(drawing) {
  drawing.style.removeProperty('max-width');
  drawing.setAttribute('width', drawing.viewBox.baseVal.width);
  drawing.setAttribute('height', drawing.viewBox.baseVal.height);
  drawing.setAttribute('role', 'img');
  if (!drawing.hasAttribute('aria-labelledby')) drawing.setAttribute('aria-label', 'Diagram');
}

function centerFirstNode(content) {
  const firstNode = content.querySelector('svg .node');
  content.scrollTop = 0;
  if (firstNode && content.scrollWidth > content.clientWidth) {
    const node = firstNode.getBoundingClientRect(), region = content.getBoundingClientRect();
    content.scrollLeft += node.left - region.left + node.width / 2 - content.clientWidth / 2;
  } else content.scrollLeft = 0;
}

const larger = popup('Larger diagram', 'larger');
const sourcePopup = popup('Diagram source', 'source');
let popupId = 0;
const fit = button('Fit to window');
if (larger) {
  larger.header.insertBefore(fit, larger.close);
  fit.addEventListener('click', () => {
    const fitted = larger.content.classList.toggle('diagram-popup-content--fit');
    fit.textContent = fitted ? 'Actual size' : 'Fit to window';
    if (!fitted) centerFirstNode(larger.content);
  });
}

// Render individually so a malformed diagram never prevents the next one.
for (const [index, figure] of [...document.querySelectorAll('.mermaid-diagram')].entries()) {
  const output = figure.querySelector('.mermaid-output');
  const source = figure.querySelector('.mermaid-source');
  const definition = source.querySelector('code').textContent;
  let bigger;
  if (larger && sourcePopup) {
    const actions = document.createElement('div');
    actions.className = 'diagram-actions';
    bigger = button('See bigger');
    bigger.disabled = true;
    bigger.setAttribute('aria-haspopup', 'dialog');
    const seeSource = button('See source');
    seeSource.setAttribute('aria-haspopup', 'dialog');
    actions.append(bigger, seeSource);
    output.after(actions);
    source.hidden = true;
    seeSource.addEventListener('click', () => {
      const pre = document.createElement('pre'), code = document.createElement('code');
      code.textContent = definition;
      pre.append(code);
      sourcePopup.content.replaceChildren(pre);
      sourcePopup.open(seeSource);
    });
    bigger.addEventListener('click', async () => {
      larger.content.classList.remove('diagram-popup-content--fit');
      larger.content.textContent = 'Loading diagram…';
      fit.textContent = 'Fit to window';
      fit.disabled = true;
      const token = larger.open(bigger);
      try {
        // A fresh render gives the popup its own SVG IDs and marker references.
        const {svg} = await mermaid.render('taelgar-diagram-popup-' + popupId++, definition);
        if (!larger.current(token)) return;
        larger.content.innerHTML = svg;
        const drawing = larger.content.querySelector('svg');
        describe(drawing);
        fit.disabled = false;
        centerFirstNode(larger.content);
      } catch {
        if (larger.current(token)) larger.content.textContent = 'This diagram could not be enlarged.';
      }
    });
  }
  output.setAttribute('aria-busy', 'true');
  try {
    const {svg} = await mermaid.render('taelgar-diagram-' + index, definition);
    output.innerHTML = svg;
    describe(output.querySelector('svg'));
    if (bigger) bigger.disabled = false;
    source.open = false;
  } catch {
    output.textContent = 'This diagram could not be rendered. ' +
      (source.hidden ? 'Use See source to inspect its definition.' : 'Its source is shown below.');
    output.classList.add('mermaid-error');
    source.open = true;
  } finally {
    output.removeAttribute('aria-busy');
  }
}
