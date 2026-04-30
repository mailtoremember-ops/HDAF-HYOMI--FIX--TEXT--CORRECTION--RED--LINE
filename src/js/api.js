// api.js v2
const isTauri = typeof window.__TAURI__ !== 'undefined';

async function invoke(cmd, args = {}) {
  if (isTauri) return window.__TAURI__.tauri.invoke(cmd, args);
  const fn = window.__MOCK__[cmd];
  if (!fn) throw new Error(`mock: פקודה לא קיימת — ${cmd}`);
  return fn(args);
}

const API = {
  isInitialized:  ()                         => invoke('is_initialized'),
  unlock:         (password)                 => invoke('unlock', { password }),
  lock:           ()                         => invoke('lock'),
  changePassword: (oldPassword, newPassword) =>
                    invoke('change_password', { oldPassword, newPassword }),

  getEntries:     ()                         => invoke('get_entries'),
  getEntry:       (id)                       => invoke('get_entry',   { id }),
  createEntry:    (entry, createdAt)         => invoke('create_entry',{ entry, createdAt }),
  updateEntry:    (entry)                    => invoke('update_entry',{ entry }),
  deleteEntry:    (id)                       => invoke('delete_entry',{ id }),
  searchEntries:  (params)                   => invoke('search_entries', { params }),

  getNotes:       ()                         => invoke('get_notes'),
  getNote:        (id)                       => invoke('get_note',   { id }),
  createNote:     (note)                     => invoke('create_note',{ note }),
  updateNote:     (note)                     => invoke('update_note',{ note }),
  deleteNote:     (id)                       => invoke('delete_note',{ id }),
};

window.API = API;
