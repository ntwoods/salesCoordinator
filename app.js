/* global google */
(function(){
  const CFG = window.APP_CONFIG;
  const qs = (sel) => document.querySelector(sel);

  // DOM
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
  const orBlock = qs('#orBlock');     // legacy file-upload block (now hidden for OR)
  const orFile = qs('#orFile');       // legacy file input (unused now)
  const sfBlock = qs('#sfBlock');
  const sfWhen = qs('#sfWhen');
  const orFrameWrap = qs('#orFrameWrap'); // NEW: iframe container
  const orFrame = qs('#orFrame');         // NEW: iframe

  let modalContext = null;
  let idToken = null;
  let userInfo = null;
  let countdownTimers = [];

  // Handshake state for iframe + postMessage
  let childDone = false;
  let msgHandlerBound = false;

  // ---------- Google Sign-in ----------
  window.onload = () => {
    google.accounts.id.initialize({
      client_id: CFG.CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      ux_mode: 'popup',
    });
    google.accounts.id.renderButton(
      qs('#g_id_signin'),
      { theme: 'outline', size: 'large', width: 280 }
    );
  };

  async function handleCredentialResponse(resp){
    try {
      toggleLoader(true);
      const credential = resp.credential;
      const parts = credential.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      idToken = credential;
      userInfo = {
        email: payload.email,
        name: payload.name,
        picture: payload.picture
      };
      userEmailEl.textContent = userInfo.email;
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
    await fetch(CFG.GAS_BASE, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id_token: idToken, ...body })
    });
  }

  let autoRefreshTimer = null;
  let autoRefreshPaused = false;

  // Start auto refresh (runs every 30s)
  function startAutoRefresh() {
    stopAutoRefresh(); // clear previous interval
    if (autoRefreshPaused) return; // do not start when modal open
    autoRefreshTimer = setInterval(() => {
      if (!autoRefreshPaused) {
        loadDue('silent'); // 'silent' to prevent loader flicker
      }
    }, 30000);
  }

  // Stop auto refresh manually
  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  // Pause when modal opens
  function pauseAutoRefresh() {
    autoRefreshPaused = true;
    stopAutoRefresh();
  }

  // Resume when modal closes
  function resumeAutoRefresh() {
    autoRefreshPaused = false;
    startAutoRefresh();
  }

  // ---------- Week/SF window helpers ----------
  function monthLastDate(d){
    const dt = new Date(d.getFullYear(), d.getMonth()+1, 0);
    dt.setHours(23,59,59,999);
    return dt;
  }
  function weekWindowEnd(dateObj){
    const dd = dateObj.getDate();
    const endDay = dd <= 7 ? 7 : dd <= 14 ? 14 : dd <= 22 ? 22 : monthLastDate(dateObj).getDate();
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), endDay, 23,59,59,999);
  }
  function hasTimeComponent(dt){
    return dt instanceof Date && !isNaN(dt) && (dt.getHours() + dt.getMinutes() + dt.getSeconds()) !== 0;
  }

  // ---------- Load Due ----------
  async function loadDue(mode) {
    countdownTimers.forEach(clearInterval);
    countdownTimers = [];
    cardsEl.innerHTML = '';
    emptyState.classList.add('hidden');
    todayTag.textContent = new Date().toLocaleDateString();

    if (mode !== 'silent') toggleLoader(true);
    try {
      const { data } = await apiGET('due');
      if (!data || !data.length) {
        emptyState.classList.remove('hidden');
        return;
      }
      renderCards(data);
    } catch (err) {
      showToast(err.message || String(err));
    } finally {
      if (mode !== 'silent') toggleLoader(false);
      startAutoRefresh();
    }
  }

  // ---------- Render ----------
  function renderCards(items){
    const fr = document.createDocumentFragment();
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';

      const hdr = document.createElement('div');
      hdr.className = 'card-hdr';
      hdr.innerHTML = `
        <div class="title">${item.clientName}</div>
        <div class="meta">${item.city || ''}</div>
      `;

      const body = document.createElement('div');
      body.className = 'card-body';

      const dueDatesWrap = document.createElement('div');
      dueDatesWrap.className = 'dates-wrap';

      (item.dueCalls || []).forEach(dc => {
        const btn = document.createElement('button');
        btn.className = 'btn date-btn';
        btn.textContent = new Date(dc.callDate).toLocaleDateString() + ` · Call-${dc.callN}`;
        btn.addEventListener('click', () => openModal(item, dc, new Date().toISOString().slice(0,10)));
        dueDatesWrap.appendChild(btn);
      });

      body.appendChild(dueDatesWrap);

      const ftr = document.createElement('div');
      ftr.className = 'card-ftr';
      ftr.innerHTML = `
        <span class="tag ${item.priority || ''}">${item.priority || ''}</span>
        <span class="countdown" data-deadline="${item.deadline || ''}"></span>
      `;

      card.appendChild(hdr);
      card.appendChild(body);
      card.appendChild(ftr);
      fr.appendChild(card);
    });
    cardsEl.appendChild(fr);
    initCountdowns();
  }

  function initCountdowns(){
    (cardsEl.querySelectorAll('.countdown') || []).forEach(el => {
      const deadlineISO = el.getAttribute('data-deadline');
      if (!deadlineISO) return;
      const dd = new Date(deadlineISO);
      const id = setInterval(() => {
        const now = new Date();
        const ms = dd - now;
        if (ms <= 0) { el.textContent = 'Expired'; clearInterval(id); return; }
        el.textContent = pretty(ms);
      }, 1000);
      countdownTimers.push(id);
    });
  }
  function pretty(ms){
    const s = Math.floor(ms/1000);
    const d = Math.floor(s/86400);
    const h = Math.floor((s%86400)/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    return `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  // ---------- Modal ----------
  function openModal(item, dueCall, todayISO) {
    pauseAutoRefresh();
    modalContext = {
      rowIndex: item.rowIndex,
      dateISO: todayISO,        // aaj ke mark ke liye
      callN: dueCall.callN,
      clientName: item.clientName,
      callDate: dueCall.callDate // planned date (ISO)
    };
    qs('#modalTitle').textContent = `Follow-up for ${item.clientName}`;
    remarkInput.value = '';
    outcomeSel.value = '' /* placeholder */;
    markInfo.textContent = `Call-${dueCall.callN} | Scheduled: ${dueCall.callDate}`;

    if (orBlock) orBlock.classList.add('hidden'); if (orFile) orFile.value = '';
    if (sfBlock) { sfBlock.classList.add('hidden'); sfWhen.value = ''; }
    if (orFrameWrap) orFrameWrap.classList.add('hidden'); if (orFrame) orFrame.src='';
    childDone = false;
    modal.classList.remove('hidden');
  }

  outcomeSel.addEventListener('change', () => {
    const v = outcomeSel.value;

    if (orBlock) orBlock.classList.add('hidden'); // legacy upload hidden
    sfBlock.classList.toggle('hidden', v !== 'SF');

    if (v === 'OR') {
      // Build iframe URL with lightweight context
      const ctx = window.modalContext || {};
      const params = new URLSearchParams({
        clientName: ctx.clientName || '',
        callN: String(ctx.callN || ''),
        plannedDate: ctx.callDate || '',
        rowIndex: String(ctx.rowIndex || '')
      });
      const punchURL = `https://ntwoods.github.io/ordertodispatch/orderPunch.html?${params.toString()}`;
      if (orFrame) orFrame.src = punchURL;
      if (orFrameWrap) orFrameWrap.classList.remove('hidden');
      childDone = false;
      if (!msgHandlerBound) { window.addEventListener('message', onChildMessage, false); msgHandlerBound = true; }
    } else {
      if (orFrameWrap) orFrameWrap.classList.add('hidden');
      if (orFrame) orFrame.src = '';
      if (msgHandlerBound) { window.removeEventListener('message', onChildMessage, false); msgHandlerBound = false; }
      childDone = false;
    }
  });

  qs('#btnCancel').addEventListener('click', () => {
    modal.classList.add('hidden'); modalContext = null;
    if (orFrame) orFrame.src=''; if (orFrameWrap) orFrameWrap.classList.add('hidden');
    if (msgHandlerBound) { window.removeEventListener('message', onChildMessage, false); msgHandlerBound = false; }
    childDone = false;
    resumeAutoRefresh();
  });

  btnSubmit.addEventListener('click', async () => {
    if (!modalContext) return;
    resumeAutoRefresh();

    const outcome = outcomeSel.value;
    const remark = (remarkInput.value || '').trim();

    let payload = {
      rowIndex: modalContext.rowIndex,
      date: modalContext.dateISO,
      outcome,
      remark,
      callN: modalContext.callN,
      plannedDate: modalContext.callDate
    };

    if (outcome === '') { showToast('Please select an outcome'); return; }
    if (outcome === 'OR' && !childDone) { showToast('Please submit the Order Punch form first'); return; }
    // OR: no file upload from parent; child handles uploads

    if (outcome === 'SF') {
      if (!sfWhen.value) return showToast('Please select date & time for next follow-up.');
      payload.scheduleAt = sfWhen.value; // 2025-10-26T17:30
    }

    try {
      toggleLoader(true);
      await apiPOST('mark', payload);
      showToast(`Saved: ${outcome}`);
      modal.classList.add('hidden'); modalContext = null;
      await loadDue();
    } catch (err) {
      showToast(err.message || String(err));
    } finally {
      toggleLoader(false);
    }
  });

  // ---------- Sign out ----------
  signOutBtn.addEventListener('click', () => {
    google.accounts.id.disableAutoSelect();
    idToken = null; userInfo = null;
    cardsEl.innerHTML = '';
    mainView.classList.add('hidden');
    loginView.classList.remove('hidden');
  });

  // ---------- postMessage handler (iframe -> parent) ----------
  function onChildMessage(event){
    if (event.origin !== 'https://ntwoods.github.io') return;
    const msg = event.data || {};
    if (msg && msg.type === 'ORDER_PUNCHED') {
      childDone = true;
      showToast('Order form submitted. You can proceed.');
    }
  }

  // ---------- Utils ----------
  function showError(sel, msg){ const el = qs(sel); el.textContent = msg; el.classList.remove('hidden'); }
  function showToast(msg){ toastEl.textContent = msg; toastEl.classList.remove('hidden'); setTimeout(()=>toastEl.classList.add('hidden'), 2200); }
  function toggleLoader(on){ appLoader.classList.toggle('hidden', !on); }
  function fileToBase64(file){
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => { const s = String(fr.result); const i = s.indexOf(','); resolve(i>=0 ? s.slice(i+1) : s); };
      fr.onerror = () => reject(fr.error || new Error('File read error'));
      fr.readAsDataURL(file);
    });
  }
})();
