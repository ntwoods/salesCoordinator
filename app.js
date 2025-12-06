/* global google */
(function () {
  const CFG = window.APP_CONFIG;
  const qs = (sel) => document.querySelector(sel);

  // ---------- DOM refs ----------
  const loginView = qs('#loginView');
  const btnQuickOrder = document.getElementById('btnQuickOrder');  
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

  // Legacy OR file block (kept)
  const orBlock = qs('#orBlock');
  const orFile = qs('#orFile');

  // SF block
  const sfBlock = qs('#sfBlock');
  const sfWhen = qs('#sfWhen');

  // OR iframe host
  const orFrameWrap = qs('#orFrameWrap');
  const orFrame = qs('#orFrame');

  // ---------- State ----------
  let modalContext = null;
  let idToken = null;
  let userInfo = null;
  let countdownTimers = [];
  let autoRefreshTimer = null;
  let autoRefreshPaused = false;

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
      if (btnQuickOrder) btnQuickOrder.addEventListener('click', openQuickOrder);      
      await loadDue();
    } catch (err) {
      showError('#loginError', err.message || String(err));
    } finally {
      toggleLoader(false);
    }
  }

  // ---------- API helpers ----------
  async function apiGETSfRemarks(clientName) {
    const url = `${CFG.GAS_BASE}?path=sfRemarks&client=${encodeURIComponent(clientName)}&id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Failed fetching SF remarks');
    return json.remarks || [];
  }

  async function apiGET(path) {
    const url = `${CFG.GAS_BASE}?path=${encodeURIComponent(path)}&id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'GET failed');
    return json;
  }
  async function apiGETRowByDealer(email, dealer) {
    const url = `${CFG.GAS_BASE}?path=rowByDealer&email=${encodeURIComponent(email)}&dealer=${encodeURIComponent(dealer)}&id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'rowByDealer failed');
    return json; // { ok:true, rowIndex: number }
  }
  async function apiGETScotDealers(email) {
    const url = `${CFG.GAS_BASE}?path=scotDealers&email=${encodeURIComponent(email)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'scotDealers failed');
    return json; // { ok:true, dealers: [...] }
  }
  async function apiPOST(path, body) {
    await fetch(CFG.GAS_BASE, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id_token: idToken, ...body }),
    });
  }

  // ---------- Quick Order flow ----------
  function openQuickOrder() {
    if (!userInfo || !userInfo.email) {
      showToast('Login email missing. Please sign in.'); 
      return;
    }
    pauseAutoRefresh();

    document.getElementById('modalTitle').textContent = 'Order Punch';
    outcomeSel.value = '';
    orBlock?.classList.add('hidden');
    sfBlock.classList.add('hidden');
    if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.classList.add('disabled'); }

    const params = new URLSearchParams({ variant: 'quick', email: userInfo.email });
    const punchURL = `https://ntwoods.github.io/ordertodispatch/orderPunch.html?${params.toString()}`;
    if (orFrame) orFrame.src = punchURL;
    if (orFrameWrap) orFrameWrap.classList.remove('hidden');
    modal.classList.remove('hidden');

    (async () => {
      try {
        const { dealers = [] } = await apiGETScotDealers(userInfo.email);
        orFrame.addEventListener('load', () => {
          orFrame.contentWindow.postMessage(
            { type: 'DEALERS_INIT', dealers, email: userInfo.email },
            'https://ntwoods.github.io'
          );
        }, { once: true });
      } catch (e) {
        console.warn('Dealer preload failed:', e);
        showToast('Dealer list fetch me issue aaya.');
      }
    })();

    const onChildMsg = async (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'ORDER_PUNCHED') {
        try {
          const dealerName = (msg.dealerName || '').trim();
          if (!dealerName) throw new Error('Dealer not received from child.');

          const { rowIndex } = await apiGETRowByDealer(userInfo.email, dealerName);

          const todayISO = new Date().toISOString().slice(0, 10);
          const payload = {
            rowIndex,
            date: todayISO,
            outcome: 'OR',
            remark: 'Quick Order',
            callN: 0,
            plannedDate: todayISO
          };
          await apiPOST('mark', payload);

          showToast('Order saved. Follow-ups updated.');
          closeResponseModalSafely();
          await loadDue('silent');
        } catch (e) {
          console.error(e);
          showToast(e.message || 'Could not auto-update.');
        } finally {
          window.removeEventListener('message', onChildMsg, false);
          resumeAutoRefresh();
        }
      }
      if (msg.type === 'CLOSE_PUNCH') {
        closeResponseModalSafely();
        window.removeEventListener('message', onChildMsg, false);
        resumeAutoRefresh();
      }
    };
    window.addEventListener('message', onChildMsg, false);
  }

  // ---------- Auto refresh helpers ----------
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
  // Week windows => 1–7, 8–14, 15–21, 22–monthEnd
  function weekWindowEnd(dateObj) {
    const dd = dateObj.getDate();
    const endDay = dd <= 7 ? 7 : dd <= 14 ? 14 : dd <= 21 ? 21 : monthLastDate(dateObj).getDate();
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), endDay, 23, 59, 59, 999);
  }
  function formatDHMS(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  function normColor(val) {
    if (!val) return "";
    const v = String(val).trim().toLowerCase();
    if (v.startsWith("r")) return "Red";
    if (v.startsWith("y")) return "Yellow";
    if (v.startsWith("g")) return "Green";
    return "";
  }

  // ---------- Load & Render Due (with remark toggle) ----------
  async function loadDue(mode) {
    // cleanup
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
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const today0 = startOfDay(today);

    // Overdue summary
    qs('#countOverdue').textContent = items.reduce((acc, it) => {
      const now = new Date();
      const sfTarget = it.sfFuture ? new Date(it.sfFuture) : null;
      const sfOver   = !!(sfTarget && sfTarget <= now);

      const anyPastDate = (it.dueCalls || []).some(dc => {
        const call = new Date(dc.callDate + 'T00:00:00');
        return call < today0;
      });
      const anySFPassed = (it.dueCalls || []).some(dc => dc.sfAt && new Date(dc.sfAt) < now);
      const anyOver = anyPastDate || anySFPassed || sfOver;
      return acc + (anyOver ? 1 : 0);
    }, 0);

    let shown = 0;

    // ===== render cards =====
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card-sm';
      card.dataset.clientColor = normColor(it.clientColor);

      const now = new Date();

      const client = document.createElement('div');
      client.className = 'client';
      client.textContent = it.clientName;

      const calls = document.createElement('div');
      calls.className = 'calls';

      // dueCalls buttons (enable/disable as before)
      let activeCount = 0;
      (it.dueCalls || []).forEach(dc => {
        const dateObj   = new Date(dc.callDate + 'T00:00:00');
        const windowEnd = weekWindowEnd(dateObj);
        const isActive  = now.getTime() <= windowEnd.getTime();

        const btn = document.createElement('button');
        btn.className = 'btn light';
        btn.textContent = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        btn.title = `Call-${dc.callN} (${dc.callDate})` + (dc.sfAt ? ` | until ${new Date(dc.sfAt).toLocaleString('en-IN')}` : '');

        if (!isActive) {
          btn.disabled = true;
          btn.classList.add('disabled');
          btn.title += ' (expired)';
        } else {
          activeCount++;
          btn.addEventListener('click', () => openModal(it, dc, todayISO));
        }
        calls.appendChild(btn);
      });

// ---- Combined Remarks (Sheet1 + SF history) ----
const renderRemarks = async () => {
  const sheet1Remark = (it.remarkText || '').trim();
  let sfRemarks = [];

  try {
    sfRemarks = await apiGETSfRemarks(it.clientName);
  } catch (e) {
    console.warn('SF remark fetch failed for', it.clientName, e);
  }

  // If no remarks → exit
  if (!sheet1Remark && sfRemarks.length === 0) return;

  // Create button
  const btnRemark = document.createElement('button');
  btnRemark.className = 'btn light remark-toggle';
  btnRemark.textContent = 'Show Remarks';
  calls.appendChild(btnRemark);

  // Create panel
  const remarkWrap = document.createElement('div');
  remarkWrap.className = 'remark hidden';

  let html = '';

  // ---- Sheet1 remark ----
  if (sheet1Remark) {
    const whenLabel = it.remarkDay
      ? `Day ${String(it.remarkDay).padStart(2, '0')}`
      : 'Previous';

    html += `
      <div class="remark-title">Sheet1 Remark · <strong>${whenLabel}</strong></div>
      <div class="remark-body">${sheet1Remark}</div>
    `;
  }

  // ---- SF remark history ----
  if (sfRemarks.length > 0) {
    if (sheet1Remark) {
      html += `<hr style="margin:8px 0;border:none;border-top:1px solid #e5e7eb;">`;
    }

    html += `<div class="remark-title">SF Follow-up History</div>`;

    sfRemarks.forEach(r => {
      html += `
        <div class="remark-body">
        function formatSFDate(iso) {
          const d = new Date(iso);
          return d.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          }).replace(',', '');
        }
        <strong>${formatSFDate(r.ts)}</strong><br>
          ${(r.remark || '(no remark)').trim()}
        </div>
        <br>
      `;
    });
  }

  remarkWrap.innerHTML = html;
  card.appendChild(remarkWrap);

  // toggle
  btnRemark.addEventListener('click', () => {
    const hidden = remarkWrap.classList.contains('hidden');
    remarkWrap.classList.toggle('hidden', !hidden);
    card.classList.toggle('expanded-remark', hidden);
    btnRemark.textContent = hidden ? 'Hide Remarks' : 'Show Remarks';
  });
};

// call renderer (async but after DOM elements exist)
renderRemarks();
      // --- Overdue highlights ---
      const anyPastDate = (it.dueCalls || []).some(dc => {
        const call = new Date(dc.callDate + 'T00:00:00');
        return call < today0;
      });
      const anySFPassed = (it.dueCalls || []).some(dc => dc.sfAt && new Date(dc.sfAt) < now);

      const sfTarget = it.sfFuture ? new Date(it.sfFuture) : null;
      const sfOver   = !!(sfTarget && sfTarget <= now);
      const anyOver  = anyPastDate || anySFPassed || sfOver;

      if (activeCount > 0 || anyOver) {
        if (anyOver) card.classList.add('overdue');

        card.appendChild(client);
        card.appendChild(calls);

        // Countdown chip (optional)
        if (sfTarget) {
          const chip = document.createElement('div');
          chip.className = 'countdown';
          card.appendChild(chip);

          const tick = () => {
            const diff = sfTarget - new Date();
            if (diff <= 0) {
              chip.textContent = 'Overdue';
              chip.classList.add('overdue');
              card.classList.add('overdue');
              clearInterval(t);
              return;
            }
            chip.textContent = formatDHMS(diff);
          };
          tick();
          const t = setInterval(tick, 1000);
          countdownTimers.push(t);
        }

        cardsEl.appendChild(card);
        if (activeCount > 0) shown++;
      }
    } // for-of end

    // counters + empty-state
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
    outcomeSel.value = '';
    markInfo.textContent = `Call-${dueCall.callN} | Scheduled: ${dueCall.callDate}`;

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
        const host = orFrameWrap.querySelector('.iframe-host');
        if (host) {
          if (window.innerHeight < 760) host.classList.add('compact');
          else host.classList.remove('compact');
        }
      }
      if (!msgHandlerBound) {
        window.addEventListener('message', onChildMessage, false);
        msgHandlerBound = true;
      }
      btnSubmit.disabled = false;
      btnSubmit.classList.add('enabled');

    } else {
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
      plannedDate: modalContext.dateISO,
    };

    if (outcome === 'SF') {
      if (!sfWhen.value) return showToast('Please select date & time for next follow-up.');
      payload.scheduleAt = sfWhen.value;
    }

    try {
      toggleLoader(true);
      await apiPOST('mark', payload);
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
})();
