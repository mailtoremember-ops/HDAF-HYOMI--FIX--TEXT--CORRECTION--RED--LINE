// notes.js v3 — ללא כפתור שמור, auto-save בלבד עם פידבק

(function () {

  const notesList      = document.getElementById('notes-list');
  const addNoteBtn     = document.getElementById('add-note-btn');
  const noteEmpty      = document.getElementById('note-empty');
  const noteEditArea   = document.getElementById('note-edit-area');
  const noteTitleInp   = document.getElementById('note-title');
  const noteContentInp = document.getElementById('note-content');
  const deleteNoteBtn  = document.getElementById('delete-note-btn');
  const sidebarToggle  = document.getElementById('sidebar-toggle');
  const notesLayout    = document.querySelector('.notes-layout');
  const notesSidebar   = document.querySelector('.notes-sidebar');
  const saveIndicator  = document.getElementById('save-indicator');

  let notes       = [];
  let activeId    = null;
  let saveTimer   = null;
  let isDirty     = false;
  let sidebarOpen = true;

  let initialized = false;
  function initOnce() {
    if (initialized) return;
    initialized = true;

    addNoteBtn.addEventListener('click',    createNote);
    deleteNoteBtn.addEventListener('click', deleteActive);

    noteTitleInp.addEventListener('input',   markDirty);
    noteContentInp.addEventListener('input', markDirty);

    sidebarToggle.addEventListener('click', toggleSidebar);

    // Ctrl+S — שמירה מיידית
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 's') {
        const tab = document.getElementById('tab-notes');
        if (!tab.classList.contains('hidden')) {
          e.preventDefault();
          saveActive(true);
        }
      }
    });
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    notesSidebar.style.display            = sidebarOpen ? '' : 'none';
    notesLayout.style.gridTemplateColumns = sidebarOpen ? '220px 1fr' : '1fr';
    sidebarToggle.textContent = sidebarOpen ? '◀' : '▶';
    sidebarToggle.title       = sidebarOpen ? 'סגור רשימה' : 'פתח רשימה';
  }

  async function load() {
    initOnce();
    try { notes = await API.getNotes(); }
    catch (e) { console.error('notes load:', e); notes = []; }
    renderList();
    if (activeId && notes.find(n => n.id === activeId)) openNote(activeId);
    else showEmpty();
  }

  function renderList() {
    notesList.innerHTML = '';
    if (notes.length === 0) {
      notesList.innerHTML =
        '<div style="padding:.8rem;font-size:.82rem;color:var(--text-muted);text-align:center;">אין רשימות עדיין</div>';
      return;
    }
    notes.forEach(note => {
      const item  = document.createElement('div');
      item.className  = 'note-list-item' + (note.id === activeId ? ' active' : '');
      item.dataset.id = note.id;

      const title = document.createElement('span');
      title.className   = 'note-list-title';
      title.textContent = note.title || 'ללא כותרת';

      const del = document.createElement('button');
      del.className   = 'btn-danger btn';
      del.textContent = '✕';
      del.title       = 'מחיקה';
      del.style.cssText = 'font-size:.72rem;padding:.15rem .35rem;opacity:0;transition:opacity 150ms;flex-shrink:0;';

      item.addEventListener('mouseenter', () => del.style.opacity = '1');
      item.addEventListener('mouseleave', () => del.style.opacity = '0');

      del.addEventListener('click', async e => {
        e.stopPropagation();
if (!await confirmDialog('למחוק את הרשומה?')) return;
        await deleteNote(note.id);
      });

      item.addEventListener('click', async () => {
        if (isDirty) await saveActive(false);
        openNote(note.id);
      });

      item.append(title, del);
      notesList.appendChild(item);
    });
  }

  function openNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) { showEmpty(); return; }
    activeId             = id;
    isDirty              = false;
    noteTitleInp.value   = note.title;
    noteContentInp.value = note.content;
    noteEmpty.classList.add('hidden');
    noteEditArea.classList.remove('hidden');
    noteEditArea.style.display = 'flex';
    notesList.querySelectorAll('.note-list-item').forEach(el =>
      el.classList.toggle('active', parseInt(el.dataset.id, 10) === id)
    );
    hideSaveIndicator();
    noteContentInp.focus();
  }

  function showEmpty() {
    activeId = null;
    isDirty  = false;
    noteEmpty.classList.remove('hidden');
    noteEditArea.classList.add('hidden');
    notesList.querySelectorAll('.note-list-item').forEach(el =>
      el.classList.remove('active')
    );
  }

  async function createNote() {
    if (isDirty) await saveActive(false);
    try {
      const note = await API.createNote({ title: 'רשימה חדשה', content: '' });
      notes.unshift(note);
      renderList();
      openNote(note.id);
      noteTitleInp.select();
    } catch (e) {
      alert('שגיאה ביצירת רשימה: ' + e);
    }
  }

  function markDirty() {
    isDirty = true;
    hideSaveIndicator();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveActive(true), 1500);
  }

  async function saveActive(showFeedback = false) {
    if (!activeId || !isDirty) return;
    clearTimeout(saveTimer);

    const title   = noteTitleInp.value.trim() || 'ללא כותרת';
    const content = noteContentInp.value;

    try {
      const updated = await API.updateNote({ id: activeId, title, content });
      const idx = notes.findIndex(n => n.id === activeId);
      if (idx !== -1) { notes.splice(idx, 1); notes.unshift(updated); }
      isDirty = false;
      renderList();
      notesList.querySelectorAll('.note-list-item').forEach(el =>
        el.classList.toggle('active', parseInt(el.dataset.id, 10) === activeId)
      );
      if (showFeedback) showSaveIndicator();
    } catch (e) {
      console.error('saveActive:', e);
    }
  }

  let indicatorTimer = null;
  function showSaveIndicator() {
    saveIndicator.classList.remove('hidden');
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(hideSaveIndicator, 2000);
  }
  function hideSaveIndicator() { saveIndicator.classList.add('hidden'); }

  async function deleteActive() {
    if (!activeId) return;
    const note = notes.find(n => n.id === activeId);
    if (!await confirmDialog('למחוק את הרשומה?')) return;
    await deleteNote(activeId);
  }

  async function deleteNote(id) {
    try {
      await API.deleteNote(id);
      notes = notes.filter(n => n.id !== id);
      if (activeId === id) {
        isDirty = false;
        notes.length > 0 ? openNote(notes[0].id) : showEmpty();
      }
      renderList();
    } catch (e) {
      alert('שגיאה במחיקה: ' + e);
    }
  }

  window.NotesView = { load };

})();
