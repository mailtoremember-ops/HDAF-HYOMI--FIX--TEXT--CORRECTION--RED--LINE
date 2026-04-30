// mock.js v2 — קטגוריה כטקסט חופשי, ללא טבלת categories

(function () {
  if (window.__TAURI__) return;

  const DB = {
    get: (k) => { try { return JSON.parse(localStorage.getItem('mock_' + k)); } catch { return null; } },
    set: (k, v) => localStorage.setItem('mock_' + k, JSON.stringify(v)),
  };

  if (!DB.get('initialized')) {
    DB.set('initialized', true);
    DB.set('password', 'demo');
    DB.set('entries', [
      {
        id: 1, content: 'התחלתי את היום בהרגשה טובה, ישנתי מצוין הלילה.',
        tone: 'positive', rating: 7, category: 'בריאות',
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
      {
        id: 2, content: 'פגישה קשה בעבודה, הרגשתי שלא הקשיבו לי.',
        tone: 'negative', rating: 3, category: 'עבודה',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        updated_at: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 3, content: 'ארוחת ערב משפחתית נעימה, שיחה טובה עם הילדים.',
        tone: 'positive', rating: 8, category: 'משפחה',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        updated_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ]);
    DB.set('entry_seq', 4);
    DB.set('notes', [
      { id: 1, title: 'תובנות', content: 'כשאני ישן טוב — כל היום טוב יותר.',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    DB.set('note_seq', 2);
  }

  const delay = (ms = 40) => new Promise(r => setTimeout(r, ms));
  const now   = () => new Date().toISOString();
  const err   = (msg) => Promise.reject(msg);
  let unlocked = false;

  const MOCK = {

    is_initialized: async () => { await delay(); return true; },

    unlock: async ({ password }) => {
      await delay(200);
      if (password !== DB.get('password')) return err('סיסמה שגויה');
      unlocked = true;
      return { success: true };
    },

    lock: async () => { await delay(); unlocked = false; return true; },

    change_password: async ({ old_password, new_password }) => {
      await delay(200);
      if (!unlocked) return err('האפליקציה נעולה');
      if (old_password !== DB.get('password')) return err('סיסמה ישנה שגויה');
      DB.set('password', new_password);
      return true;
    },

    // ── entries ──────────────────────────────────────────────
    get_entries: async () => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      return [...(DB.get('entries') || [])].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at) // ASC
      );
    },

    get_entry: async ({ id }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      const e = (DB.get('entries') || []).find(e => e.id === id);
      if (!e) return err('רשומה לא נמצאה');
      return e;
    },

    create_entry: async ({ entry, created_at }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      const entries = DB.get('entries') || [];
      const id      = DB.get('entry_seq') || 1;
      const ts      = created_at || now();
      const newEntry = {
        id,
        content:    entry.content,
        tone:       entry.tone     || null,
        rating:     entry.rating   || null,
        category:   entry.category || null,
        created_at: ts,
        updated_at: ts,
      };
      entries.push(newEntry);
      DB.set('entries', entries);
      DB.set('entry_seq', id + 1);
      return newEntry;
    },

    update_entry: async ({ entry }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      const entries = DB.get('entries') || [];
      const idx = entries.findIndex(e => e.id === entry.id);
      if (idx === -1) return err('רשומה לא נמצאה');
      entries[idx] = {
        ...entries[idx],
        content:  entry.content,
        tone:     entry.tone     || null,
        rating:   entry.rating   || null,
        category: entry.category || null,
        updated_at: now(),
      };
      DB.set('entries', entries);
      return entries[idx];
    },

    delete_entry: async ({ id }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      DB.set('entries', (DB.get('entries') || []).filter(e => e.id !== id));
      return { success: true };
    },

    search_entries: async ({ params }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      let entries = [...(DB.get('entries') || [])];
      if (params.query) {
        const q = params.query.toLowerCase();
        entries = entries.filter(e => e.content.toLowerCase().includes(q));
      }
      if (params.category) {
        const c = params.category.toLowerCase();
        entries = entries.filter(e => e.category?.toLowerCase().includes(c));
      }
      if (params.date_from)
        entries = entries.filter(e => e.created_at.slice(0,10) >= params.date_from);
      if (params.date_to)
        entries = entries.filter(e => e.created_at.slice(0,10) <= params.date_to);
      return entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    },

    // ── notes ────────────────────────────────────────────────
    get_notes: async () => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      return [...(DB.get('notes') || [])].sort(
        (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
      );
    },

    get_note: async ({ id }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      const n = (DB.get('notes') || []).find(n => n.id === id);
      if (!n) return err('פתק לא נמצא');
      return n;
    },

    create_note: async ({ note }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      const notes = DB.get('notes') || [];
      const id    = DB.get('note_seq') || 1;
      const newNote = { id, title: note.title, content: note.content,
                        created_at: now(), updated_at: now() };
      notes.push(newNote);
      DB.set('notes', notes);
      DB.set('note_seq', id + 1);
      return newNote;
    },

    update_note: async ({ note }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      const notes = DB.get('notes') || [];
      const idx   = notes.findIndex(n => n.id === note.id);
      if (idx === -1) return err('פתק לא נמצא');
      notes[idx] = { ...notes[idx], title: note.title, content: note.content, updated_at: now() };
      DB.set('notes', notes);
      return notes[idx];
    },

    delete_note: async ({ id }) => {
      await delay();
      if (!unlocked) return err('האפליקציה נעולה');
      DB.set('notes', (DB.get('notes') || []).filter(n => n.id !== id));
      return { success: true };
    },
  };

  window.__MOCK__ = MOCK;
  console.info('[mock] פועל במצב דפדפן');
})();
