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
