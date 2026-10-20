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
    document.documentElement.classList.toggle('diagram-popup-open', !!document.querySelector('.diagram-popup[open]'));
    opener?.focus({preventScroll: true});
  });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')]
      .filter(control => control.getClientRects().length);
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
    dialog, heading, header, close, content,
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
let enlargedFigure;
const sourcePopup = popup('Diagram source', 'source');
const preview = popup('Page preview', 'page');
let previewRequest, previewId = 0;
const openPage = document.createElement('a');
openPage.textContent = 'Open page';
if (preview) {
  preview.dialog.classList.add('diagram-page-preview');
  preview.header.insertBefore(openPage, preview.close);
  preview.dialog.addEventListener('close', () => previewRequest?.abort());
}

async function previewPage(control, link) {
  previewRequest?.abort();
  previewRequest = new AbortController();
  preview.heading.textContent = link.title;
  openPage.href = link.href;
  preview.content.innerHTML = '<p role="status">Loading page…</p>';
  const token = preview.open(control);
  try {
    const destination = new URL(link.href, location.href);
    const query = new URLSearchParams(destination.search);
    query.set('page', link.page);
    const response = await fetch('/api/page?' + query, {
      signal: AbortSignal.any([previewRequest.signal, AbortSignal.timeout(10000)]),
    });
    if (!response.ok) throw new Error('Preview unavailable');
    const result = await response.json();
    if (!preview.current(token)) return;
    const article = document.createElement('article');
    article.className = 'md-typeset';
    article.innerHTML = result.html;
    article.querySelectorAll('script').forEach(script => script.remove());
    article.querySelectorAll('.mermaid-diagram').forEach(figure => {
      const paragraph = document.createElement('p'), link = document.createElement('a');
      link.href = destination.href;
      link.textContent = 'Open page to view the diagram.';
      paragraph.append(link);
      figure.replaceWith(paragraph);
    });
    // Keep preview footnotes, headings and comment popovers separate from the
    // article underneath, including when the diagram links back to its own page.
    const prefix = 'diagram-preview-' + previewId++ + '-', ids = new Map();
    article.querySelectorAll('[id]').forEach(element => {
      ids.set(element.id, prefix + element.id);
      element.id = prefix + element.id;
    });
    article.querySelectorAll('a[href^="#"]').forEach(anchor => {
      const id = anchor.getAttribute('href').slice(1);
      anchor.setAttribute('href', ids.has(id) ? '#' + ids.get(id) : destination.href.split('#')[0] + '#' + id);
    });
    for (const attribute of ['popovertarget', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'for']) {
      article.querySelectorAll('[' + attribute + ']').forEach(element => {
        element.setAttribute(attribute, element.getAttribute(attribute).split(/\s+/).map(id => ids.get(id) || id).join(' '));
      });
    }
    preview.content.replaceChildren(article);
    if (destination.hash) {
      let id;
      try { id = ids.get(decodeURIComponent(destination.hash.slice(1))); } catch {}
      if (id) document.getElementById(id)?.scrollIntoView({block: 'start'});
    }
  } catch {
    if (preview.current(token)) preview.content.textContent = 'This preview could not be loaded. Use Open page to continue.';
  }
}

async function diagramVertices(definition) {
  // Read the pinned flowchart parser's data; never bind authored callbacks.
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(definition);
  const vertices = diagram.db.getVertices?.();
  return vertices instanceof Map ? [...vertices.values()]
    .filter(vertex => vertex.link || vertex.classes?.includes('internal-link'))
    .map(vertex => {
      // SVG line wrapping can remove spaces between tspans. Resolve the parsed
      // label instead, decoding entities in an inert fragment.
      const label = document.createElement('template');
      label.innerHTML = (vertex.text || vertex.id).replace(/<br\s*\/?>/gi, ' ');
      return {id: vertex.id, domId: vertex.domId, label: label.content.textContent.replace(/\s+/g, ' ').trim(),
        target: vertex.link, window: vertex.linkTarget};
    }) : [];
}

function diagramNode(drawing, vertex) {
  return [...drawing.querySelectorAll('.node')].find(node => node.id === vertex.domId ||
    node.id.endsWith('-' + vertex.domId) || node.getAttribute('data-id') === vertex.id);
}

