// Independent of the app module so even a missing module has a recoverable screen.
(() => {
  const screen = document.querySelector('#launch-screen');
  const app = document.querySelector('#app');
  const status = document.querySelector('#launch-status');
  const retry = document.querySelector('#launch-retry');
  const controller = new AbortController();
  let failed = false;
  function showError() {
    if (failed) return;
    failed = true;
    controller.abort();
    app.replaceChildren();
    app.setAttribute('aria-busy', 'false');
    screen.classList.add('has-error');
    status.textContent = 'Your beauty shelf couldn’t open. Please try again. Your saved choices are still on this device.';
    retry.hidden = false;
  }
  // A hung asset should never leave a permanent loading screen.
  const timeout = setTimeout(showError, 15000);
  retry.addEventListener('click', () => window.location.reload());

  async function start() {
    try {
      const { initializeApp } = await import('./app.js');
      if (failed) return;
      await initializeApp({ signal: controller.signal });
      if (failed) return;
      clearTimeout(timeout);
      app.removeAttribute('inert');
      app.setAttribute('aria-busy', 'false');
      // Ready immediately; only the visual handoff animates, never the startup work.
      screen.setAttribute('aria-hidden', 'true');
      screen.style.pointerEvents = 'none';
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        screen.remove();
      } else {
        const exit = screen.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 240, easing: 'ease-out', fill: 'forwards'
        });
        exit.finished.then(() => screen.remove(), () => screen.remove());
      }
    } catch (error) {
      clearTimeout(timeout);
      console.error('Dewdrop could not start.', error);
      showError();
    }
  }
  start();
})();
