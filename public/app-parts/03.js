function overlaps(a, b) {
  const aStart = parseTime(a.start);
  const aEnd = parseTime(a.end) ?? (aStart == null ? null : aStart + (a.duration || 45));
  const bStart = parseTime(b.start);
  const bEnd = parseTime(b.end) ?? (bStart == null ? null : bStart + (b.duration || 45));
  return aStart != null && bStart != null && aStart < bEnd && bStart < aEnd;
}

function hasConflict(event, candidates = state.events) {
  // Conflito é sempre recalculado a partir das decisões atuais do usuário.
  // O antigo conflictGroup da planilha é apenas histórico e não deve manter
  // um conflito depois que uma das palestras passa para Não vou, Talvez etc.
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
