(() => {
  document.querySelectorAll('.pronunciation-control').forEach(control => {
    const button = control.querySelector('[data-pronunciation-play]'), audio = control.querySelector('audio');
    if (!button || !audio) return;
    button.hidden = false; audio.hidden = true;
    button.addEventListener('click', async () => {
      button.disabled = true;
      control.querySelector('[data-pronunciation-status]').textContent = '';
      try { audio.currentTime = 0; await audio.play(); }
      catch { audio.hidden = false; control.querySelector('[data-pronunciation-status]').textContent = 'Playback failed. Try the audio controls.'; }
      finally { button.disabled = false; }
    });
  });
})();
