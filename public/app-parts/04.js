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
          <label class="decision-field">
            <span>Nível de interesse</span>
            <select class="decision-select" aria-label="Nível de interesse">${decisionOptions(decision(event))}</select>
          </label>
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
