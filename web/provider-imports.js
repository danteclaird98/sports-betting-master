// Manual observations stay separate from normalized quotes and wager records.
(() => {
  const form = document.querySelector('#provider-import-form');
  if (!form) return;
  const format = document.querySelector('#observation-format');
  const draft = document.querySelector('#observation-payload');
  const feedback = document.querySelector('#observation-feedback');
  const receipt = document.querySelector('#observation-receipt');
  const summary = document.querySelector('#observation-summary');
  const reload = document.querySelector('#reload-provider-imports');
  let requestId = '';
  let busy = false;
  let summaryGeneration = 0;

  async function request(body) {
    const response = await fetch('/api/provider-imports', {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Import request failed');
    return data;
  }

  function controls(disabled) {
    for (const input of form.elements) input.disabled = disabled;
    reload.disabled = disabled;
  }

  async function load() {
    const generation = ++summaryGeneration;
    try {
      const data = await request();
      if (generation !== summaryGeneration) return;
      summary.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
      if (generation !== summaryGeneration) return;
      feedback.textContent = 'Saved observations could not be loaded: ' + error.message;
    }
  }

  form.addEventListener('input', () => {
    requestId = '';
    receipt.textContent = '';
    feedback.textContent = '';
  });
  reload.addEventListener('click', () => void load());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    let payload;
    try {
      payload = JSON.parse(draft.value);
    } catch {
      feedback.textContent = 'Enter valid JSON before saving.';
      return;
    }
    requestId ||= crypto.randomUUID();
    summaryGeneration++;
    busy = true;
    controls(true);
    feedback.textContent = '';
    try {
      const saved = await request({ request_id: requestId, format: format.value, payload });
      receipt.textContent = JSON.stringify(saved, null, 2);
      feedback.textContent = 'Saved as unverified observations. The market board and wager journal are unchanged.';
      await load();
    } catch (error) {
      feedback.textContent = 'Save not confirmed: ' + error.message +
        '. Reload saved imports or retry this unchanged request before starting another import.';
    } finally {
      busy = false;
      controls(false);
    }
  });
})();
