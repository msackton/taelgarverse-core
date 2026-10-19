for (const form of document.querySelectorAll('[data-context-form]')) {
  const select = form.querySelector('[name="context"]');
  const controls = form.querySelector('[data-custom-date]');
  const date = form.querySelector('[name="date"]');
  const picker = form.querySelector('[data-campaign-picker]');
  const all = form.querySelector('[data-campaign-all]');
  const choices = [...form.querySelectorAll('[data-campaign-choice]')];
  function summarize() {
    const selected = choices.filter(choice=>choice.checked);
    all.checked = choices.length > 0 && selected.length === choices.length;
    all.indeterminate = selected.length > 0 && !all.checked;
    picker.querySelector('[data-campaign-summary]').textContent = all.checked ? 'All campaigns' :
      selected.length === 0 ? 'No campaigns' : selected.length === 1 ? selected[0].closest('label').textContent.trim() : selected.length + ' campaigns';
  }
  function update() {
    const custom = select.value === 'custom';
    controls.hidden = !custom;
    date.disabled = !custom;
    date.required = custom;
    picker.querySelectorAll('input').forEach(input=>input.disabled=!custom);
    if (!custom) picker.open = false;
  }
  // Browsers may restore form state after navigating back.
  update();
  summarize();
  all.addEventListener('change',()=>{
    choices.forEach(choice=>choice.checked=all.checked);
    summarize();
  });
  choices.forEach(choice=>choice.addEventListener('change',summarize));
  document.addEventListener('click',event=>{ if (!picker.contains(event.target)) picker.open = false; });
  picker.addEventListener('keydown',event=>{
    if (event.key==='Escape' && picker.open) {
      picker.open = false; picker.querySelector('summary').focus(); event.preventDefault();
    }
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    params.delete('campaigns');
    if (select.value==='custom') params.set('campaigns',all.checked ? 'all' : choices.filter(choice=>choice.checked).map(choice=>choice.value).join(','));
    location.assign(location.pathname+'?'+params);
  });
  form.querySelector('[name="dm"]').addEventListener('change',() => form.requestSubmit());
  select.addEventListener('change',() => {
    update();
    if (select.value === 'custom') date.focus();
    else form.requestSubmit();
  });
}
