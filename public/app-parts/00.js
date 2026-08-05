
const DAYS = ['Terça', 'Quarta', 'Quinta', 'Sexta'];
const STATUS_OPTIONS = [
  'Quero ir',
  'Alto Interesse',
  'Interesse',
  'Talvez',
  'Reavaliar',
  'Assistir online',
  'Não vou',
  'Não analisado'
];
const DEFAULT_VISIBLE_STATUSES = ['Quero ir'];
const PHYSICAL_INTEREST_STATUSES = new Set(['Quero ir', 'Alto Interesse', 'Interesse']);
const PRIORITY_RANK = {
  'Bloquear agenda': 4,
  'Prioridade alta': 3,
  'Vale encaixar': 2,
  'Somente se houver tempo': 1,
  'Sem prioridade': 0,
  '': 0
};
const POTENTIAL_RANK = {'Muito alto': 4, 'Alto': 3, 'Médio': 2, 'Baixo': 1, '': 0};
const GRID_START = 10 * 60;
const GRID_END = 21 * 60;
const HOUR_HEIGHT = 76;
const LAST_PROFILE_KEY = 'riw2026:lastProfile';
const SETTINGS_PREFIX = 'riw2026:settings:';
const INSTALL_DISMISSED_KEY = 'riw2026:installDismissed';
let deferredInstallPrompt = null;

const API_URL_KEY = 'riw2026:backendUrl';
const DATA_CACHE_PREFIX = 'riw2026:dataCache:';

function normalizeApiUrl(value) {
  const url = String(value || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/(?:exec|dev)(?:[?#].*)?$/i.test(url)) return '';
  return url.split('?')[0].split('#')[0];
}

function configuredApiUrl() {
  return `${window.location.origin}/api/`;
}

function showBackendSetup(message = '') {
  console.warn('Falha de conexão com a agenda.', message);
}

function hideBackendSetup() {
  const backdrop = el('setupBackdrop');
  if (backdrop) backdrop.classList.remove('open');
}

function saveBackendUrl() {
  const value = normalizeApiUrl(el('apiUrlInput').value);
  if (!value) {
    el('setupError').textContent = 'Use o endereço completo que termina em /exec.';
    return;
  }
  try {
    localStorage.setItem(API_URL_KEY, value);
  } catch (error) {
    el('setupError').textContent = 'Não foi possível salvar o endereço neste aparelho.';
    return;
  }
  hideBackendSetup();
  loadData(initialProfileSlug());
}

function apiCall(action, params = {}) {
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

  return fetch(url.toString(), options)
    .then(async response => {
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
    })
    .catch(error => {
      if (/backend|HTTP|formato|demorou|acessar/i.test(String(error && error.message || ''))) throw error;
      throw new Error('Não foi possível acessar o backend.');
    });
}

function cacheProfileData(slug, data) {
  try {
    localStorage.setItem(DATA_CACHE_PREFIX + slug, JSON.stringify({savedAt: Date.now(), data}));
  } catch (error) {
    console.warn('Não foi possível guardar a agenda em cache.', error);
  }
}

function cachedProfileData(slug) {
  try {
    const raw = localStorage.getItem(DATA_CACHE_PREFIX + slug);
    return raw ? JSON.parse(raw).data : null;
  } catch (error) {
    return null;
  }
}


const state = {
  events: [],
  profiles: [],
  profile: null,
  selectedDays: new Set(),
  search: '',
  tag: '',
  priority: '',
  potential: '',
  audioRoom: '',
  timeMode: '',
  timeFrom: '',
  timeTo: '',
  visibleStatuses: new Set(DEFAULT_VISIBLE_STATUSES),
  view: 'list',
  expanded: new Set(),
  hideUnscheduled: false,
  conflictsOnly: false,
  filtersOpen: window.matchMedia('(min-width: 861px)').matches,
  reviewMode: false,
  reviewSnapshot: null,
  modalEventId: null,
  profileCandidateSlug: '',
  hydrated: false
};

const el = id => document.getElementById(id);
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function syncStandaloneMode() {
  document.body.classList.toggle('standalone', isStandaloneMode());
  renderInstallBanner();
}

function renderInstallBanner() {
  const banner = el('installBanner');
  if (!banner) return;

  let dismissed = false;
  try {
    dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch (error) {
    console.warn('Não foi possível ler a preferência de instalação.', error);
  }

  const shouldShow = !isStandaloneMode() && !dismissed;
  banner.hidden = !shouldShow;
  if (!shouldShow) return;

  const action = el('installAction');
  action.textContent = deferredInstallPrompt ? 'Instalar' : 'Como instalar';
}

async function requestAppInstall() {
  const banner = el('installBanner');
  if (deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice && choice.outcome === 'accepted') {
      banner.hidden = true;
    } else {
      renderInstallBanner();
    }
    return;
  }

  banner.classList.toggle('help-open');
  el('installAction').textContent = banner.classList.contains('help-open')
    ? 'Ocultar instrução'
    : 'Como instalar';
}

function dismissInstallSuggestion() {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch (error) {
    console.warn('Não foi possível salvar a preferência de instalação.', error);
  }
  el('installBanner').hidden = true;
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderInstallBanner();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  try {
    localStorage.removeItem(INSTALL_DISMISSED_KEY);
  } catch (error) {
    console.warn('Não foi possível atualizar a preferência de instalação.', error);
  }
  syncStandaloneMode();
});

const displayModeQuery = window.matchMedia('(display-mode: standalone)');
if (typeof displayModeQuery.addEventListener === 'function') {
  displayModeQuery.addEventListener('change', syncStandaloneMode);
}
