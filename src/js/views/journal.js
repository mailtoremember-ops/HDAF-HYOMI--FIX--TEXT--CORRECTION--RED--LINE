// journal.js v4.1
// תיקון: datepicker מוצב לפי left של אזור התאריך, לא right

(function () {

  const dateHeb       = document.getElementById('journal-date-heb');
  const dateGreg      = document.getElementById('journal-date-greg');
  const datePrev      = document.getElementById('date-prev');
  const dateNext      = document.getElementById('date-next');
  const datePickerInp = document.getElementById('journal-datepicker');
  const entriesEl     = document.getElementById('journal-entries');

  const fab           = document.getElementById('journal-fab');
  const entryPanel    = document.getElementById('entry-panel');
  const panelOverlay  = document.getElementById('panel-overlay');
  const contentInput  = document.getElementById('new-entry-content');
  const submitBtn     = document.getElementById('entry-submit-btn');
  const catInput      = document.getElementById('new-entry-cat');
  const ratingBtn     = document.getElementById('rating-btn');
  const ratingPopup   = document.getElementById('rating-popup');
  const toneContainer = document.querySelector('#tab-journal .tone-selector');
  const metaToggle    = document.getElementById('meta-toggle');
  const metaRow       = document.getElementById('meta-row');

  const editModal       = document.getElementById('edit-modal');
  const editContent     = document.getElementById('edit-entry-content');
  const editToneSel     = document.getElementById('edit-tone-selector');
  const editRatingBtn   = document.getElementById('edit-rating-btn');
  const editRatingPopup = document.getElementById('edit-rating-popup');
  const editCatInput    = document.getElementById('edit-entry-cat');
  const editSaveBtn     = document.getElementById('edit-save-btn');
  const editCancelBtn   = document.getElementById('edit-cancel-btn');

  let currentDate  = new Date();
  let allEntries   = [];
  let newTone      = null;
  let newRating    = null;
  let panelOpen    = false;
  let metaOpen     = false;
  let editingEntry = null;
  let editTone     = null;
  let editRating   = null;

  function dateKey(d) { return d.toISOString().slice(0, 10); }

  function selectedDateISO() {
    const now = new Date();
    const d   = new Date(currentDate);
    d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
    return d.toISOString();
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }

  let initialized = false;
  function initOnce() {
    if (initialized) return;
    initialized = true;

    window.initToneSelector(toneContainer, t => { newTone = t; });
    window.initRatingPopup(ratingBtn, ratingPopup, v => { newRating = v; });
    window.initToneSelector(editToneSel, t => { editTone = t; });
    window.initRatingPopup(editRatingBtn, editRatingPopup, v => { editRating = v; });

    // date-prev (ימין) = יום קודם, date-next (שמאל) = יום הבא
    datePrev.addEventListener('click', () => navigate(-1));
    dateNext.addEventListener('click', () => navigate(+1));

    // datepicker — לחיצה על אזור התאריך
    const dateNavCenter = document.querySelector('.date-nav-center');
    dateNavCenter.addEventListener('click', openDatePicker);

    datePickerInp.addEventListener('change', e => {
      const val = e.target.value;
      if (!val) return;
      const chosen = new Date(val + 'T12:00:00');
      if (dateKey(chosen) > dateKey(new Date())) return;
      currentDate = chosen;
      // מחזיר datepicker למצב נסתר
      datePickerInp.style.pointerEvents = 'none';
      datePickerInp.style.width  = '1px';
      datePickerInp.style.height = '1px';
      renderDate();
      renderEntries();
    });

    fab.addEventListener('click', togglePanel);
    panelOverlay.addEventListener('click', closePanel);

    metaToggle.addEventListener('click', e => {
      e.stopPropagation();
      metaOpen = !metaOpen;
      metaRow.classList.toggle('hidden', !metaOpen);
      metaToggle.classList.toggle('active', metaOpen);
    });

    contentInput.addEventListener('input', () => autoResize(contentInput));

    // Enter = שורה חדשה בלבד, שליחה רק עם כפתור
    submitBtn.addEventListener('click', addEntry);

    editSaveBtn.addEventListener('click',  saveEdit);
    editCancelBtn.addEventListener('click', closeEdit);
    editModal.addEventListener('click', e => {
      if (e.target === editModal) closeEdit();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panelOpen) closePanel();
    });
  }

  // ── datepicker — מוצב מתחת לאזור התאריך ──────────────────
  function openDatePicker() {
    const center = document.querySelector('.date-nav-center');
    const rect   = center.getBoundingClientRect();

    // מרכז ה-datepicker מתחת לאזור התאריך
    const midX = rect.left + rect.width / 2;

    datePickerInp.style.position      = 'fixed';
    datePickerInp.style.top           = rect.bottom + 'px';
    datePickerInp.style.left          = midX + 'px';
    datePickerInp.style.width         = '0';
    datePickerInp.style.height        = '0';
    datePickerInp.style.opacity       = '0';
    datePickerInp.style.pointerEvents = 'auto';

    datePickerInp.max   = dateKey(new Date());
    datePickerInp.value = dateKey(currentDate);

    // showPicker מציב את הפופאפ ליד ה-input עצמו
    try {
      datePickerInp.showPicker();
    } catch {
      datePickerInp.click();
    }
  }

  // ── panel ────────────────────────────────────────────────────
  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  function openPanel() {
    panelOpen = true;
    entryPanel.classList.remove('panel-hidden');
    panelOverlay.classList.remove('hidden');
    fab.classList.add('fab-open');
    contentInput.value        = '';
    contentInput.style.height = 'auto';
    catInput.value            = '';
    newTone                   = null;
    newRating                 = null;
    metaOpen                  = false;
    metaRow.classList.add('hidden');
    metaToggle.classList.remove('active');
    toneContainer.querySelectorAll('.tone-btn').forEach(b => b.className = 'tone-btn');
    window.setRatingBtn(ratingBtn, null);
    setTimeout(() => contentInput.focus(), 50);
  }

  function closePanel() {
    panelOpen = false;
    entryPanel.classList.add('panel-hidden');
    panelOverlay.classList.add('hidden');
    fab.classList.remove('fab-open');
  }

  async function load() {
    initOnce();
    try { allEntries = await API.getEntries(); }
    catch (e) { console.error('journal load:', e); allEntries = []; }
    renderDate();
    renderEntries();
  }

  function navigate(delta) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + delta);
    if (dateKey(d) > dateKey(new Date())) return;
    currentDate = d;
    renderDate();
    renderEntries();
  }

  function renderDate() {
    const isToday = dateKey(currentDate) === dateKey(new Date());
    dateHeb.textContent    = window.toHebrewDate(currentDate);
    dateGreg.textContent   = window.toGregorianShort(currentDate);
    dateNext.disabled      = isToday;
    dateNext.style.opacity = isToday ? '.3' : '1';
  }

  function renderEntries() {
    const key    = dateKey(currentDate);
    const todays = allEntries.filter(e => e.created_at.slice(0, 10) === key);
    entriesEl.innerHTML = '';
    if (todays.length === 0) {
      entriesEl.innerHTML =
        '<div class="empty-state">אין רשומות להיום.<br>לחץ על + כדי להוסיף.</div>';
      return;
    }
    todays.forEach(entry => entriesEl.appendChild(buildCard(entry)));
  }

  function buildCard(entry) {
    const card = document.createElement('div');
    card.className  = 'entry-card' + (entry.tone ? ` tone-${entry.tone}` : '');
    card.dataset.id = entry.id;

    const meta = document.createElement('div');
    meta.className = 'entry-meta';

    if (entry.tone) {
      const map = { positive: 'חיובי', neutral: 'ניטרלי', negative: 'שלילי' };
      const tag = document.createElement('span');
      tag.className   = `tag tag-tone-${entry.tone}`;
      tag.textContent = map[entry.tone];
      meta.appendChild(tag);
    }
    if (entry.rating != null) {
      const tag = document.createElement('span');
      tag.className   = 'tag tag-rating';
      tag.textContent = entry.rating;
      meta.appendChild(tag);
    }
    if (entry.category) {
      const tag = document.createElement('span');
      tag.className   = 'tag';
      tag.textContent = entry.category;
      meta.appendChild(tag);
    }

    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const editBtn = document.createElement('button');
    editBtn.className     = 'btn btn-ghost';
    editBtn.style.cssText = 'padding:.2rem .5rem;font-size:.78rem;';
    editBtn.textContent   = '✎';
    editBtn.addEventListener('click', () => openEdit(entry));

    const delBtn = document.createElement('button');
    delBtn.className   = 'btn-danger btn';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => deleteEntry(entry.id));

    actions.append(editBtn, delBtn);

    const content = document.createElement('div');
    content.className   = 'entry-content';
    content.textContent = entry.content;

    card.append(actions, meta, content);
    return card;
  }

  async function addEntry() {
    const text = contentInput.value.trim();
    if (!text) { contentInput.focus(); return; }
    submitBtn.disabled = true;
    try {
      const isToday   = dateKey(currentDate) === dateKey(new Date());
      const createdAt = isToday ? undefined : selectedDateISO();
      const entry = await API.createEntry(
        { content: text, tone: newTone || null,
          rating: newRating || null, category: catInput.value.trim() || null },
        createdAt
      );
      allEntries.push(entry);
      allEntries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      closePanel();
      renderEntries();
      setTimeout(() =>
        entriesEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50
      );
    } catch (e) {
      alert('שגיאה בהוספת רשומה: ' + e);
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function deleteEntry(id) {
    if (!await confirmDialog('למחוק את הרשומה?')) return;

    try {
      await API.deleteEntry(id);
      allEntries = allEntries.filter(e => e.id !== id);
      renderEntries();
    } catch (e) { alert('שגיאה במחיקה: ' + e); }
  }

  function openEdit(entry) {
    editingEntry       = entry;
    editTone           = entry.tone   || null;
    editRating         = entry.rating || null;
    editContent.value  = entry.content;
    editCatInput.value = entry.category || '';
    window.setToneSelector(editToneSel, editTone);
    window.setRatingBtn(editRatingBtn, editRating);
    editModal.classList.remove('hidden');
    editContent.focus();
  }

  function closeEdit() {
    editModal.classList.add('hidden');
    editingEntry = null;
  }

  async function saveEdit() {
    if (!editingEntry) return;
    const text = editContent.value.trim();
    if (!text) return;
    editSaveBtn.disabled = true;
    try {
      const updated = await API.updateEntry({
        id: editingEntry.id, content: text,
        tone: editTone || null, rating: editRating || null,
        category: editCatInput.value.trim() || null,
      });
      const idx = allEntries.findIndex(e => e.id === updated.id);
      if (idx !== -1) allEntries[idx] = updated;
      closeEdit();
      renderEntries();
    } catch (e) {
      alert('שגיאה בשמירה: ' + e);
    } finally {
      editSaveBtn.disabled = false;
    }
  }

  window.JournalView = { load };

})();