function clearDiagramLinks(drawing) {
  drawing.querySelectorAll('a').forEach(anchor => anchor.replaceWith(...anchor.childNodes));
  drawing.querySelectorAll('.node.clickable').forEach(node => node.classList.remove('clickable'));
}

function attachDiagramLinks(drawing, links, previews) {
  clearDiagramLinks(drawing);
  for (const {vertex, link} of links) {
    const node = diagramNode(drawing, vertex);
    if (!node || !link) continue;
    const anchor = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    anchor.setAttribute('href', link.href);
    anchor.setAttribute('tabindex', '0');
    anchor.setAttribute('role', 'link');
    anchor.setAttribute('aria-label', link.title || vertex.label);
    if (vertex.window === '_blank') {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
    if (link.page && preview && vertex.window !== '_blank') {
      const update = () => {
        if (previews.checked) anchor.setAttribute('aria-haspopup', 'dialog');
        else anchor.removeAttribute('aria-haspopup');
      };
      update();
      anchor.dataset.previewDiagram = previews.dataset.diagram;
      anchor.addEventListener('click', event => {
        if (!previews.checked || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        previewPage(anchor, link);
      });
    }
    anchor.append(...node.childNodes);
    node.append(anchor);
    node.classList.add('diagram-linked-node');
  }
  if (links.some(item => item.link)) drawing.setAttribute('role', 'group');
}

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
  let bigger, actions, vertices, resolvedLinks = [];
  const previews = document.createElement('input');
  previews.type = 'checkbox';
  previews.checked = true;
  previews.dataset.diagram = String(index);
  previews.addEventListener('change', () => {
    document.querySelectorAll('a[data-preview-diagram="' + index + '"]').forEach(anchor => {
      if (previews.checked) anchor.setAttribute('aria-haspopup', 'dialog');
      else anchor.removeAttribute('aria-haspopup');
    });
  });
  if (larger && sourcePopup) {
    actions = document.createElement('div');
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
      enlargedFigure = figure;
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
        attachDiagramLinks(drawing, resolvedLinks, previews);
        fit.disabled = false;
        centerFirstNode(larger.content);
      } catch {
        if (larger.current(token)) larger.content.textContent = 'This diagram could not be enlarged.';
      }
    });
  }
  output.setAttribute('aria-busy', 'true');
  try {
    vertices = await diagramVertices(definition);
    const {svg} = await mermaid.render('taelgar-diagram-' + index, definition);
    output.innerHTML = svg;
    const drawing = output.querySelector('svg');
    describe(drawing);
    clearDiagramLinks(drawing);
    if (bigger) bigger.disabled = false;
    source.open = false;
    if (vertices.length) {
      const targets = vertices.map(vertex => vertex.target || vertex.label);
      const retry = button('Retry links');
      const loadLinks = async () => {
        retry.disabled = true;
        try {
          const links = [];
          for (let start = 0; start < targets.length; start += 50) {
            const url = new URL(figure.dataset.linksUrl, location.href);
            targets.slice(start, start + 50).forEach(target => url.searchParams.append('target', target));
            const response = await fetch(url, {signal: AbortSignal.timeout(10000)});
            if (!response.ok) throw new Error('Links unavailable');
            links.push(...(await response.json()).links);
          }
          resolvedLinks = vertices.map((vertex, i) => ({vertex, link: links[i]}));
          attachDiagramLinks(drawing, resolvedLinks, previews);
          const enlarged = larger?.content.querySelector('svg');
          if (enlargedFigure === figure && enlarged) attachDiagramLinks(enlarged, resolvedLinks, previews);
          retry.remove();
          if (preview && links.some(link => link?.page) && actions && !previews.isConnected) {
            const label = document.createElement('label');
            label.className = 'diagram-preview-toggle';
            label.append(previews, ' Preview linked pages');
            actions.append(label);
          }
        } catch {
          retry.disabled = false;
          (actions || figure).append(retry);
        }
      };
      retry.addEventListener('click', loadLinks);
      await loadLinks();
    }
  } catch {
    output.textContent = 'This diagram could not be rendered. ' +
      (source.hidden ? 'Use See source to inspect its definition.' : 'Its source is shown below.');
    output.classList.add('mermaid-error');
    source.open = true;
  } finally {
    output.removeAttribute('aria-busy');
  }
}
