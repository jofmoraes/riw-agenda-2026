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
    <label class="decision-field modal-decision-field">
      <span>Nível de interesse</span>
      <select class="modal-select" aria-label="Nível de interesse">${decisionOptions(decision(event))}</select>
    </label>
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
if (el('profileCriteriaButton')) el('profileCriteriaButton').onclick = openProfileChooser;
if (el('profileClose')) el('profileClose').onclick = () => el('profileBackdrop').classList.remove('open');
if (el('installAction')) el('installAction').onclick = requestAppInstall;
if (el('installDismiss')) el('installDismiss').onclick = dismissInstallSuggestion;
if (el('saveApiUrl')) el('saveApiUrl').onclick = saveBackendUrl;
if (el('apiUrlInput')) el('apiUrlInput').addEventListener('keydown', event => { if (event.key === 'Enter') saveBackendUrl(); });
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

syncStandaloneMode();
loadData(initialProfileSlug());
