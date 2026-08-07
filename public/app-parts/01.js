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

function eventStartDateTime(event) { return eventDateTime(event, event.start); }
function eventEndDateTime(event) {
  const direct = eventDateTime(event, event.end);
  if (direct) return direct;
  const start = eventStartDateTime(event);
  return start ? new Date(start.getTime() + (Number(event.duration) || 45) * 60000) : null;
}

function selectedDays() { return DAYS.filter(day => state.selectedDays.has(day)); }

function splitTags(value) {
  return String(value || '').split(';').map(tag => tag.trim()).filter(Boolean);
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

function profileSlugFromUrl() { return new URLSearchParams(location.search).get('perfil')?.toLowerCase() || ''; }
function initialProfileSlug() { return profileSlugFromUrl() || localStorage.getItem(LAST_PROFILE_KEY) || ''; }

function setProfileUrl(slug, clearFilters = false) {
  const url = new URL(location.href);
  if (clearFilters) url.search = '';
  url.searchParams.set('perfil', slug);
  history.replaceState({}, '', url);
}

function settingsKey(slug) { return `${SETTINGS_PREFIX}${slug}`; }

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
  state.space = '';
  state.stage = '';
  state.timeMode = '';
  state.timeFrom = '';
  state.timeTo = '';
  state.visibleStatuses = new Set(DEFAULT_VISIBLE_STATUSES);
  state.view = 'list';
  state.expanded = new Set();
  state.hideUnscheduled = false;
  state.conflictsOnly = false;
  state.filtersOpen = false;
  state.reviewMode = false;
  state.reviewSnapshot = null;
}

function serializableSettings() {
  return {
    selectedDays: selectedDays(), search: state.search, tag: state.tag, priority: state.priority,
    potential: state.potential, audioRoom: state.audioRoom, space: state.space, stage: state.stage,
    timeMode: state.timeMode, timeFrom: state.timeFrom, timeTo: state.timeTo,
    visibleStatuses: STATUS_OPTIONS.filter(status => state.visibleStatuses.has(status)),
    view: state.view, hideUnscheduled: state.hideUnscheduled, conflictsOnly: state.conflictsOnly
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
  state.space = String(settings.space || '');
  state.stage = String(settings.stage || '');
  state.timeMode = String(settings.timeMode || '');
  state.timeFrom = String(settings.timeFrom || '');
  state.timeTo = String(settings.timeTo || '');
  if (Array.isArray(settings.visibleStatuses)) {
    const statuses = settings.visibleStatuses.map(normalizeDecision).filter(status => STATUS_OPTIONS.includes(status));
    state.visibleStatuses = new Set(statuses);
  }
  if (['list', 'grid'].includes(settings.view)) state.view = settings.view;
  state.hideUnscheduled = Boolean(settings.hideUnscheduled);
  state.conflictsOnly = Boolean(settings.conflictsOnly);
}

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(settingsKey(state.profile.slug));
    if (raw) applySettings(JSON.parse(raw));
  } catch (error) { console.warn('Não foi possível carregar preferências locais.', error); }
}

function applyUrlSettings() {
  const params = new URLSearchParams(location.search);
  const days = (params.get('dias') || '').split(',').filter(day => DAYS.includes(day));
  if (days.length) state.selectedDays = new Set(days);
  if (params.has('status')) {
    const statuses = (params.get('status') || '').split('|').map(normalizeDecision).filter(status => STATUS_OPTIONS.includes(status));
    state.visibleStatuses = new Set(statuses);
  }
  if (['list', 'grid'].includes(params.get('vista'))) state.view = params.get('vista');
  if (params.has('q')) state.search = params.get('q') || '';
  if (params.has('tag')) state.tag = params.get('tag') || '';
  if (params.has('prioridade')) state.priority = params.get('prioridade') || '';
  if (params.has('aderencia')) state.potential = params.get('aderencia') || '';
  if (params.has('audio')) state.audioRoom = params.get('audio') || '';
  if (params.has('espaco')) state.space = params.get('espaco') || '';
  if (params.has('palco')) state.stage = params.get('palco') || '';
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
  } catch (error) { console.warn('Não foi possível salvar preferências locais.', error); }

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
  if (state.space) url.searchParams.set('espaco', state.space);
  if (state.stage) url.searchParams.set('palco', state.stage);
  if (state.timeMode) url.searchParams.set('tempo', state.timeMode);
  if (state.timeFrom) url.searchParams.set('de', state.timeFrom);
  if (state.timeTo) url.searchParams.set('ate', state.timeTo);
  if (state.hideUnscheduled) url.searchParams.set('semHorario', '1');
  if (state.conflictsOnly) url.searchParams.set('choques', '1');
  history.replaceState({}, '', url);
}
