'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let admin = null, timer, editing, deleting, loading = false, sessionVersion = 0;
  let pendingRegistration = null, receipt = null, participationBusy = false;
  const setStatus = (id, text, kind = 'error') => { const e = $(id); e.textContent = text; e.dataset.kind = kind; };
  const churchText = value => value.trim().replace(/\s+/g, ' ');
  const validChurch = value => value.length >= 1 && value.length <= 100 && !/[\p{C}<>]/u.test(value);
  const validCount = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1000;
  async function api(route, options = {}) {
    const response = await fetch('/api/' + route, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await response.json().catch(() => null);
    if (!response.ok) { const error = new Error(data?.error || 'Не удалось выполнить запрос. Повторите попытку.'); error.status = response.status; throw error; }
    return data;
  }
  const send = (route, data, method = 'POST') => api(route, { method, body: JSON.stringify(data) });
  const networkError = error => error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Не удалось получить ответ. Проверьте интернет и повторите попытку.' : error.message;
  function finishRegistration() {
    setStatus('rsvp-status', 'Спасибо! Ваше участие подтверждено.', 'success');
    $('rsvp-button').textContent = 'Участие подтверждено';
  }
  $('rsvp-form').addEventListener('submit', async e => {
    e.preventDefault(); if ($('rsvp-button').disabled) return;
    const church = churchText($('church').value), children_count = Number($('children').value);
    if (!validChurch(church) || !validCount(children_count)) { setStatus('rsvp-status', 'Укажите церковь и целое количество детей от 1 до 1000.'); return; }
    if (!pendingRegistration || pendingRegistration.church !== church || pendingRegistration.children_count !== children_count) pendingRegistration = { church, children_count, request_id: crypto.randomUUID() };
    const button = $('rsvp-button'); button.disabled = true; button.textContent = 'Сохраняем…'; setStatus('rsvp-status', '');
    try {
      receipt = await send('register', { ...pendingRegistration, website: e.target.elements.website.value });
      $('church').disabled = true; $('children').disabled = true; pendingRegistration = null;
      button.textContent = 'Заявка сохранена'; setStatus('participation-status', ''); $('participation-dialog').showModal(); $('participation').focus();
    } catch (error) { setStatus('rsvp-status', networkError(error) + ' При повторной попытке та же заявка не дублируется.'); button.disabled = false; button.textContent = 'Мы придём'; }
  });
  function lockParticipation(value) {
    participationBusy = value; $('save-participation').disabled = value; $('skip-participation').disabled = value; $('participation').disabled = value;
  }
  $('participation-form').addEventListener('submit', async e => {
    e.preventDefault(); if (!receipt || participationBusy) return;
    const text = $('participation').value.trim();
    if (!text) { setStatus('participation-status', 'Напишите об участии или нажмите «Пропустить».'); return; }
    lockParticipation(true); setStatus('participation-status', '');
    try { await send('participation', { ...receipt, participation: text }); $('participation-dialog').close(); finishRegistration(); }
    catch (error) { setStatus('participation-status', networkError(error) + ' Основная заявка уже сохранена.'); }
    finally { lockParticipation(false); }
  });
  $('skip-participation').addEventListener('click', async () => {
    if (!receipt || participationBusy) return;
    lockParticipation(true); setStatus('participation-status', '');
    // Explicitly clear optional text if an earlier save succeeded but its response was lost.
    try { await send('participation', { ...receipt, participation: null }); $('participation-dialog').close(); finishRegistration(); }
    catch (error) { setStatus('participation-status', networkError(error) + ' Основная заявка сохранена. Повторите пропуск.'); }
    finally { lockParticipation(false); }
  });
  $('participation-dialog').addEventListener('cancel', e => {
    if (participationBusy) e.preventDefault();
    // Escape before any save closes the optional step, leaving the original NULL value.
  });
  $('participation-dialog').addEventListener('close', finishRegistration);
  function clearSession() {
    sessionVersion++; admin = null; clearInterval(timer); timer = null;
    $('dashboard').hidden = true; $('login-form').hidden = false; $('requests').replaceChildren();
    for (const id of ['total-children', 'total-requests', 'total-participation']) $(id).textContent = '0';
    $('admin-name').textContent = ''; $('password').value = ''; $('last-updated').textContent = '';
    $('edit-dialog').close(); $('delete-dialog').close();
  }
  function startPolling() { clearInterval(timer); timer = setInterval(() => { if ($('admin-dialog').open && admin && !document.hidden && !$('edit-dialog').open && !$('delete-dialog').open) loadRequests(); }, 20000); }
  function showAdmin(data) { admin = data.admin; $('admin-name').textContent = admin.display_name; $('password').value = ''; $('login-form').hidden = true; $('dashboard').hidden = false; startPolling(); }
  function renderRequests(rows, totals) {
    const fragment = document.createDocumentFragment();
    const format = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const [i, text] of [row.church, String(row.children_count), row.participation || '—', format.format(new Date(row.created_at))].entries()) { const td = document.createElement('td'); td.textContent = text; if (i === 2) td.className = 'participation-cell'; tr.append(td); }
      const actions = document.createElement('td'), wrap = document.createElement('div'); wrap.className = 'row-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'row-button'; edit.textContent = 'Изменить'; edit.setAttribute('aria-label', 'Изменить заявку: ' + row.church);
      edit.addEventListener('click', () => { editing = row; $('edit-church').value = row.church; $('edit-children').value = row.children_count; $('edit-participation').value = row.participation || ''; setStatus('edit-status', ''); $('edit-dialog').showModal(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'row-button'; remove.textContent = 'Удалить'; remove.setAttribute('aria-label', 'Удалить заявку: ' + row.church);
      remove.addEventListener('click', () => { deleting = row; $('delete-description').textContent = row.church + ' · детей: ' + row.children_count; setStatus('delete-status', ''); $('delete-dialog').showModal(); });
      wrap.append(edit, remove); actions.append(wrap); tr.append(actions); fragment.append(tr);
    }
    $('requests').replaceChildren(fragment); $('empty').hidden = rows.length > 0;
    $('total-children').textContent = totals.children.toLocaleString('ru-RU'); $('total-requests').textContent = totals.requests.toLocaleString('ru-RU'); $('total-participation').textContent = totals.participation.toLocaleString('ru-RU');
    $('last-updated').textContent = 'Обновлено: ' + format.format(new Date()) + ' · автообновление каждые 20 секунд';
  }
  async function loadRequests() {
    if (loading || !admin) return; const version = sessionVersion;
    loading = true; $('refresh').disabled = true;
    try {
      const rows = []; let totals;
      for (let offset = 0; ; offset += 100) { const part = await api('registrations?offset=' + offset); rows.push(...part.rows); totals = part.totals; if (part.rows.length < 100) break; }
      if (admin && version === sessionVersion) { renderRequests(rows, totals); setStatus('dashboard-status', ''); }
    } catch (error) {
      if (version !== sessionVersion) return;
      if (error.status === 401) { clearSession(); setStatus('login-status', error.message); }
      else setStatus('dashboard-status', networkError(error) + ' На экране могут быть устаревшие данные.');
    } finally { loading = false; $('refresh').disabled = false; }
  }
  $('open-admin').addEventListener('click', async () => {
    $('admin-dialog').showModal(); setStatus('login-status', ''); const version = sessionVersion;
    try { const data = await api('session'); if (version === sessionVersion) { showAdmin(data); await loadRequests(); } }
    catch (error) { if (version !== sessionVersion) return; clearSession(); if (error.status !== 401) setStatus('login-status', networkError(error)); $('email').focus(); }
  });
  $('close-admin').addEventListener('click', () => $('admin-dialog').close());
  $('admin-dialog').addEventListener('close', () => { clearInterval(timer); $('password').value = ''; });
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault(); if ($('login-button').disabled) return;
    $('login-button').disabled = true; setStatus('login-status', '');
    try { showAdmin(await send('login', { email: $('email').value.trim(), password: $('password').value })); await loadRequests(); }
    catch (error) { clearSession(); setStatus('login-status', networkError(error)); }
    finally { $('login-button').disabled = false; }
  });
  $('logout').addEventListener('click', async () => {
    if ($('logout').disabled) return; $('logout').disabled = true;
    try { await send('logout', {}); clearSession(); setStatus('login-status', 'Вы вышли из кабинета.', 'success'); }
    catch (error) { setStatus('dashboard-status', 'Выход не подтверждён сервером. ' + networkError(error)); }
    finally { $('logout').disabled = false; }
  });
  $('refresh').addEventListener('click', loadRequests);
  $('close-edit').addEventListener('click', () => $('edit-dialog').close());
  $('edit-form').addEventListener('submit', async e => {
    e.preventDefault(); if (!editing || $('save-edit').disabled) return;
    const church = churchText($('edit-church').value), children_count = Number($('edit-children').value);
    if (!validChurch(church) || !validCount(children_count)) { setStatus('edit-status', 'Проверьте церковь и количество детей.'); return; }
    $('save-edit').disabled = true; setStatus('edit-status', '');
    try { await send('registrations', { id: editing.id, church, children_count, participation: $('edit-participation').value.trim() || null }, 'PATCH'); $('edit-dialog').close(); await loadRequests(); }
    catch (error) { setStatus('edit-status', networkError(error)); } finally { $('save-edit').disabled = false; }
  });
  $('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
  $('confirm-delete').addEventListener('click', async () => {
    if (!deleting || $('confirm-delete').disabled) return; $('confirm-delete').disabled = true; setStatus('delete-status', '');
    try { await send('registrations', { id: deleting.id }, 'DELETE'); $('delete-dialog').close(); await loadRequests(); }
    catch (error) { setStatus('delete-status', networkError(error)); } finally { $('confirm-delete').disabled = false; }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && admin && $('admin-dialog').open) loadRequests(); });
})();
