for (const form of document.querySelectorAll('[data-context-form]')) {
  const select = form.querySelector('[name="context"]');
  const controls = form.querySelector('[data-custom-date]');
  const date = form.querySelector('[name="date"]');
  function update() {
    const custom = select.value === 'custom';
    controls.hidden = !custom;
    date.disabled = !custom;
    date.required = custom;
  }
  // Browsers may restore form state after navigating back.
  update();
  form.querySelector('[name="dm"]').addEventListener('change',() => form.requestSubmit());
  select.addEventListener('change',() => {
    update();
    if (select.value === 'custom') date.focus();
    else form.requestSubmit();
  });
}
