function selectProfile(slug) {
  setProfileUrl(slug, true);
  localStorage.setItem(LAST_PROFILE_KEY, slug);
  el('profileBackdrop').classList.remove('open');
  loadData(slug);
}

function renderProfileChooser(force = false) {
  const profiles = Array.isArray(state.profiles) ? state.profiles : [];
  if (!state.profileCandidateSlug && state.profile) state.profileCandidateSlug = state.profile.slug;
  el('profileGrid').innerHTML = profiles.length ? profiles.map(profile => {
    const current = Boolean(state.profile && profile.slug === state.profile.slug);
    const previewed = state.profileCandidateSlug === profile.slug;
    return `
      <article class="profile-card ${previewed ? 'selected' : ''} ${current ? 'current' : ''}">
        <button class="profile-card-main" type="button" data-profile-preview="${esc(profile.slug)}" aria-expanded="${previewed}">
          <span class="profile-card-copy"><strong>${esc(profile.name || profile.label)}</strong><span class="profile-status">${esc(profile.curationStatus || '')}</span><span class="profile-preview-hint">${previewed ? 'Interesses exibidos abaixo' : 'Toque para ver os interesses considerados'}</span></span>
          <span class="profile-card-chevron">${previewed ? '⌃' : '⌄'}</span>
        </button>
        ${previewed ? `<div class="profile-preview">${profile.interests ? `<div class="profile-interests"><b>Interesses de referência:</b><br>${esc(profile.interests)}</div>` : '<div class="profile-interests">Interesses ainda não cadastrados.</div>'}<button class="profile-confirm" type="button" data-profile-confirm="${esc(profile.slug)}">${current ? 'Continuar com este perfil' : 'Usar este perfil'}</button></div>` : ''}
      </article>`;
  }).join('') : '<div class="loading">Carregando perfis…</div>';

  el('profileGrid').querySelectorAll('[data-profile-preview]').forEach(button => {
    button.onclick = () => { state.profileCandidateSlug = button.dataset.profilePreview; renderProfileChooser(true); };
  });
  el('profileGrid').querySelectorAll('[data-profile-confirm]').forEach(button => { button.onclick = () => selectProfile(button.dataset.profileConfirm); });
  if (el('profileClose')) el('profileClose').hidden = !state.profile;
  if (force || !state.profile) el('profileBackdrop').classList.add('open');
}

function openProfileChooser() {
  state.profileCandidateSlug = state.profile ? state.profile.slug : '';
  renderProfileChooser(true);
  if (Array.isArray(state.profiles) && state.profiles.length) return;
  apiCall('getProfiles').then(profiles => {
    state.profiles = Array.isArray(profiles) ? profiles : [];
    if (!state.profiles.length) { el('profileGrid').innerHTML = '<div class="error">Não foi possível carregar os perfis.</div>'; return; }
    renderProfileChooser(true);
  }).catch(error => { el('profileGrid').innerHTML = `<div class="error">${esc(error.message || error)}</div>`; });
}

function hydrateLoadedData(data) {
  state.profiles = data.profiles || [];
  state.profile = data.selectedProfile || null;
  state.events = (data.events || []).map(event => ({...event, decision: normalizeDecision(event.decision)}));
  if (!state.profile) { renderProfileChooser(true); return; }

  const label = state.profile.label || state.profile.name || 'Perfil';
  el('profileTitle').textContent = `Agenda de ${label}`;
  el('profileName').textContent = label;
  el('profileInitial').textContent = label.trim().charAt(0).toUpperCase() || 'P';
  if (el('profileCriteriaButton')) { el('profileCriteriaButton').hidden = false; el('profileCriteriaButton').textContent = 'Interesses considerados'; }

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
  apiCall('getAppData', {profile: slug}).then(data => {
    cacheProfileData(slug, data);
    hydrateLoadedData(data);
  }).catch(error => {
    const cached = cachedProfileData(slug);
    if (cached) {
      hydrateLoadedData(cached);
      const warning = document.createElement('div'); warning.className = 'error'; warning.textContent = `Modo offline: ${error.message || error}`; el('content').prepend(warning); return;
    }
    el('content').innerHTML = `<div class="error">${esc(error.message || error)}</div>`;
  });
}

