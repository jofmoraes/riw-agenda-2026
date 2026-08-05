
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
const DEFAULT_VISIBLE_STATUSES = ['Quero ir', 'Alto Interesse', 'Interesse'];
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
  const fromConfig = normalizeApiUrl(window.RIW_CONFIG && window.RIW_CONFIG.apiUrl);
  if (fromConfig) return fromConfig;
  try {
    return normalizeApiUrl(localStorage.getItem(API_URL_KEY));
  } catch (error) {
    return '';
  }
}

function showBackendSetup(message = '') {
  const backdrop = el('setupBackdrop');
  if (!backdrop) return;
  el('setupError').textContent = message;
  el('apiUrlInput').value = configuredApiUrl();
  backdrop.classList.add('open');
  setTimeout(() => el('apiUrlInput').focus(), 0);
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
  const apiUrl = configuredApiUrl();
  if (!apiUrl) {
    showBackendSetup();
    return Promise.reject(new Error('Backend não configurado.'));
  }

  return new Promise((resolve, reject) => {
    const callbackName = `__riw_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('O backend demorou demais para responder.'));
    }, 45000);

    function cleanup() {
      window.clearTimeout(timeout);
      try { delete window[callbackName]; } catch (error) { window[callbackName] = undefined; }
      script.remove();
    }

    window[callbackName] = payload => {
      cleanup();
      if (payload && payload.ok) resolve(payload.data);
      else reject(new Error(payload && payload.error ? payload.error : 'Erro desconhecido no backend.'));
    };

    const url = new URL(apiUrl);
    url.searchParams.set('api', action);
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('_', String(Date.now()));
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });

    script.onerror = () => {
      cleanup();
      reject(new Error('Não foi possível acessar o backend.'));
    };
    script.src = url.toString();
    document.head.appendChild(script);
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

function parseTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeDecision(value) {
  const clean = String(value || '').trim();
  if (!clean) return 'Não analisado';
  if (clean.toLocaleLowerCase('pt-BR') === 'conflito') return 'Alto Interesse';
  const canonical = STATUS_OPTIONS.find(option => option.toLocaleLowerCase('pt-BR') === clean.toLocaleLowerCase('pt-BR'));
  return canonical || clean;
}

function decision(event) {
  return normalizeDecision(event.decision);
}

function eventDateTime(event, timeValue) {
  const dateMatch = String(event.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(timeValue || '').match(/^(\d{1,2}):(\d{2})$/);
  return dateMatch && timeMatch
    ? new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(timeMatch[1]), Number(timeMatch[2]), 0, 0)
    : null;
}

function eventStartDateTime(event) {
  return eventDateTime(event, event.start);
}

function eventEndDateTime(event) {
  const direct = eventDateTime(event, event.end);
  if (direct) return direct;
  const start = eventStartDateTime(event);
  return start ? new Date(start.getTime() + (Number(event.duration) || 45) * 60000) : null;
}

function selectedDays() {
  return DAYS.filter(day => state.selectedDays.has(day));
}

function splitTags(value) {
  return String(value || '')
    .split(';')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  const map = new Map();
  values.forEach(value => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const key = clean.toLocaleLowerCase('pt-BR');
    if (!map.has(key)) map.set(key, clean);
  });
  return [...map.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function profileSlugFromUrl() {
  return new URLSearchParams(location.search).get('perfil')?.toLowerCase() || '';
}

function initialProfileSlug() {
  return profileSlugFromUrl() || localStorage.getItem(LAST_PROFILE_KEY) || '';
}

function setProfileUrl(slug, clearFilters = false) {
  const url = new URL(location.href);
  if (clearFilters) url.search = '';
  url.searchParams.set('perfil', slug);
  history.replaceState({}, '', url);
}

function settingsKey(slug) {
  return `${SETTINGS_PREFIX}${slug}`;
}

function defaultDayForEvents(events) {
  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const current = events.find(event => event.date === today && DAYS.includes(event.day));
  if (current) return current.day;
  return DAYS.find(day => events.some(event => event.day === day)) || DAYS[0];
}

function resetStateForProfile() {
  const defaultDay = defaultDayForEvents(state.events);
  state.selectedDays = new Set([defaultDay]);
  state.search = '';
  state.tag = '';
  state.priority = '';
  state.potential = '';
  state.audioRoom = '';
  state.timeMode = '';
  state.timeFrom = '';
  state.timeTo = '';
  state.visibleStatuses = new Set(DEFAULT_VISIBLE_STATUSES);
  state.view = window.matchMedia('(max-width: 620px)').matches ? 'list' : 'grid';
  state.expanded = new Set();
  state.hideUnscheduled = state.view === 'grid';
  state.conflictsOnly = false;
  state.reviewMode = false;
  state.reviewSnapshot = null;
}

function serializableSettings() {
  return {
    selectedDays: selectedDays(),
    search: state.search,
    tag: state.tag,
    priority: state.priority,
    potential: state.potential,
    audioRoom: state.audioRoom,
    timeMode: state.timeMode,
    timeFrom: state.timeFrom,
    timeTo: state.timeTo,
    visibleStatuses: STATUS_OPTIONS.filter(status => state.visibleStatuses.has(status)),
    view: state.view,
    hideUnscheduled: state.hideUnscheduled,
    conflictsOnly: state.conflictsOnly
  };
}

function applySettings(settings) {
  if (!settings || typeof settings !== 'object') return;
  const days = Array.isArray(settings.selectedDays) ? settings.selectedDays.filter(day => DAYS.includes(day)) : [];
  if (days.length) state.selectedDays = new Set(days);
  state.search = String(settings.search || '');
  state.tag = String(settings.tag || '');
  state.priority = String(settings.priority || '');
  state.potential = String(settings.potential || '');
  state.audioRoom = String(settings.audioRoom || '');
  state.timeMode = String(settings.timeMode || '');
  state.timeFrom = String(settings.timeFrom || '');
  state.timeTo = String(settings.timeTo || '');
  const statuses = Array.isArray(settings.visibleStatuses)
    ? settings.visibleStatuses.map(normalizeDecision).filter(status => STATUS_OPTIONS.includes(status))
    : [];
  if (statuses.length) state.visibleStatuses = new Set(statuses);
  if (['list', 'grid'].includes(settings.view)) state.view = settings.view;
  state.hideUnscheduled = Boolean(settings.hideUnscheduled);
  state.conflictsOnly = Boolean(settings.conflictsOnly);
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(settingsKey(state.profile.slug));
    if (raw) applySettings(JSON.parse(raw));
  } catch (error) {
    console.warn('Não foi possível carregar preferências locais.', error);
  }
}

function applyUrlSettings() {
  const params = new URLSearchParams(location.search);
  const days = (params.get('dias') || '').split(',').filter(day => DAYS.includes(day));
  if (days.length) state.selectedDays = new Set(days);

  const statuses = (params.get('status') || '')
    .split('|')
    .map(normalizeDecision)
    .filter(status => STATUS_OPTIONS.includes(status));
  if (statuses.length) state.visibleStatuses = new Set(statuses);

  if (['list', 'grid'].includes(params.get('vista'))) state.view = params.get('vista');
  if (params.has('q')) state.search = params.get('q') || '';
  if (params.has('tag')) state.tag = params.get('tag') || '';
  if (params.has('prioridade')) state.priority = params.get('prioridade') || '';
  if (params.has('aderencia')) state.potential = params.get('aderencia') || '';
  if (params.has('audio')) state.audioRoom = params.get('audio') || '';
  if (params.has('tempo')) state.timeMode = params.get('tempo') || '';
  if (params.has('de')) state.timeFrom = params.get('de') || '';
  if (params.has('ate')) state.timeTo = params.get('ate') || '';
  if (params.has('semHorario')) state.hideUnscheduled = params.get('semHorario') === '1';
  if (params.has('choques')) state.conflictsOnly = params.get('choques') === '1';
}

function persistState() {
  if (!state.profile || !state.hydrated) return;
  const settings = serializableSettings();
  try {
    localStorage.setItem(LAST_PROFILE_KEY, state.profile.slug);
    localStorage.setItem(settingsKey(state.profile.slug), JSON.stringify(settings));
  } catch (error) {
    console.warn('Não foi possível salvar preferências locais.', error);
  }

  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('perfil', state.profile.slug);
  url.searchParams.set('vista', state.view);
  url.searchParams.set('dias', settings.selectedDays.join(','));
  url.searchParams.set('status', settings.visibleStatuses.join('|'));
  if (state.search) url.searchParams.set('q', state.search);
  if (state.tag) url.searchParams.set('tag', state.tag);
  if (state.priority) url.searchParams.set('prioridade', state.priority);
  if (state.potential) url.searchParams.set('aderencia', state.potential);
  if (state.audioRoom) url.searchParams.set('audio', state.audioRoom);
  if (state.timeMode) url.searchParams.set('tempo', state.timeMode);
  if (state.timeFrom) url.searchParams.set('de', state.timeFrom);
  if (state.timeTo) url.searchParams.set('ate', state.timeTo);
  if (state.hideUnscheduled) url.searchParams.set('semHorario', '1');
  if (state.conflictsOnly) url.searchParams.set('choques', '1');
  history.replaceState({}, '', url);
}

function selectProfile(slug) {
  setProfileUrl(slug, true);
  localStorage.setItem(LAST_PROFILE_KEY, slug);
  el('profileBackdrop').classList.remove('open');
  loadData(slug);
}

function renderProfileChooser(force = false) {
  const profiles = Array.isArray(state.profiles) ? state.profiles : [];
  el('profileGrid').innerHTML = profiles.length ? profiles.map(profile => {
    const selected = state.profile && profile.slug === state.profile.slug;
    return `
      <button class="profile-card ${selected ? 'selected' : ''}" type="button" data-profile="${esc(profile.slug)}" aria-current="${selected ? 'true' : 'false'}">
        <strong>${esc(profile.name || profile.label)}</strong>
        <span class="profile-status">${esc(profile.curationStatus || '')}</span>
        ${profile.interests ? `<span class="profile-interests"><b>Interesses de referência:</b><br>${esc(profile.interests)}</span>` : ''}
      </button>
    `;
  }).join('') : '<div class="loading">Carregando perfis…</div>';
  el('profileGrid').querySelectorAll('[data-profile]').forEach(button => {
    button.onclick = () => selectProfile(button.dataset.profile);
  });
  if (force || !state.profile) el('profileBackdrop').classList.add('open');
}

function openProfileChooser() {
  renderProfileChooser(true);
  if (Array.isArray(state.profiles) && state.profiles.length) return;

  apiCall('getProfiles')
    .then(profiles => {
      state.profiles = Array.isArray(profiles) ? profiles : [];
      if (!state.profiles.length) {
        el('profileGrid').innerHTML = '<div class="error">Não foi possível carregar os perfis.</div>';
        return;
      }
      renderProfileChooser(true);
    })
    .catch(error => {
      el('profileGrid').innerHTML = `<div class="error">${esc(error.message || error)}</div>`;
    });
}

function hydrateLoadedData(data) {
  state.profiles = data.profiles || [];
  state.profile = data.selectedProfile || null;
  state.events = (data.events || []).map(event => ({...event, decision: normalizeDecision(event.decision)}));

  if (!state.profile) {
    renderProfileChooser(true);
    return;
  }

  const label = state.profile.label || state.profile.name || 'Perfil';
  el('profileTitle').textContent = `Agenda de ${label}`;
  el('profileName').textContent = label;
  el('profileInitial').textContent = label.trim().charAt(0).toUpperCase() || 'P';

  resetStateForProfile();
  loadSavedSettings();
  applyUrlSettings();
  populateFilterOptions();
  state.hydrated = true;
  render();
}

function loadData(slug) {
  state.hydrated = false;
  el('content').innerHTML = '<div class="loading">Carregando agenda…</div>';

  apiCall('getAppData', {profile: slug})
    .then(data => {
      cacheProfileData(slug, data);
      hydrateLoadedData(data);
    })
    .catch(error => {
      const cached = cachedProfileData(slug);
      if (cached) {
        hydrateLoadedData(cached);
        const warning = document.createElement('div');
        warning.className = 'error';
        warning.textContent = `Modo offline: ${error.message || error}`;
        el('content').prepend(warning);
        return;
      }
      if (!configuredApiUrl()) {
        showBackendSetup();
        el('content').innerHTML = '<div class="loading">Aguardando conexão com a agenda…</div>';
        return;
      }
      el('content').innerHTML = `<div class="error">${esc(error.message || error)}</div>`;
    });
}

function populateFilterOptions() {
  const rooms = uniqueSorted(state.events.map(event => event.audioRoom));
  const tags = uniqueSorted(state.events.flatMap(event => splitTags(event.tags)));

  el('audioRoom').innerHTML = '<option value="">Todas as salas</option>' + rooms
    .map(room => `<option value="${esc(room)}">${esc(room)}</option>`)
    .join('');
  el('tagFilter').innerHTML = '<option value="">Todas as tags</option>' + tags
    .map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`)
    .join('');
}

function syncControls() {
  el('search').value = state.search;
  el('tagFilter').value = state.tag;
  el('priority').value = state.priority;
  el('potential').value = state.potential;
  el('audioRoom').value = state.audioRoom;
  el('timeMode').value = state.timeMode;
  el('timeFrom').value = state.timeFrom;
  el('timeTo').value = state.timeTo;
}

function renderDayPicker() {
  const all = state.selectedDays.size === DAYS.length;
  el('dayPicker').innerHTML = `
    <button class="day-button ${all ? 'active' : ''}" type="button" data-all>Todos</button>
    ${DAYS.map(day => `<button class="day-button ${state.selectedDays.has(day) ? 'active' : ''}" type="button" data-day="${day}">${day}</button>`).join('')}
  `;

  el('dayPicker').querySelector('[data-all]').onclick = () => {
    state.selectedDays = all ? new Set([defaultDayForEvents(state.events)]) : new Set(DAYS);
    render();
  };

  el('dayPicker').querySelectorAll('[data-day]').forEach(button => {
    button.onclick = () => {
      const day = button.dataset.day;
      if (state.selectedDays.has(day) && state.selectedDays.size > 1) {
        state.selectedDays.delete(day);
      } else if (state.selectedDays.has(day) && state.selectedDays.size === 1) {
        state.selectedDays = new Set([day]);
      } else {
        state.selectedDays.add(day);
      }
      render();
    };
  });
}

function statusCssClass(status) {
  const map = {
    'Quero ir': 'status-go',
    'Alto Interesse': 'status-high',
    'Interesse': 'status-interest',
    'Talvez': 'status-maybe',
    'Reavaliar': 'status-review',
    'Assistir online': 'status-online',
    'Não vou': 'status-no',
    'Não analisado': 'status-unreviewed'
  };
  return map[normalizeDecision(status)] || 'status-unreviewed';
}

function renderStatuses() {
  el('statusChecks').innerHTML = STATUS_OPTIONS.map(status => `
    <label class="status-check ${statusCssClass(status)}">
      <input type="checkbox" value="${esc(status)}" ${state.visibleStatuses.has(status) ? 'checked' : ''}>
      ${esc(status)}
    </label>
  `).join('');

  el('statusChecks').querySelectorAll('input').forEach(input => {
    input.onchange = () => {
      if (input.checked) state.visibleStatuses.add(input.value);
      else state.visibleStatuses.delete(input.value);
      state.reviewMode = false;
      render();
    };
  });
  const allSelected = STATUS_OPTIONS.every(status => state.visibleStatuses.has(status));
  el('toggleAllStatuses').textContent = allSelected ? 'Limpar seleção' : 'Selecionar todos';
}

function overlaps(a, b) {
  const aStart = parseTime(a.start);
  const aEnd = parseTime(a.end) ?? (aStart == null ? null : aStart + (a.duration || 45));
  const bStart = parseTime(b.start);
  const bEnd = parseTime(b.end) ?? (bStart == null ? null : bStart + (b.duration || 45));
  return aStart != null && bStart != null && aStart < bEnd && bStart < aEnd;
}

function hasConflict(event, candidates = state.events) {
  if (event.conflictGroup) return true;
  if (!PHYSICAL_INTEREST_STATUSES.has(decision(event))) return false;
  return candidates.some(other =>
    other.id !== event.id &&
    other.day === event.day &&
    PHYSICAL_INTEREST_STATUSES.has(decision(other)) &&
    overlaps(event, other)
  );
}

function filteredEvents() {
  const query = state.search.trim().toLocaleLowerCase('pt-BR');
  const minPriority = state.priority ? PRIORITY_RANK[state.priority] : -1;
  const from = parseTime(state.timeFrom);
  const to = parseTime(state.timeTo);
  const now = new Date();

  let output = state.events.filter(event => {
    if (!state.selectedDays.has(event.day)) return false;
    if (!state.visibleStatuses.has(decision(event))) return false;
    if (PRIORITY_RANK[event.priority || ''] < minPriority) return false;

    const startMinutes = parseTime(event.start);
    if (state.hideUnscheduled && startMinutes == null) return false;
    if (from != null && (startMinutes == null || startMinutes < from)) return false;
    if (to != null && (startMinutes == null || startMinutes > to)) return false;

    if (state.timeMode === 'hideEnded') {
      const endAt = eventEndDateTime(event);
      if (endAt && endAt <= now) return false;
    }
    if (state.timeMode === 'hideStarted') {
      const startAt = eventStartDateTime(event);
      if (startAt && startAt <= now) return false;
    }

    if (state.audioRoom && event.audioRoom !== state.audioRoom) return false;
    if (state.tag && !splitTags(event.tags).includes(state.tag)) return false;
    if (state.potential === 'Muito alto' && event.potential !== 'Muito alto') return false;
    if (state.potential === 'Alto+' && POTENTIAL_RANK[event.potential || ''] < 3) return false;
    if (state.potential === 'Médio+' && POTENTIAL_RANK[event.potential || ''] < 2) return false;

    if (query) {
      const haystack = [
        event.title,
        event.speakers,
        event.organization,
        event.track,
        event.macroConference,
        event.space,
        event.stage,
        event.description,
        event.highlight,
        event.why,
        event.comments,
        event.potentialReason
      ].join(' ').toLocaleLowerCase('pt-BR');
      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  if (state.conflictsOnly) output = output.filter(event => hasConflict(event, state.events));

  return output.sort((a, b) =>
    DAYS.indexOf(a.day) - DAYS.indexOf(b.day) ||
    (a.start || '99:99').localeCompare(b.start || '99:99') ||
    a.title.localeCompare(b.title, 'pt-BR')
  );
}

function eventClasses(event) {
  return [
    statusCssClass(decision(event)),
    hasConflict(event, state.events) ? 'has-time-conflict' : '',
    event.analysisStatus === 'Novo potencial' ? 'potential' : ''
  ].filter(Boolean).join(' ');
}

function decisionOptions(current) {
  return STATUS_OPTIONS.map(status => `<option value="${esc(status)}" ${status === normalizeDecision(current) ? 'selected' : ''}>${esc(status)}</option>`).join('');
}

function badges(event) {
  const items = [`<span class="badge status-badge ${statusCssClass(decision(event))}">${esc(decision(event))}</span>`];
  if (hasConflict(event, state.events)) items.push('<span class="badge conflict-badge">Conflito de horário</span>');
  if (event.review) items.push('<span class="badge review-badge">Revisar</span>');
  if (event.analysisStatus === 'Novo potencial') items.push('<span class="badge potential-badge">Novo potencial</span>');
  if (event.audioRoom) items.push('<span class="badge audio-badge">Áudio disponível</span>');
  return items.join('');
}

function tagsHtml(tags) {
  const list = splitTags(tags);
  return list.length ? `
    <div class="detail-block">
      <h3>Tags</h3>
      <div class="tag-list">${list.map(tag => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
    </div>
  ` : '';
}

function details(event) {
  const source = event.source && /^https?:/i.test(event.source)
    ? `<a class="source-link" href="${esc(event.source)}" target="_blank" rel="noopener">Abrir fonte</a>`
    : esc(event.source || '');

  return `
    ${event.audioRoom ? `<div class="detail-block"><h3>Sala de áudio no app</h3><p><strong>${esc(event.audioRoom)}</strong>${event.audioConfidence ? `\n${esc(event.audioConfidence)}` : ''}</p></div>` : ''}
    ${event.speakers ? `<div class="detail-block"><h3>Palestrantes</h3><p>${esc(event.speakers)}</p></div>` : ''}
    ${event.organization ? `<div class="detail-block"><h3>Empresa / instituição</h3><p>${esc(event.organization)}</p></div>` : ''}
    ${event.description ? `<div class="detail-block"><h3>Sobre</h3><p>${esc(event.description)}</p></div>` : ''}
    ${event.potentialReason ? `<div class="detail-block"><h3>Motivo da aderência estimada</h3><p>${esc(event.potentialReason)}</p></div>` : ''}
    ${event.highlight ? `<div class="detail-block"><h3>Destaque</h3><p>${esc(event.highlight)}</p></div>` : ''}
    ${event.why ? `<div class="detail-block"><h3>Aderência ao perfil</h3><p>${esc(event.why)}</p></div>` : ''}
    ${tagsHtml(event.tags)}
    ${event.alternative ? `<div class="detail-block"><h3>Alternativa</h3><p>${esc(event.alternative)}</p></div>` : ''}
    ${event.statusInfo ? `<div class="detail-block"><h3>Status da informação</h3><p>${esc(event.statusInfo)}</p></div>` : ''}
    ${source ? `<div class="detail-block"><h3>Fonte</h3><p>${source}</p></div>` : ''}
    <div class="detail-block">
      <h3>Comentários / perguntas</h3>
      <textarea class="comments-input">${esc(event.comments)}</textarea>
      <div class="save-row"><button class="save-button" type="button">Salvar comentário</button><span class="save-status"></span></div>
    </div>
  `;
}

function eventCard(event) {
  const locationText = [event.space, event.stage].filter(Boolean).join(' — ');
  const isExpanded = state.expanded.has(event.id);
  return `
    <article class="event ${eventClasses(event)}" data-id="${esc(event.id)}">
      <div class="event-time">${esc(event.start || '--:--')}<small>${esc(event.end || '')}</small></div>
      <div>
        <div class="event-title">${esc(event.title)}</div>
        <div class="event-meta">${esc(locationText || event.track || 'Local a confirmar')}</div>
        ${event.audioRoom ? `<div class="event-meta audio-line">Ouvir em: ${esc(event.audioRoom)}</div>` : ''}
        <div class="badges">${badges(event)}</div>
        <div class="event-actions">
          <select class="decision-select" aria-label="Nível de interesse">${decisionOptions(decision(event))}</select>
          <button class="details-button" type="button">${isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}</button>
        </div>
      </div>
      <div class="details ${isExpanded ? 'open' : ''}">${details(event)}</div>
    </article>
  `;
}

function renderList(events) {
  if (!events.length) {
    el('content').innerHTML = '<div class="empty">Nenhum evento corresponde aos filtros.</div>';
    return;
  }

  el('content').innerHTML = selectedDays().map(day => {
    const dayEvents = events.filter(event => event.day === day);
    if (!dayEvents.length) return '';
    return `
      <section class="day-section">
        <div class="day-heading"><h2>${day}</h2><span>${dayEvents.length} evento${dayEvents.length === 1 ? '' : 's'}</span></div>
        <div class="timeline">${dayEvents.map(eventCard).join('')}</div>
      </section>
    `;
  }).join('');
  bindList();
}

function layout(events) {
  const scheduled = events
    .map(event => ({
      event,
      start: parseTime(event.start),
      end: parseTime(event.end) ?? ((parseTime(event.start) || 0) + (event.duration || 45))
    }))
    .filter(item => item.start != null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const active = [];
  let maxLanes = 1;
  scheduled.forEach(item => {
    for (let index = active.length - 1; index >= 0; index--) {
      if (active[index].end <= item.start) active.splice(index, 1);
    }
    const used = new Set(active.map(entry => entry.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    item.lane = lane;
    active.push(item);
    maxLanes = Math.max(maxLanes, lane + 1);
  });

  return scheduled.map(item => ({...item, lanes: maxLanes}));
}

function renderGrid(events) {
  const days = selectedDays();
  const height = (GRID_END - GRID_START) / 60 * HOUR_HEIGHT;
  const columns = `49px repeat(${days.length}, minmax(164px, 1fr))`;
  const heads = days.map(day => `
    <div class="calendar-day-head">${day}<small>${events.filter(event => event.day === day).length} eventos</small></div>
  `).join('');

  const labels = [];
  for (let minutes = GRID_START; minutes <= GRID_END; minutes += 60) {
    labels.push(`<div class="time-label" style="top:${(minutes - GRID_START) / 60 * HOUR_HEIGHT}px">${String(Math.floor(minutes / 60)).padStart(2, '0')}:00</div>`);
  }

  const tracks = days.map(day => {
    const buttons = layout(events.filter(event => event.day === day)).map(item => {
      const top = Math.max(0, (item.start - GRID_START) / 60 * HOUR_HEIGHT);
      const bottom = Math.min(GRID_END, item.end);
      const eventHeight = Math.max(25, (bottom - Math.max(GRID_START, item.start)) / 60 * HOUR_HEIGHT - 2);
      const width = 100 / item.lanes;
      const left = item.lane * width;
      const locationText = [item.event.space, item.event.stage].filter(Boolean).join(' · ');
      const compactClass = eventHeight < 43 ? 'compact' : eventHeight < 66 ? 'medium' : '';
      return `
        <button
          class="grid-event ${eventClasses(item.event)} ${compactClass}"
          type="button"
          data-id="${esc(item.event.id)}"
          title="${esc(item.event.title)}"
          aria-label="${esc(item.event.start)} a ${esc(item.event.end)}. ${esc(item.event.title)}"
          style="top:${top}px;height:${eventHeight}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px)"
        >
          <div class="grid-event-time">${esc(item.event.start)}–${esc(item.event.end)}</div>
          <div class="grid-event-title">${esc(item.event.title)}</div>
          ${eventHeight > 61 ? `<div class="grid-event-place">${esc(locationText)}</div>` : ''}
        </button>
      `;
    }).join('');
    return `<div class="day-track" style="height:${height}px">${buttons}</div>`;
  }).join('');

  el('content').innerHTML = `
    <section class="calendar-shell">
      <div class="calendar-scroll">
        <div class="calendar-inner">
          <div class="calendar-header" style="grid-template-columns:${columns}"><div class="time-spacer"></div>${heads}</div>
          <div class="calendar-body" style="grid-template-columns:${columns}">
            <div class="time-rail" style="height:${height}px">${labels.join('')}</div>
            ${tracks}
          </div>
        </div>
      </div>
      <div class="grid-footer"><span>Toque no evento para ver o título completo e editar o interesse.</span><span>Borda vermelha = conflito de horário.</span></div>
    </section>
  `;

  document.querySelectorAll('.grid-event').forEach(button => {
    button.onclick = () => openModal(button.dataset.id);
  });
}

function renderSummary(events) {
  const counts = {
    total: events.length,
    go: events.filter(event => decision(event) === 'Quero ir').length,
    high: events.filter(event => decision(event) === 'Alto Interesse').length,
    interest: events.filter(event => decision(event) === 'Interesse').length,
    maybe: events.filter(event => ['Talvez', 'Reavaliar'].includes(decision(event))).length,
    conflicts: events.filter(event => hasConflict(event, state.events)).length,
    audio: events.filter(event => event.audioRoom).length
  };

  el('summary').innerHTML = `
    <div class="metric"><strong>${counts.total}</strong><span>Total no filtro</span></div>
    <div class="metric"><strong>${counts.go}</strong><span>Quero ir</span></div>
    <div class="metric"><strong>${counts.high}</strong><span>Alto interesse</span></div>
    <div class="metric"><strong>${counts.interest}</strong><span>Interesse</span></div>
    <div class="metric"><strong>${counts.maybe}</strong><span>Talvez / reavaliar</span></div>
    <div class="metric"><strong>${counts.conflicts}</strong><span>Conflitos de horário</span></div>
    <div class="metric"><strong>${counts.audio}</strong><span>Com sala de áudio</span></div>
  `;
}

function renderLegend() {
  const statusItems = STATUS_OPTIONS.map(status => {
    const cssClass = statusCssClass(status);
    const colorMap = {
      'status-go': ['var(--go)', 'var(--go-bg)'],
      'status-high': ['var(--high)', 'var(--high-bg)'],
      'status-interest': ['var(--interest)', 'var(--interest-bg)'],
      'status-maybe': ['var(--maybe)', 'var(--maybe-bg)'],
      'status-review': ['var(--review)', 'var(--review-bg)'],
      'status-online': ['var(--online)', 'var(--online-bg)'],
      'status-no': ['var(--no)', 'var(--no-bg)'],
      'status-unreviewed': ['var(--unreviewed)', 'var(--unreviewed-bg)']
    };
    const [dot, background] = colorMap[cssClass];
    return `<span class="legend-item"><span class="legend-dot" style="--dot:${dot};--dot-bg:${background}"></span>${esc(status)}</span>`;
  }).join('');

  el('legend').innerHTML = `<span class="legend-label">Legenda:</span>${statusItems}<span class="legend-item"><span class="legend-conflict"></span>Conflito de horário</span>`;
}

function activeFilterCount() {
  let count = 0;
  if (state.search) count += 1;
  if (state.tag) count += 1;
  if (state.priority) count += 1;
  if (state.potential) count += 1;
  if (state.audioRoom) count += 1;
  if (state.timeMode) count += 1;
  if (state.timeFrom || state.timeTo) count += 1;
  if (state.conflictsOnly) count += 1;
  if (state.hideUnscheduled) count += 1;
  const defaultStatuses = DEFAULT_VISIBLE_STATUSES.join('|');
  const currentStatuses = STATUS_OPTIONS.filter(status => state.visibleStatuses.has(status)).join('|');
  if (currentStatuses !== defaultStatuses) count += 1;
  return count;
}

function updateToolbar(events) {
  el('listViewButton').classList.toggle('active', state.view === 'list');
  el('gridViewButton').classList.toggle('active', state.view === 'grid');
  el('filtersPanel').classList.toggle('open', state.filtersOpen);
  el('filtersToggle').setAttribute('aria-expanded', String(state.filtersOpen));

  const count = activeFilterCount();
  el('filterCount').textContent = count;
  el('filterCount').classList.toggle('visible', count > 0);

  const allExpanded = events.length > 0 && events.every(event => state.expanded.has(event.id));
  el('expandAll').textContent = allExpanded ? 'Ocultar detalhes' : 'Expandir detalhes';
  el('expandAll').hidden = state.view === 'grid';
  el('onlyScheduled').textContent = state.hideUnscheduled ? 'Mostrar sem horário' : 'Ocultar sem horário';
  el('onlyConflicts').textContent = state.conflictsOnly ? 'Mostrar todos' : 'Só conflitos de horário';
  el('newPotential').classList.toggle('active', state.reviewMode);
}

function updateStickyOffset() {
  const height = el('topbar').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--sticky-top', `${Math.ceil(height)}px`);
}

function render() {
  syncControls();
  renderDayPicker();
  renderStatuses();
  renderLegend();
  const events = filteredEvents();
  renderSummary(events);
  updateToolbar(events);
  state.view === 'grid' ? renderGrid(events) : renderList(events);
  updateStickyOffset();
  persistState();
}

function save(eventId, patch, statusElement, done) {
  if (statusElement) statusElement.textContent = 'Salvando…';

  apiCall('updateEvent', {
    profile: state.profile.slug,
    eventId,
    patch: JSON.stringify(patch || {})
  })
    .then(updated => {
      updated.decision = normalizeDecision(updated.decision);
      const index = state.events.findIndex(event => event.id === updated.id);
      if (index >= 0) state.events[index] = updated;
      cacheProfileData(state.profile.slug, {
        profiles: state.profiles,
        selectedProfile: state.profile,
        events: state.events
      });
      if (statusElement) statusElement.textContent = 'Salvo';
      if (done) done(updated);
    })
    .catch(error => {
      if (statusElement) statusElement.textContent = `Erro: ${error.message || error}`;
      else alert(error.message || error);
    });
}

function bindEditor(container, eventId) {
  const select = container.querySelector('.decision-select, .modal-select');
  const comments = container.querySelector('.comments-input');
  const saveButton = container.querySelector('.save-button');
  const status = container.querySelector('.save-status');

  if (select) {
    select.onchange = () => save(eventId, {decision: select.value, review: ''}, status, () => render());
  }
  if (saveButton && comments) {
    saveButton.onclick = () => save(eventId, {comments: comments.value}, status);
  }
}

function bindList() {
  document.querySelectorAll('.event').forEach(card => {
    const eventId = card.dataset.id;
    card.querySelector('.details-button').onclick = () => {
      if (state.expanded.has(eventId)) state.expanded.delete(eventId);
      else state.expanded.add(eventId);
      render();
    };
    bindEditor(card, eventId);
  });
}

function openModal(eventId) {
  const event = state.events.find(item => item.id === eventId);
  if (!event) return;

  state.modalEventId = eventId;
  el('modalTitle').textContent = event.title;
  const locationText = [event.space, event.stage].filter(Boolean).join(' — ');
  el('modalContent').innerHTML = `
    <div class="modal-meta">${esc(event.day)} · ${esc(event.start || '--:--')}–${esc(event.end || '')}${locationText ? ` · ${esc(locationText)}` : ''}</div>
    <select class="modal-select" aria-label="Nível de interesse">${decisionOptions(decision(event))}</select>
    <div class="badges">${badges(event)}</div>
    ${details(event)}
  `;
  el('modalBackdrop').classList.add('open');
  bindEditor(el('modalContent'), eventId);
}

function clearOtherFiltersPreservingDay() {
  state.search = '';
  state.tag = '';
  state.priority = '';
  state.potential = '';
  state.audioRoom = '';
  state.timeMode = '';
  state.timeFrom = '';
  state.timeTo = '';
  state.visibleStatuses = new Set(DEFAULT_VISIBLE_STATUSES);
  state.hideUnscheduled = state.view === 'grid';
  state.conflictsOnly = false;
  state.reviewMode = false;
  state.reviewSnapshot = null;
}

function toggleReviewMode() {
  if (!state.reviewMode) {
    state.reviewSnapshot = serializableSettings();
    state.search = '';
    state.tag = '';
    state.priority = '';
    state.potential = 'Alto+';
    state.audioRoom = '';
    state.timeMode = '';
    state.timeFrom = '';
    state.timeTo = '';
    state.visibleStatuses = new Set(['Não analisado']);
    state.conflictsOnly = false;
    state.reviewMode = true;
  } else {
    const days = selectedDays();
    const snapshot = state.reviewSnapshot;
    if (snapshot) applySettings(snapshot);
    state.selectedDays = new Set(days);
    state.reviewMode = false;
    state.reviewSnapshot = null;
  }
  render();
}

el('search').oninput = event => { state.search = event.target.value; state.reviewMode = false; render(); };
el('tagFilter').onchange = event => { state.tag = event.target.value; state.reviewMode = false; render(); };
el('priority').onchange = event => { state.priority = event.target.value; state.reviewMode = false; render(); };
el('potential').onchange = event => { state.potential = event.target.value; state.reviewMode = false; render(); };
el('audioRoom').onchange = event => { state.audioRoom = event.target.value; state.reviewMode = false; render(); };
el('timeMode').onchange = event => { state.timeMode = event.target.value; state.reviewMode = false; render(); };
el('timeFrom').onchange = event => { state.timeFrom = event.target.value; state.reviewMode = false; render(); };
el('timeTo').onchange = event => { state.timeTo = event.target.value; state.reviewMode = false; render(); };
el('newPotential').onclick = toggleReviewMode;
el('listViewButton').onclick = () => { state.view = 'list'; state.hideUnscheduled = false; render(); };
el('gridViewButton').onclick = () => { state.view = 'grid'; state.hideUnscheduled = true; render(); };
el('expandAll').onclick = () => {
  const events = filteredEvents();
  const allExpanded = events.length > 0 && events.every(event => state.expanded.has(event.id));
  events.forEach(event => allExpanded ? state.expanded.delete(event.id) : state.expanded.add(event.id));
  render();
};
el('onlyScheduled').onclick = () => { state.hideUnscheduled = !state.hideUnscheduled; state.reviewMode = false; render(); };
el('onlyConflicts').onclick = () => { state.conflictsOnly = !state.conflictsOnly; state.reviewMode = false; render(); };
el('toggleAllStatuses').onclick = () => {
  const allSelected = STATUS_OPTIONS.every(status => state.visibleStatuses.has(status));
  state.visibleStatuses = new Set(allSelected ? [] : STATUS_OPTIONS);
  state.reviewMode = false;
  render();
};
el('clearFilters').onclick = () => { clearOtherFiltersPreservingDay(); render(); };
el('filtersToggle').onclick = () => { state.filtersOpen = !state.filtersOpen; render(); };
el('profileButton').onclick = openProfileChooser;
if (el('installAction')) el('installAction').onclick = requestAppInstall;
if (el('installDismiss')) el('installDismiss').onclick = dismissInstallSuggestion;
el('saveApiUrl').onclick = saveBackendUrl;
el('apiUrlInput').addEventListener('keydown', event => { if (event.key === 'Enter') saveBackendUrl(); });
el('modalClose').onclick = () => el('modalBackdrop').classList.remove('open');
el('modalBackdrop').onclick = event => { if (event.target === el('modalBackdrop')) el('modalBackdrop').classList.remove('open'); };
window.addEventListener('resize', updateStickyOffset);
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    el('modalBackdrop').classList.remove('open');
    el('profileBackdrop').classList.remove('open');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(error => {
      console.warn('Service worker não registrado.', error);
    });
  });
}

const backendFromUrl = normalizeApiUrl(new URLSearchParams(location.search).get('backend'));
if (backendFromUrl) {
  try { localStorage.setItem(API_URL_KEY, backendFromUrl); } catch (error) {}
}

syncStandaloneMode();
if (configuredApiUrl()) loadData(initialProfileSlug());
else showBackendSetup();
