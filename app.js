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
  const appLoader = qs('#appLoader');

  const modal = qs('#modal');
  const outcomeSel = qs('#outcome');
  const remarkInput = qs('#remark');
  const markInfo = qs('#markInfo');
  const btnCancel = qs('#btnCancel');
  const btnSubmit = qs('#btnSubmit');

  // New controls
  const orBlock = qs('#orBlock');
  const orFile = qs('#orFile');
  const sfBlock = qs('#sfBlock');
  const sfWhen = qs('#sfWhen');

  let modalContext = null;
  let idToken = null;
  let userInfo = null;
  let countdownTimers = [];

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
      toggleLoader(true);
      const who = await apiGET('me');
      userInfo = who.user;
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

  // ---------- API ----------
  async function apiGET(path) {
    const url = `${CFG.GAS_BASE}?path=${encodeURIComponent(path)}&id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'GET failed');
    return json;
  }

  // For JSON payloads (including base64 file)
  async function apiPOST(path, body) {
    await fetch(CFG.GAS_BASE, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, id_token: idToken, ...body })
    });
  }

  // ---------- Helpers for week-window ----------
  function monthLastDate(d){
    const dt = new Date(d.getFullYear(), d.getMonth()+1, 0);
    dt.setHours(23,59,59,999);
    return dt;
  }
  function weekWindowEnd(dateObj){
    // 1-7 -> 7, 8-14 -> 14, 15-22 -> 22, 23-end -> end
    const dd = dateObj.getDate();
    const endDay = dd <= 7 ? 7 : dd <= 14 ? 14 : dd <= 22 ? 22 : monthLastDate(dateObj).getDate();
    const end = new Date(dateObj.getFullYear(), dateObj.getMonth(), endDay, 23,59,59,999);
    return end;
  }

  // ---------- Load Due ----------
  async function loadDue() {
    // clear timers
    countdownTimers.forEach(clearInterval);
    countdownTimers = [];

    cardsEl.innerHTML = '';
    emptyState.classList.add('hidden');

    toggleLoader(true);
    const data = await apiGET('due');
    toggleLoader(false);

    const todayISO = data.today;               // "YYYY-MM-DD" (IST midnight)
    const today = new Date(todayISO);          // Local Date at 00:00 IST-equivalent
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
        const dateObj = new Date(dc.callDate + 'T00:00:00');
        const btn = document.createElement('button');
        btn.className = 'btn light';
        btn.textContent = dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        btn.title = `Call-${dc.callN} (${dc.callDate})`;

        // Active till week-window end
        const windowEnd = weekWindowEnd(dateObj);
        const now = new Date();
        const active = now.getTime() <= windowEnd.getTime();

        if (!active) {
          btn.disabled = true;
          btn.classList.add('disabled');
          btn.title += ' (expired)';
        } else {
          btn.addEventListener('click', () => openModal(it, dc, todayISO));
        }
        calls.appendChild(btn);
      });

      // Countdown (if any upcoming scheduled follow-up datetime exists)
      if (it.upcoming && it.upcoming.when) {
        const chip = document.createElement('div');
        chip.className = 'countdown';
        card.appendChild(chip);

        const target = new Date(it.upcoming.when);
        const tick = () => {
          const now = new Date();
          const diff = target - now;
          if (diff <= 0) {
            chip.textContent = 'Overdue';
            chip.classList.add('overdue');
            return;
          }
          chip.textContent = formatDHMS(diff);
        };
        tick();
        const t = setInterval(tick, 1000);
        countdownTimers.push(t);
      }

      card.appendChild(client);
      card.appendChild(calls);
      cardsEl.appendChild(card);
    }
  }

  function formatDHMS(ms){
    const s = Math.floor(ms/1000);
    const d = Math.floor(s/86400);
    const h = Math.floor((s%86400)/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    return `${d}d ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  // ---------- Modal ----------
  function openModal(item, dueCall, todayISO) {
    modalContext = {
      rowIndex: item.rowIndex,
      dateISO: todayISO,
      day: item.dayToMark,
      callN: dueCall.callN,
      clientName: item.clientName,
      callDate: dueCall.callDate // planned date (ISO)
    };
    qs('#modalTitle').textContent = `Follow-up for ${item.clientName}`;
    remarkInput.value = '';
    outcomeSel.value = 'OK';
    markInfo.textContent = `Call-${dueCall.callN} | Scheduled: ${dueCall.callDate} | Will mark today's column (${item.dayColA1}).`;

    // reset dynamic blocks
    orBlock.classList.add('hidden'); orFile.value = '';
    sfBlock.classList.add('hidden'); sfWhen.value = '';

    modal.classList.remove('hidden');
  }

  outcomeSel.addEventListener('change', () => {
    const v = outcomeSel.value;
    orBlock.classList.toggle('hidden', v !== 'OR');
    sfBlock.classList.toggle('hidden', v !== 'SF');
  });

  btnCancel.addEventListener('click', () => {
    modal.classList.add('hidden');
    modalContext = null;
  });

  btnSubmit.addEventListener('click', async () => {
    if (!modalContext) return;

    const outcome = outcomeSel.value;
    const remark = (remarkInput.value || '').trim();

    if (outcome !== 'OK' && remark.length === 0 && outcome !== 'OR' && outcome !== 'SF')
      return showToast('Remark required for non-OK outcomes.');

    // Build payload
    let payload = {
      rowIndex: modalContext.rowIndex,
      date: modalContext.dateISO,
      outcome,
      remark,
      callN: modalContext.callN,
      plannedDate: modalContext.callDate // for Activity Log
    };

    // OR: attach file as base64
    if (outcome === 'OR') {
      if (!orFile.files || !orFile.files[0]) return showToast('Please choose an order file.');
      const f = orFile.files[0];
      const base64 = await fileToBase64(f);
      payload.orFile = {
        name: f.name,
        type: f.type || 'application/octet-stream',
        base64
      };
    }

    // SF: require datetime-local
    if (outcome === 'SF') {
      if (!sfWhen.value) return showToast('Please select date & time.');
      payload.scheduleAt = sfWhen.value; // e.g. 2025-10-05T17:30
    }

    try {
      toggleLoader(true);
      await apiPOST('mark', payload);
      showToast(`Saved: ${outcome}`);
      modal.classList.add('hidden');
      modalContext = null;
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
  function toggleLoader(on){ appLoader.classList.toggle('hidden', !on); }
  function fileToBase64(file){
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const res = String(fr.result);
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma+1) : res);
      };
      fr.onerror = () => reject(fr.error || new Error('File read error'));
      fr.readAsDataURL(file);
    });
  }
})();
