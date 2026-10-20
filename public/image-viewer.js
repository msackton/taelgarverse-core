// Enhance ordinary article images without changing their layout or authored links.
const viewer = document.createElement('dialog');
const images = [...document.querySelectorAll('.article-main img[src]')].filter(image =>
  !image.closest('a,button,dialog,[popover],.twemoji,[role="button"],.leaflet-map,.leaflet-container'));

if (typeof viewer.showModal === 'function' && images.length) {
  viewer.className = 'image-viewer';
  viewer.setAttribute('aria-label', 'Image viewer');
  const toolbar = document.createElement('div');
  toolbar.className = 'image-viewer-toolbar';
  const original = document.createElement('a');
  original.textContent = 'Open image';
  original.target = '_blank';
  original.rel = 'noopener';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.autofocus = true;
  const preview = document.createElement('img');
  preview.className = 'image-viewer-preview';
  const caption = document.createElement('p');
  caption.className = 'image-viewer-caption';
  toolbar.append(original, close);
  viewer.append(toolbar, preview, caption);
  document.body.append(viewer);
  let opener;

  function open(image) {
    opener = image;
    preview.src = image.currentSrc || image.src;
    preview.alt = image.alt;
    original.href = preview.src;
    caption.textContent = image.alt;
    caption.hidden = !image.alt;
    viewer.showModal();
    document.documentElement.classList.add('image-viewer-open');
  }
  close.addEventListener('click', () => viewer.close());
  viewer.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    if (!event.shiftKey && document.activeElement === close) {
      event.preventDefault(); original.focus();
    } else if (event.shiftKey && document.activeElement === original) {
      event.preventDefault(); close.focus();
    }
  });
  viewer.addEventListener('close', () => {
    document.documentElement.classList.remove('image-viewer-open');
    preview.removeAttribute('src');
    opener?.focus({preventScroll: true});
  });
  const outside = event => {
    const rect = viewer.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };
  let startedOutside = false;
  viewer.addEventListener('pointerdown', event => { startedOutside = outside(event); });
  viewer.addEventListener('click', event => {
    if (event.target === viewer && startedOutside && outside(event)) viewer.close();
  });

  for (const image of images) {
    image.classList.add('image-enlarge');
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-haspopup', 'dialog');
    image.setAttribute('aria-label', image.alt ? 'Enlarge image: ' + image.alt : 'Enlarge image');
    image.addEventListener('click', () => open(image));
    image.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) open(image);
      }
    });
  }
}