function populateFilterOptions() {
  const rooms = uniqueSorted(state.events.map(event => event.audioRoom));
  const tags = uniqueSorted(state.events.flatMap(event => splitTags(event.tags)));
  const spaces = uniqueSorted(state.events.map(event => event.space));
  const stages = uniqueSorted(state.events.map(event => event.stage));
  el('audioRoom').innerHTML = '<option value="">Todas as salas</option>' + rooms.map(room => `<option value="${esc(room)}">${esc(room)}</option>`).join('');
  el('tagFilter').innerHTML = '<option value="">Todas as tags</option>' + tags.map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`).join('');
  el('spaceFilter').innerHTML = '<option value="">Todos os espaços</option>' + spaces.map(space => `<option value="${esc(space)}">${esc(space)}</option>`).join('');
  el('stageFilter').innerHTML = '<option value="">Todos os palcos</option>' + stages.map(stage => `<option value="${esc(stage)}">${esc(stage)}</option>`).join('');
}

function syncControls() {
  el('search').value = state.search;
  el('tagFilter').value = state.tag;
  el('priority').value = state.priority;
  el('potential').value = state.potential;
  el('audioRoom').value = state.audioRoom;
  el('spaceFilter').value = state.space;
  el('stageFilter').value = state.stage;
  el('timeMode').value = state.timeMode;
  el('timeFrom').value = state.timeFrom;
  el('timeTo').value = state.timeTo;
  const searchHint = el('searchHint');
  if (searchHint) searchHint.hidden = !state.search;
}

function renderDayPicker() {
  const all = state.selectedDays.size === DAYS.length;
  el('dayPicker').innerHTML = `<button class="day-button ${all ? 'active' : ''}" type="button" data-all>Todos</button>${DAYS.map(day => `<button class="day-button ${state.selectedDays.has(day) ? 'active' : ''}" type="button" data-day="${day}">${day}</button>`).join('')}`;
  el('dayPicker').querySelector('[data-all]').onclick = () => { state.selectedDays = all ? new Set([defaultDayForEvents(state.events)]) : new Set(DAYS); render(); };
  el('dayPicker').querySelectorAll('[data-day]').forEach(button => {
    button.onclick = () => {
      const day = button.dataset.day;
      if (state.selectedDays.has(day) && state.selectedDays.size > 1) state.selectedDays.delete(day);
      else if (!state.selectedDays.has(day)) state.selectedDays.add(day);
      render();
    };
  });
}

function statusCssClass(status) {
  const map = {'Quero ir':'status-go','Alto Interesse':'status-high','Interesse':'status-interest','Talvez':'status-maybe','Reavaliar':'status-review','Assistir online':'status-online','Não vou':'status-no','Não analisado':'status-unreviewed'};
  return map[normalizeDecision(status)] || 'status-unreviewed';
}

function renderStatuses() {
  el('statusChecks').innerHTML = STATUS_OPTIONS.map(status => `<label class="status-check ${statusCssClass(status)}"><input type="checkbox" value="${esc(status)}" ${state.visibleStatuses.has(status) ? 'checked' : ''}>${esc(status)}</label>`).join('');
  el('statusChecks').querySelectorAll('input').forEach(input => {
    input.onchange = () => { if (input.checked) state.visibleStatuses.add(input.value); else state.visibleStatuses.delete(input.value); state.reviewMode = false; render(); };
  });
  const allSelected = STATUS_OPTIONS.every(status => state.visibleStatuses.has(status));
  const interestSelected = INTEREST_STATUS_OPTIONS.every(status => state.visibleStatuses.has(status)) && !state.visibleStatuses.has('Não vou') && !state.visibleStatuses.has('Não analisado');
  el('toggleAllStatuses').textContent = allSelected ? 'Limpar seleção' : 'Todos';
  if (el('selectInterestStatuses')) el('selectInterestStatuses').classList.toggle('active', interestSelected);
}
