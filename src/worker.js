const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbxNF3rJVZxIXbJsKnYEdjmQ_D8cJ2ERDrW68eLeB9GM9wUXpUvq_5elIeVLBIQ32A4/exec';
const ALLOWED_ACTIONS = new Set(['ping', 'getprofiles', 'getappdata', 'updateevent']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return proxyAppsScript(request, url);
    }

    return env.ASSETS.fetch(request);
  }
};

async function proxyAppsScript(request, incomingUrl) {
  try {
    let action = '';
    let upstream;

    if (request.method === 'POST') {
      const bodyText = await request.text();
      let body;
      try {
        body = JSON.parse(bodyText || '{}');
      } catch (error) {
        return jsonResponse({ok: false, error: 'Requisição inválida.'}, 400);
      }

      action = String(body.api || body.action || '').toLowerCase();
      if (!ALLOWED_ACTIONS.has(action)) {
        return jsonResponse({ok: false, error: 'Ação não permitida.'}, 400);
      }

      upstream = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(body),
        redirect: 'follow'
      });
    } else if (request.method === 'GET') {
      action = String(incomingUrl.searchParams.get('api') || incomingUrl.searchParams.get('action') || '').toLowerCase();
      if (!ALLOWED_ACTIONS.has(action)) {
        return jsonResponse({ok: false, error: 'Ação não permitida.'}, 400);
      }

      const target = new URL(BACKEND_URL);
      incomingUrl.searchParams.forEach((value, key) => {
        if (key !== 'callback' && key !== '_') target.searchParams.set(key, value);
      });
      target.searchParams.set('api', incomingUrl.searchParams.get('api') || incomingUrl.searchParams.get('action') || '');

      upstream = await fetch(target.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 RIW-Agenda-Proxy/1.0'
        },
        redirect: 'follow'
      });
    } else {
      return jsonResponse({ok: false, error: 'Método não permitido.'}, 405);
    }

    const text = await upstream.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: 'O Google Apps Script respondeu em formato inesperado.',
        status: upstream.status,
        contentType: upstream.headers.get('content-type') || '',
        finalUrl: upstream.url || '',
        preview: text.slice(0, 500)
      }, 502);
    }

    return jsonResponse(payload, upstream.ok ? 200 : 502);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: 'Não foi possível acessar o Google Apps Script.',
      detail: error && error.message ? error.message : String(error)
    }, 502);
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
