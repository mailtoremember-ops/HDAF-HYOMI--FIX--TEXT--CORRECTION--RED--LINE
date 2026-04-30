// history.js v3 — חיפוש לפי טון, פריסה מקצועית

(function () {

  const searchText  = document.getElementById('search-text');
  const searchCat   = document.getElementById('search-cat');
  const searchTone  = document.getElementById('search-tone');
  const searchFrom  = document.getElementById('search-from');
  const searchTo    = document.getElementById('search-to');
  const clearBtn    = document.getElementById('search-clear');
  const container   = document.getElementById('history-entries');

  let searchTimer = null;

  let initialized = false;
  function initOnce() {
    if (initialized) return;
    initialized = true;

    searchText.addEventListener('input',  () => debounceSearch());
    searchCat.addEventListener('input',   () => debounceSearch());
    searchTone.addEventListener('change', () => doSearch());
    searchFrom.addEventListener('change', () => doSearch());
    searchTo.addEventListener('change',   () => doSearch());

    clearBtn.addEventListener('click', () => {
      searchText.value  = '';
      searchCat.value   = '';
      searchTone.value  = '';
      searchFrom.value  = '';
      searchTo.value    = '';
      doSearch();
    });
  }

  function debounceSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 300);
  }

  async function load() {
    initOnce();
    await doSearch();
  }

  async function doSearch() {
    container.innerHTML = '<div class="empty-state">טוען...</div>';
    const params = {
      query:    searchText.value.trim() || null,
      category: searchCat.value.trim()  || null,
      dateFrom: searchFrom.value        || null,
      dateTo:   searchTo.value          || null,
    };
    try {
      let entries = await API.searchEntries(params);

      // סינון טון בצד ה-JS (שדה לא מוצפן)
      const tone = searchTone.value;
      if (tone) {
        entries = entries.filter(e => e.tone === tone);
      }

      render(entries);
    } catch (e) {
      container.innerHTML = `<div class="empty-state">שגיאה: ${e}</div>`;
    }
  }

  function render(entries) {
    container.innerHTML = '';
    if (entries.length === 0) {
      container.innerHTML = '<div class="empty-state">לא נמצאו רשומות.</div>';
      return;
    }
    const groups = groupByDate(entries);
    groups.forEach(({ date, items }) => {
      const header = document.createElement('div');
      header.className = 'date-header';
      const hebSpan = document.createElement('span');
      hebSpan.className   = 'date-header-heb';
      hebSpan.textContent = window.toHebrewDate(date);
      const gregSpan = document.createElement('span');
      gregSpan.className   = 'date-header-greg';
      gregSpan.textContent = window.toGregorianShort(date);
      header.append(hebSpan, gregSpan);
      container.appendChild(header);
      items.forEach(entry => container.appendChild(buildCard(entry)));
    });
  }

  function groupByDate(entries) {
    const map = new Map();
    entries.forEach(e => {
      const key = e.created_at.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    });
    return Array.from(map.entries()).map(([key, items]) => ({
      date: new Date(key + 'T12:00:00'),
      items,
    }));
  }

  function buildCard(entry) {
    const card = document.createElement('div');
    card.className = 'entry-card' + (entry.tone ? ` tone-${entry.tone}` : '');

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
    const delBtn = document.createElement('button');
    delBtn.className   = 'btn-danger btn';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => deleteEntry(entry.id));
    actions.appendChild(delBtn);

    const content = document.createElement('div');
    content.className   = 'entry-content';
    content.textContent = entry.content;

    card.append(actions, meta, content);
    return card;
  }

  async function deleteEntry(id) {
    if (!await confirmDialog('למחוק את הרשומה?')) return;
    try {
      await API.deleteEntry(id);
      await doSearch();
    } catch (e) {
      alert('שגיאה במחיקה: ' + e);
    }
  }

  window.HistoryView = { load };

})();
