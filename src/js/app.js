// app.js v3

(async function () {

  const lockScreen    = document.getElementById('lock-screen');
  const appShell      = document.getElementById('app-shell');
  const passwordInput = document.getElementById('password-input');
  const unlockBtn     = document.getElementById('unlock-btn');
  const lockError     = document.getElementById('lock-error');
  const lockLabel     = document.getElementById('lock-label');
  const tabBtns       = document.querySelectorAll('.tab-btn');
  const tabContents   = document.querySelectorAll('.tab-content');
  const settingsBtn   = document.getElementById('settings-btn');

  let autoLockMinutes = parseInt(localStorage.getItem('lock_timeout') || '15', 10);
  let autoLockTimer   = null;
  let activeTab       = 'journal';

  // ── גופן ────────────────────────────────────────────────────
  function applyFontSize(size) {
    document.documentElement.style.fontSize = size + 'px';
  }
  applyFontSize(parseInt(localStorage.getItem('font_size') || '15', 10));

  // ── אתחול ───────────────────────────────────────────────────
  async function init() {
    const initialized = await API.isInitialized().catch(() => false);
    if (!initialized) lockLabel.textContent = 'בחר סיסמה חדשה';
    passwordInput.focus();
  }

  async function doUnlock() {
    const pw = passwordInput.value.trim();
    if (!pw) return;
    unlockBtn.disabled    = true;
    lockError.textContent = '';
    try {
      await API.unlock(pw);
      await onUnlocked();
    } catch (e) {
      console.error('unlock error:', e);
      lockError.textContent = typeof e === 'string' ? e : (e?.message || JSON.stringify(e) || 'שגיאה לא ידועה');
      passwordInput.value   = '';
      passwordInput.focus();
    } finally {
      unlockBtn.disabled = false;
    }
  }

  async function onUnlocked() {
    lockScreen.classList.add('hidden');
    appShell.classList.add('visible');
    passwordInput.value = '';
    startAutoLock();
    switchTab(activeTab);
  }

  async function doLock() {
    await API.lock();
    clearAutoLock();
    appShell.classList.remove('visible');
    lockScreen.classList.remove('hidden');
    lockError.textContent = '';
    passwordInput.value   = '';
    passwordInput.focus();
  }

  // ── auto-lock ────────────────────────────────────────────────
  function startAutoLock() {
    clearAutoLock();
    resetAutoLock();
    ['mousemove','keydown','mousedown','touchstart'].forEach(ev =>
      window.addEventListener(ev, resetAutoLock, { passive: true })
    );
  }
  function resetAutoLock() {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(doLock, autoLockMinutes * 60 * 1000);
  }
  function clearAutoLock() {
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = null;
    ['mousemove','keydown','mousedown','touchstart'].forEach(ev =>
      window.removeEventListener(ev, resetAutoLock)
    );
  }

  // ── טאבים ────────────────────────────────────────────────────
  function switchTab(name) {
    activeTab = name;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    tabContents.forEach(c => c.classList.toggle('hidden', c.id !== `tab-${name}`));
    if      (name === 'journal') window.JournalView?.load();
    else if (name === 'history') window.HistoryView?.load();
    else if (name === 'notes')   window.NotesView?.load();
  }
  tabBtns.forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  // ── הגדרות ────────────────────────────────────────────────────
  const settingsModal     = document.getElementById('settings-modal');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');
  const settingsSaveBtn   = document.getElementById('settings-save-btn');
  const lockTimeoutInput  = document.getElementById('lock-timeout-input');
  const fontSizeInput     = document.getElementById('font-size-input');
  const oldPwInput        = document.getElementById('old-password-input');
  const newPwInput        = document.getElementById('new-password-input');
  const newPw2Input       = document.getElementById('new-password2-input');
  const pwChangeError     = document.getElementById('pw-change-error');

  settingsBtn.addEventListener('click', () => {
    lockTimeoutInput.value    = autoLockMinutes;
    fontSizeInput.value       = parseInt(localStorage.getItem('font_size') || '15', 10);
    oldPwInput.value          = '';
    newPwInput.value          = '';
    newPw2Input.value         = '';
    pwChangeError.textContent = '';
    settingsModal.classList.remove('hidden');
    lockTimeoutInput.focus();
  });

  settingsCancelBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
  settingsModal.addEventListener('click', e => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden');
  });

  settingsSaveBtn.addEventListener('click', async () => {
    const timeout = parseInt(lockTimeoutInput.value, 10);
    if (timeout && timeout >= 1) {
      autoLockMinutes = timeout;
      localStorage.setItem('lock_timeout', timeout);
      resetAutoLock();
    }
    const fontSize = parseInt(fontSizeInput.value, 10);
    if (fontSize && fontSize >= 12 && fontSize <= 22) {
      localStorage.setItem('font_size', fontSize);
      applyFontSize(fontSize);
    }
    const oldPw  = oldPwInput.value.trim();
    const newPw  = newPwInput.value.trim();
    const newPw2 = newPw2Input.value.trim();
    if (oldPw || newPw || newPw2) {
      if (!oldPw || !newPw || !newPw2) {
        pwChangeError.textContent = 'יש למלא את כל שדות הסיסמה'; return;
      }
      if (newPw !== newPw2) {
        pwChangeError.textContent = 'הסיסמאות החדשות אינן תואמות'; return;
      }
      if (newPw.length < 4) {
        pwChangeError.textContent = 'סיסמה חייבת להכיל לפחות 4 תווים'; return;
      }
      try {
        await API.changePassword(oldPw, newPw);
      } catch (e) {
        pwChangeError.textContent = typeof e === 'string' ? e : 'שגיאה בשינוי סיסמה';
        return;
      }
    }
    settingsModal.classList.add('hidden');
  });

  // ── helpers: tone selector ───────────────────────────────────
  window.initToneSelector = function (container, onChange) {
    container.querySelectorAll('.tone-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tone     = btn.dataset.tone;
        const isActive = btn.classList.contains(`active-${tone}`);
        container.querySelectorAll('.tone-btn').forEach(b => b.className = 'tone-btn');
        if (!isActive) { btn.classList.add(`active-${tone}`); onChange(tone); }
        else onChange(null);
      });
    });
  };

  window.setToneSelector = function (container, tone) {
    container.querySelectorAll('.tone-btn').forEach(b => b.className = 'tone-btn');
    if (tone) {
      const btn = container.querySelector(`[data-tone="${tone}"]`);
      if (btn) btn.classList.add(`active-${tone}`);
    }
  };

  // ── helpers: rating popup ────────────────────────────────────
  window.initRatingPopup = function (triggerBtn, popup, onChange) {
    triggerBtn.addEventListener('click', e => {
      e.stopPropagation();
      popup.classList.toggle('hidden');
    });
    popup.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const val = parseInt(btn.dataset.val, 10);
        if (triggerBtn.dataset.rating == val) {
          triggerBtn.textContent    = 'דירוג';
          triggerBtn.dataset.rating = '';
          triggerBtn.classList.remove('has-value');
          onChange(null);
        } else {
          triggerBtn.textContent    = val;
          triggerBtn.dataset.rating = val;
          triggerBtn.classList.add('has-value');
          onChange(val);
        }
        popup.classList.add('hidden');
      });
    });
  };

  window.setRatingBtn = function (triggerBtn, val) {
    if (val) {
      triggerBtn.textContent    = val;
      triggerBtn.dataset.rating = val;
      triggerBtn.classList.add('has-value');
    } else {
      triggerBtn.textContent    = 'דירוג';
      triggerBtn.dataset.rating = '';
      triggerBtn.classList.remove('has-value');
    }
  };

  document.addEventListener('click', e => {
    document.querySelectorAll('.rating-popup:not(.hidden)').forEach(popup => {
      if (!popup.contains(e.target) && e.target !== popup.previousElementSibling)
        popup.classList.add('hidden');
    });
  });

  // ── תאריך עברי — גימטריה, ללא כפל "יום" ───────────────────
  const GEMATRIA_ONES  = ['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
  const GEMATRIA_TENS  = ['','י','כ','ל','מ','נ','ס','ע','פ','צ'];
  const GEMATRIA_HUNDS = ['','ק','ר','ש','ת'];

  function numToGematria(n) {
    if (n <= 0) return '';
    let result = '';
    const hundreds = Math.floor(n / 100);
    if (hundreds > 0 && hundreds <= 4) {
      result += GEMATRIA_HUNDS[hundreds];
      n -= hundreds * 100;
    } else if (hundreds > 4) {
      result += 'ת';
      n -= 400;
      return result + numToGematria(n);
    }
    const tens = Math.floor(n / 10);
    if (tens === 1 && (n % 10 === 5 || n % 10 === 6)) {
      result += n % 10 === 5 ? 'טו' : 'טז';
      return result;
    }
    result += GEMATRIA_TENS[tens];
    n -= tens * 10;
    result += GEMATRIA_ONES[n];
    return result;
  }

  function addGematriaMarks(str) {
    if (!str) return str;
    if (str.length === 1) return str + "'";
    return str.slice(0, -1) + '"' + str.slice(-1);
  }

  // ימי שבוע בעברית
  const HEB_WEEKDAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

  window.toHebrewDate = function (dateObj) {
    try {
      const formatter = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
        year: 'numeric', month: 'long', day: 'numeric',
        // ללא weekday — נוסיף ידנית כדי למנוע "יום" כפול
      });
      const parts = formatter.formatToParts(dateObj);
      const p = {};
      parts.forEach(({ type, value }) => { p[type] = value; });

      const yearNum = parseInt(p.year,  10);
      const dayNum  = parseInt(p.day,   10);
      const month   = p.month || '';

      const yearGem = addGematriaMarks(numToGematria(yearNum % 1000 || 1000));
      const dayGem  = addGematriaMarks(numToGematria(dayNum));

      // יום בשבוע — מחושב ידנית ללא Intl.weekday
      const weekday = HEB_WEEKDAYS[dateObj.getDay()];

      return `יום ${weekday}, ${dayGem} ב${month} ${yearGem}`;
    } catch {
      return dateObj.toLocaleDateString('he-IL');
    }
  };

  window.toGregorianShort = function (dateObj) {
    return dateObj.toLocaleDateString('he-IL', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  };

  // ── rating popup — יצירת כפתורים ────────────────────────────
  document.querySelectorAll('.rating-popup').forEach(popup => {
    for (let i = 1; i <= 10; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.dataset.val = i;
      popup.appendChild(btn);
    }
  });

// ── confirmDialog — מחליף את window.confirm() ──────────────
window.confirmDialog = function(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    const msg     = document.getElementById('confirm-msg');
    const okBtn   = document.getElementById('confirm-ok');
    const noBtn   = document.getElementById('confirm-no');

    msg.textContent = message;
    overlay.classList.remove('hidden');

    function cleanup(result) {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      noBtn.removeEventListener('click', onNo);
      // סגירה בלחיצה על הרקע
      overlay.removeEventListener('click', onOverlay);
      resolve(result);
    }
    const onOk      = () => cleanup(true);
    const onNo      = () => cleanup(false);
    const onOverlay = e => { if (e.target === overlay) cleanup(false); };

    okBtn.addEventListener('click', onOk);
    noBtn.addEventListener('click', onNo);
    overlay.addEventListener('click', onOverlay);
  });
};

  // ── ESC ──────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape')
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m =>
        m.classList.add('hidden')
      );
  });

  unlockBtn.addEventListener('click', doUnlock);
  passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });

  await init();

})();
