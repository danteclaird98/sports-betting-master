/* Transport only: identity and original application sessions stay server-side. */
(() => {
  const rawBase = window.__PREVIEW_API_BASE__;
  const appRoot = new URL(window.__PREVIEW_ROOT__ || './', document.baseURI);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!rawBase || rawBase.includes('__PORT_') && !local) {
    document.body.textContent = 'Preview backend was not connected. Please reopen the app.';
    throw Error('Unresolved preview backend');
  }
  const base = rawBase.includes('__PORT_') ? 'http://127.0.0.1:8080/' : new URL(rawBase.replace(/\/?$/, '/'), appRoot).href;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && /^\/(api\/|edgeboard-api\/|tools\/|session(?:$|\?)|example\.json(?:$|\?))/.test(input))
      return nativeFetch(new URL(input.slice(1), base).href, {...init, credentials: 'same-origin'});
    return nativeFetch(input, init);
  };
  // React can render its navigation after DOMContentLoaded.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a');
    const href = anchor?.getAttribute('href');
    if (href === '/' || href === '/edgeboard/') {
      event.preventDefault();
      location.assign(new URL(href === '/' ? 'index.html' : 'edgeboard/index.html', appRoot).href);
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href="/"]').forEach(a => { a.href = new URL('index.html', appRoot).href; });
    document.querySelectorAll('a[href="/edgeboard/"]').forEach(a => { a.href = new URL('edgeboard/index.html', appRoot).href; });
    document.querySelectorAll('a[href="/example.json"]').forEach(a => { a.href = new URL('example.json', base).href; });
    const footer = document.querySelector('.aside-footer');
    if (footer) {
      footer.textContent = 'Private preview · Temporary storage';
      const small = document.createElement('small');
      small.textContent = 'Export important records. No live provider keys configured.';
      footer.append(document.createElement('br'), small);
    }
  });
})();
