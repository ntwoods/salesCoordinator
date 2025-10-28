/* global google */
(function () {
  const CFG = window.APP_CONFIG;
  const qs = (sel) => document.querySelector(sel);

  // ---------- DOM refs ----------
  const loginView = qs('#loginView');
  const mainView = qs('#mainView');
  const cardsEl = qs('#cards');
  const emptyState = qs('#emptyState');
  const todayTag = qs('#todayTag');
  const userEmailEl = qs('#userEmail');
  const userPicEl = qs('#userPic');
  const signOutBtn = qs('#btnSignOut');
  const toastEl = qs('#toast');
  const appLoader = qs('#appLoader');

  const modal = qs('#modal');
  const outcomeSel = qs('#outcome');
  const remarkInput = qs('#remark');
  const markInfo = qs('#markInfo');
  const btnCancel = qs('#btnCancel');
  const btnSubmit = qs('#btnSubmit');

  // Legacy OR file block (kept but hidden by logic)
  const orBlock = qs('#orBlock');
  const orFile = qs('#orFile');

  // SF block
  const sfBlock = qs('#sfBlock');
  const sfWhen = qs('#sfWhen');

  // NEW: OR iframe host
  const orFrameWrap = qs('#orFrameWrap');
  const orFrame = qs('#orFrame');

  // ---------- State ----------
  let modalContext = null;
  let idToken = null;
  let userInfo = null;
  let countdownTimers = [];
  let autoRefreshTimer = null;
  let autoRefreshPaused = false;

  // runtime flags for iframe handshake
  let childDone = false;
  let msgHandlerBound = false;

  // ---------- Google Sign-in ----------
  window.onload = () => {
    try {
      google.accounts.id.initialize({
        client_id: CFG.CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        ux_mode: 'popup',
      });
      google.accounts.id.renderButton(
        document.getElementById('g_id_signin'),
        { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' }
      );
    } catch (err) {
      console.error('GSI init error:', err);
    }
  };

  async function handleCredentialResponse(resp) {
    try {
      idToken = resp.credential;
      toggleLoader(true);
      const who = await apiGET('me');
      userInfo = who.user;
      userEmailEl.textContent = userInfo.email || '';
      userPicEl.src = userInfo.picture || '';
      loginView.classList.add('hidden');
      mainView.classList.remove('hidden');
      await loadDue();
    } catch (err) {
      showError('#loginError', err.message || String(err));
    } finally {
      toggleLoader(false);
    }
  }

  // ---------- API helpers ----------
  async function apiGET(path) {
    const url = `${CFG.GAS_BASE}?path=${encodeURIComponent(path)}&id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'GET failed');
    return json;
  }

  async function apiPOST(path, body) {
    // Per your requirement: fire-and-forget
    await fetch(CFG.GAS_BASE, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id_token: idToken, ...body }),
    });
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (autoRefreshPaused) return;
    autoRefreshTimer = setInterval(() => {
      if (!autoRefreshPaused) loadDue('silent');
    }, 30000);
  }
  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  function pauseAutoRefresh() {
    autoRefreshPaused = true;
    stopAutoRefresh();
  }
  function resumeAutoRefresh() {
    autoRefreshPaused = false;
    startAutoRefresh();
  }

  // ---------- Helpers ----------
  function monthLastDate(d) {
    const dt = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    dt.setHours(23, 59, 59, 999);
    return dt;
  }

  // IMPORTANT: Week windows => 1–7, 8–14, 15–21, 22–monthEnd
  function weekWindowEnd(dateObj) {
    const dd = dateObj.getDate();
    const endDay = dd <= 7 ? 7 : dd <= 14 ? 14 : dd <= 21 ? 21 : monthLastDate(dateObj).getDate();
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), endDay, 23, 59, 59, 999);
  }

  function hasTimeComponent(dt) {
    return dt instanceof Date && !isNaN(dt) && (dt.getHours() + dt.getMinutes() + dt.getSeconds()) !== 0;
  }

  function formatDHMS(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // ---------- Load & Render Due ----------
  async function loadDue(mode) {
    countdownTimers.forEach(clearInterval);
    countdownTimers = [];
    cardsEl.innerHTML = '';
    emptyState.classList.add('hidden');

    if (mode !== 'silent') toggleLoader(true);
    const data = await apiGET('due');
    if (mode !== 'silent') toggleLoader(false);

    const todayISO = data.today;
    const today = new Date(todayISO);
    todayTag.textContent = today.toLocaleDateString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
    });

    const items = data.items || [];

    // Overdue count (based on weekWindowEnd & any sfAt)
    qs('#countOverdue').textContent = items.reduce((acc, it) => {
      const anyOver = (it.dueCalls || []).some(dc => {
        const base = new Date(dc.callDate + 'T00:00:00');
        const end = dc.sfAt ? new Date(dc.sfAt) : weekWindowEnd(base);
        return (new Date() > end);
      });
      return acc + (anyOver ? 1 : 0);
    }, 0);

    let shown = 0;

    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card-sm';

      const client = document.createElement('div');
      client.className = 'client';
      client.textContent = it.clientName;

      const calls = document.createElement('div');
      calls.className = 'calls';

      let activeCount = 0;

      (it.dueCalls || []).forEach(dc => {
        const dateObj = new Date(dc.callDate + 'T00:00:00');
        const windowEnd = dc.sfAt ? new Date(dc.sfAt) : weekWindowEnd(dateObj);
        const now = new Date();
        const active = now.getTime() <= windowEnd.getTime();

        const btn = document.createElement('button');
        btn.className = 'btn light';
        btn.textContent = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        btn.title = `Call-${dc.callN} (${dc.callDate})` + (dc.sfAt ? ` | until ${new Date(dc.sfAt).toLocaleString('en-IN')}` : '');

        if (!active) {
          btn.disabled = true;
          btn.classList.add('disabled');
          btn.title += ' (expired)';
        } else {
          activeCount++;
          btn.addEventListener('click', () => openModal(it, dc, todayISO));
        }

        calls.appendChild(btn);
      });

      // SF future countdown chip (if any)
      const sfFuture = (it.sfFuture || null);
      if (sfFuture) {
        const chip = document.createElement('div');
        chip.className = 'countdown';
        card.appendChild(chip);

        const target = new Date(sfFuture);
        const tick = () => {
          const now = new Date();
          const diff = target - now;
          if (diff <= 0) { chip.textContent = 'Overdue'; chip.classList.add('overdue'); return; }
          chip.textContent = formatDHMS(diff);
        };
        tick();
        const t = setInterval(tick, 1000);
        countdownTimers.push(t);
      }

      if (activeCount > 0) {
        card.appendChild(client);
        card.appendChild(calls);
        cardsEl.appendChild(card);
        shown++;
      }
    }

    qs('#countDue').textContent = shown;
    if (!shown) emptyState.classList.remove('hidden');
    startAutoRefresh();
  }

  // ---------- Modal Open ----------
  function openModal(item, dueCall, todayISO) {
    pauseAutoRefresh();
    modalContext = {
      rowIndex: item.rowIndex,
      dateISO: todayISO,
      callN: dueCall.callN,
      clientName: item.clientName,
      callDate: dueCall.callDate,
    };

    qs('#modalTitle').textContent = `Follow-up for ${item.clientName}`;
    remarkInput.value = '';

    // Default dropdown to placeholder “Select An Option”
    outcomeSel.value = '';

    markInfo.textContent = `Call-${dueCall.callN} | Scheduled: ${dueCall.callDate}`;

    // Reset blocks
    orBlock?.classList.add('hidden'); if (orFile) orFile.value = '';
    sfBlock.classList.add('hidden'); sfWhen.value = '';
    if (orFrameWrap) orFrameWrap.classList.add('hidden');
    if (orFrame) orFrame.src = '';

    childDone = false;
    btnSubmit.disabled = false;
    btnSubmit.classList.remove('disabled');

    modal.classList.remove('hidden');
  }

  // ---------- Outcome change ----------
  outcomeSel.addEventListener('change', () => {
    const v = outcomeSel.value;

    // Hide all dynamic UI first
    orBlock?.classList.add('hidden');
    sfBlock.classList.add('hidden');
    if (orFrameWrap) orFrameWrap.classList.add('hidden');
    if (orFrame) orFrame.src = '';
    if (msgHandlerBound) {
      window.removeEventListener('message', onChildMessage, false);
      msgHandlerBound = false;
    }
    childDone = false;

    if (v === 'SF') {
      sfBlock.classList.remove('hidden');
      btnSubmit.disabled = false;
      btnSubmit.classList.remove('disabled');

    } else if (v === 'OR') {
      // Render orderPunch form inside modal
      const ctx = modalContext || {};
      const params = new URLSearchParams({
        clientName: ctx.clientName || '',
        callN: String(ctx.callN || ''),
        plannedDate: ctx.callDate || '',
        rowIndex: String(ctx.rowIndex || ''),
      });

      const punchURL = `https://ntwoods.github.io/ordertodispatch/orderPunch.html?${params.toString()}`;
      if (orFrame) orFrame.src = punchURL;
      if (orFrameWrap) {
        orFrameWrap.classList.remove('hidden');
        // (Optional) compact scaling for short viewports
        const host = orFrameWrap.querySelector('.iframe-host');
        if (host) {
          if (window.innerHeight < 760) host.classList.add('compact');
          else host.classList.remove('compact');
        }
      }

      // Listen for child success
      if (!msgHandlerBound) {
        window.addEventListener('message', onChildMessage, false);
        msgHandlerBound = true;
      }

      // Disable submit until child confirms success
      btnSubmit.disabled = false;
      btnSubmit.classList.add('enabled');

    } else if (v === 'NR') {
      btnSubmit.disabled = false;
      btnSubmit.classList.remove('disabled');
    }
  });

  // ---------- Modal actions ----------
  btnCancel.addEventListener('click', () => {
    closeResponseModalSafely();
  });

  btnSubmit.addEventListener('click', async () => {
    if (!modalContext) return;

    const outcome = outcomeSel.value;
    if (!outcome) { showToast('Please select an outcome'); return; }

    const remark = (remarkInput.value || '').trim();

    const payload = {
      rowIndex: modalContext.rowIndex,
      date: modalContext.dateISO,
      outcome,
      remark,
      callN: modalContext.callN,
      plannedDate: modalContext.callDate,
    };

    if (outcome === 'SF') {
      if (!sfWhen.value) return showToast('Please select date & time for next follow-up.');
      payload.scheduleAt = sfWhen.value;
    }

    try {
      toggleLoader(true);
      await apiPOST('mark', payload);       // fire-and-forget
      showToast(`Saved: ${outcome}`);
      closeResponseModalSafely();
      await loadDue();
    } catch (err) {
      showToast(err.message || String(err));
    } finally {
      toggleLoader(false);
    }
  });

  // ---------- postMessage from child (orderPunch) ----------
  function onChildMessage(event) {
    if (event.origin !== 'https://ntwoods.github.io') return;
    const msg = event.data || {};
    if (msg && msg.type === 'ORDER_PUNCHED') {
      childDone = true;
      btnSubmit.disabled = false;
      btnSubmit.classList.remove('disabled');
      showToast('Order form submitted. Now click Submit to record OR.');
    }
  }

  function closeResponseModalSafely() {
    if (msgHandlerBound) {
      window.removeEventListener('message', onChildMessage, false);
      msgHandlerBound = false;
    }
    if (orFrame) orFrame.src = '';
    if (orFrameWrap) orFrameWrap.classList.add('hidden');

    btnSubmit.disabled = false;
    btnSubmit.classList.remove('disabled');

    modal.classList.add('hidden');
    modalContext = null;
    resumeAutoRefresh();
  }

  // ---------- Sign out ----------
  signOutBtn.addEventListener('click', () => {
    try { google.accounts.id.disableAutoSelect(); } catch {}
    idToken = null; userInfo = null;
    cardsEl.innerHTML = '';
    mainView.classList.add('hidden');
    loginView.classList.remove('hidden');
  });

  // ---------- UI utils ----------
  function showError(sel, msg) {
    const el = qs(sel);
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }

  function toggleLoader(on) {
    appLoader.classList.toggle('hidden', !on);
  }

  // (Kept in case legacy file upload is ever revived)
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result);
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.onerror = () => reject(fr.error || new Error('File read error'));
      fr.readAsDataURL(file);
    });
  }
})();
