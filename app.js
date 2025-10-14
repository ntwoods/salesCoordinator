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

  // Modal elements
  const modal = qs('#modal');
  const outcomeSel = qs('#outcome');
  const remarkInput = qs('#remark');
  const markInfo = qs('#markInfo');
  const btnCancel = qs('#btnCancel');
  const btnSubmit = qs('#btnSubmit');
  let modalContext = null; // {rowIndex, dateISO, day, clientName}

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
      // Verify / WhoAmI
      const who = await apiGET('me');
      userInfo = who.user;
      // UI
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
    const res = await fetch(url, { method:'GET', credentials:'omit' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'GET failed');
    return json;
  }
  async function apiPOST(path, body) {
    const res = await fetch(CFG.GAS_BASE, {
      method:'POST',
      mode:'no-cors',      
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id_token: idToken, ...body }),
      credentials:'omit'
    });
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

    // Counters
    qs('#countDue').textContent = items.length;
    qs('#countOverdue').textContent = items.filter(it => {
      // overdue if smallest call date < today
      const c = it.resolvedCallDate ? new Date(it.resolvedCallDate) : null;
      return c && c < today;
    }).length;

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
      const labels = ['Call-1','Call-2','Call-3','Call-4'];
      it.calls.forEach((d, idx) => {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = `${labels[idx]}: ${d || '—'}`;
        calls.appendChild(span);
      });

      const btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.textContent = 'Call Response';
      btn.addEventListener('click', () => openModal(it, todayISO));

      card.appendChild(client);
      card.appendChild(calls);
      card.appendChild(btn);
      cardsEl.appendChild(card);
    }
  }

  // ---------- Modal ----------
  function openModal(item, todayISO) {
    modalContext = {
      rowIndex: item.rowIndex,
      dateISO: todayISO,
      day: item.dayToMark,
      clientName: item.clientName
    };
    qs('#modalTitle').textContent = `Call Response — ${item.clientName}`;
    remarkInput.value = '';
    outcomeSel.value = 'OK';
    markInfo.textContent = `Will mark column for day ${item.dayToMark} (${item.dayColA1}).`;
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
    if (outcome !== 'OK' && remark.length === 0) {
      return showToast('Remark is required for non-OK outcomes.');
    }
    try {
      await apiPOST('mark', {
        rowIndex: modalContext.rowIndex,
        date: modalContext.dateISO,
        outcome,
        remark,
      });
      showToast('Saved.');
      modal.classList.add('hidden');
      modalContext = null;
      await loadDue(); // refresh list
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
