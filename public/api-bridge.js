(function installSameOriginApiBridge() {
  function proxyApiCall(action, params = {}) {
    const isWrite = String(action).toLowerCase() === 'updateevent';
    const url = new URL('/api/', window.location.origin);
    const options = {
      method: isWrite ? 'POST' : 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {'Accept': 'application/json'}
    };

    if (isWrite) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({api: action, ...params});
    } else {
      url.searchParams.set('api', action);
      url.searchParams.set('_', String(Date.now()));
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      });
    }

    return fetch(url.toString(), options).then(async response => {
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error('O backend respondeu em formato inesperado.');
      }
      if (!response.ok) {
        throw new Error(payload && payload.error ? payload.error : `Erro HTTP ${response.status}.`);
      }
      if (payload && payload.ok) return payload.data;
      throw new Error(payload && payload.error ? payload.error : 'Erro desconhecido no backend.');
    });
  }

  window.apiCall = proxyApiCall;
  try { apiCall = proxyApiCall; } catch (error) {}

  if (typeof loadData === 'function' && typeof initialProfileSlug === 'function') {
    loadData(initialProfileSlug());
  }
})();
