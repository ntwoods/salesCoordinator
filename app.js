/* global google */
(function(){
  const CFG = window.APP_CONFIG;
  const qs = (sel) => document.querySelector(sel);
  const loginView = qs('#loginView');
  const mainView = qs('#mainView');
  const cardsEl = qs('#cards');
  const emptyState = qs('#emptyState');
  const todayTag = qs('#todayTag');

  const userEmailEl = qs('#userEmail');
  const userPicEl = qs('#userPic');
  const signOutBtn = qs('#btnSignOut');
  const toastEl = qs('#toast');

  const modal = qs('#modal');
  const outcomeSel = qs('#outcome');
  const remarkInput = qs('#remark');
  const markInfo = qs('#markInfo');
  const btnCancel = qs('#btnCancel');
  const btnSubmit = qs('#btnSubmit');

  let modalContext = null;
  let idToken = null;
  let userInfo = null;

  // ---------- Google Sign-in ----------
  window.onload = () => {
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
  };

  async function handleCredentialResponse(resp) {
    try {
      idToken = resp.credential;
      const who = await apiGET('me');
      userInfo = who.user;
      userEmailEl.textContent = userInfo.email;
      userPicEl.src = userInfo.picture || '';
      loginView.classList.add('hidden');
      mainView.classList.remove('hidden');
      await loadDue();
    } catch (err) {
      showError('#loginError', err.message || String(err));
    }
  }

  // ---------- API ----------
  async function apiGET(path) {
    const url = `${CFG.GAS_BASE}?path=${encodeURIComponent(path)}&id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'GET failed');
    return json;
  }

  async function apiPOST(path, body) {
    const res = await fetch(CFG.GAS_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id_token: idToken, ...body })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'POST failed');
    return json;
  }

  // ---------- Load Due ----------
  async function loadDue() {
    cardsEl.innerHTML = '';
    emptyState.classList.add('hidden');

    const data = await apiGET('due');
    const todayISO = data.today;
    const today = new Date(todayISO);
    todayTag.textContent = today.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

    const items = data.items || [];
    qs('#countDue').textContent = items.length;
    qs('#countOverdue').textContent = items.filter(it =>
      it.dueCalls.some(d => new Date(d.callDate) < today)
    ).length;

    if (!items.length) {
      emptyState.classList.remove('hidden');
      return;
    }

    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card-sm';

      const client = document.createElement('div');
      client.className = 'client';
      client.textContent = it.clientName;

      const calls = document.createElement('div');
      calls.className = 'calls';

      // Create a date button for each due/overdue call
      it.dueCalls.forEach(dc => {
        const btn = document.createElement('button');
        btn.className = 'btn light';
        btn.textContent = new Date(dc.callDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        btn.title = `Call-${dc.callN} (${dc.callDate})`;
        btn.addEventListener('click', () => openModal(it, dc, todayISO));
        calls.appendChild(btn);
      });

      card.appendChild(client);
      card.appendChild(calls);
      cardsEl.appendChild(card);
    }
  }

  // ---------- Modal ----------
  function openModal(item, dueCall, todayISO) {
    modalContext = {
      rowIndex: item.rowIndex,
      dateISO: todayISO,
      day: item.dayToMark,
      callN: dueCall.callN,
      clientName: item.clientName,
      callDate: dueCall.callDate
    };
    qs('#modalTitle').textContent = `Follow-up for ${item.clientName}`;
    remarkInput.value = '';
    outcomeSel.value = 'OK';
    markInfo.textContent = `Call-${dueCall.callN} | Scheduled: ${dueCall.callDate} | Will mark today's column (${item.dayColA1}).`;
    modal.classList.remove('hidden');
  }

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
    modalContext = null;
  });

  btnSubmit.addEventListener('click', async () => {
    if (!modalContext) return;
    const outcome = outcomeSel.value;
    const remark = remarkInput.value.trim();
    if (outcome !== 'OK' && remark.length === 0)
      return showToast('Remark required for non-OK outcomes.');

    try {
      await apiPOST('mark', {
        rowIndex: modalContext.rowIndex,
        date: modalContext.dateISO,
        outcome,
        remark,
        callN: modalContext.callN
      });
      showToast(`Marked Call-${modalContext.callN} done.`);
      modal.classList.add('hidden');
      modalContext = null;
      await loadDue();
    } catch (err) {
      showToast(err.message || String(err));
    }
  });

  // ---------- Sign out ----------
  signOutBtn.addEventListener('click', () => {
    google.accounts.id.disableAutoSelect();
    idToken = null;
    userInfo = null;
    cardsEl.innerHTML = '';
    mainView.classList.add('hidden');
    loginView.classList.remove('hidden');
  });

  // ---------- Helpers ----------
  function showError(sel, msg){
    const el = qs(sel);
    el.textContent = msg;
    el.classList.remove('hidden');
  }
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }
})();
