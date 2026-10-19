document.addEventListener('click',async event => {
  const button = event.target.closest('[data-copy-commit]');
  if (!button) return;
  const status = button.closest('.site-footer').querySelector('[role="status"]');
  try {
    await navigator.clipboard.writeText(button.dataset.copyCommit);
    status.textContent = 'Commit copied';
  } catch {
    status.textContent = 'Could not copy; the full commit ID is in the tooltip.';
  }
});
