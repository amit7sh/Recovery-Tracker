// ─────────────────────────────────────────────────────────────────────────────
// Health Recovery Tracker — app.js
// ─────────────────────────────────────────────────────────────────────────────

const CALCIUM_GOAL = 1500; // mg/day
const USDA_KEY = 'DEMO_KEY';
const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

// ── Utilities ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysFromNow(dateStr) {
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - now) / 86400000);
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, duration);
}

// ── Storage ───────────────────────────────────────────────────────────────────

const DB = {
  _cache: {},

  get(key) {
    if (this._cache[key] !== undefined) return this._cache[key];
    try { return JSON.parse(localStorage.getItem('ht_' + key) || '[]'); }
    catch { return []; }
  },

  add(key, item) {
    item.id = Date.now() + Math.random();
    item.createdAt = new Date().toISOString();
    const data = [...this.get(key), item];
    this._cache[key] = data;
    localStorage.setItem('ht_' + key, JSON.stringify(data));
    CloudSync.saveItem(key, item);
    return item;
  },

  remove(key, id) {
    const data = this.get(key).filter(x => x.id !== id);
    this._cache[key] = data;
    localStorage.setItem('ht_' + key, JSON.stringify(data));
    CloudSync.deleteItem(key, id);
  },

  update(key, id, patch) {
    const data = this.get(key).map(x => x.id === id ? { ...x, ...patch } : x);
    this._cache[key] = data;
    localStorage.setItem('ht_' + key, JSON.stringify(data));
    const updated = data.find(x => x.id === id);
    if (updated) CloudSync.saveItem(key, updated);
  }
};

// ── Cloud Sync (Firebase) ─────────────────────────────────────────────────────

const CloudSync = {
  uid: null,
  db: null,
  auth: null,

  init() {
    const firebaseConfig = {
      apiKey: "AIzaSyCWerPRQuuP9tybXrW7QrwoqTsBKiY2eOs",
      authDomain: "health-tracker-b2e8f.firebaseapp.com",
      projectId: "health-tracker-b2e8f",
      storageBucket: "health-tracker-b2e8f.firebasestorage.app",
      messagingSenderId: "580343331578",
      appId: "1:580343331578:web:2f8f10bde70e26d3f96743"
    };
    firebase.initializeApp(firebaseConfig);
    this.auth = firebase.auth();
    this.db = firebase.firestore();

    this.auth.onAuthStateChanged(async user => {
      if (user) {
        this.uid = user.uid;
        document.getElementById('auth-overlay').classList.add('hidden');
        document.getElementById('sidebar-user-name').textContent = user.displayName?.split(' ')[0] || 'You';
        await this.loadAll();
        App.navigate('dashboard');
        if ('Notification' in window && Notification.permission === 'granted') {
          ApptsPage.scheduleNotifications();
        }
      } else {
        this.uid = null;
        document.getElementById('auth-overlay').classList.remove('hidden');
      }
    });
  },

  signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    this.auth.signInWithPopup(provider).catch(() => {
      this.auth.signInWithRedirect(provider);
    });
  },

  signOut() {
    if (!confirm('Sign out? Your data stays saved in the cloud.')) return;
    this.auth.signOut();
  },

  _col(key) {
    return this.db.collection('users').doc(this.uid).collection(key);
  },

  async loadAll() {
    const collections = ['calcium', 'symptoms', 'medical', 'medications', 'appointments', 'photos', 'custom_foods'];
    try {
      await Promise.all(collections.map(async key => {
        const snap = await this._col(key).get();
        if (!snap.empty) {
          DB._cache[key] = snap.docs.map(d => d.data());
        } else {
          // First sign-in — migrate any existing localStorage data to cloud
          const local = (() => { try { return JSON.parse(localStorage.getItem('ht_' + key) || '[]'); } catch { return []; } })();
          DB._cache[key] = local;
          if (local.length) {
            await Promise.all(local.map(item => this._col(key).doc(String(item.id)).set(item)));
          }
        }
      }));
    } catch (err) {
      console.error('Firestore load failed, using local data:', err);
      showToast('Using local data (check connection)');
    }
    this.listenAll();
  },

  listenAll() {
    const collections = ['calcium', 'symptoms', 'medical', 'medications', 'appointments', 'photos', 'custom_foods'];
    collections.forEach(key => {
      this._col(key).onSnapshot(snap => {
        DB._cache[key] = snap.docs.map(d => d.data());
        localStorage.setItem('ht_' + key, JSON.stringify(DB._cache[key]));
        if (App.current) this._rerenderCurrent();
      });
    });
  },

  _rerenderCurrent() {
    const renders = {
      dashboard: () => DashboardPage.render(),
      calcium: () => CalciumPage.render(),
      symptoms: () => SymptomsPage.render(),
      medical: () => MedicalPage.render(),
      medications: () => MedsPage.render(),
      appointments: () => ApptsPage.render(),
      articles: () => ArticlesPage.render(),
    };
    renders[App.current]?.();
  },

  saveItem(key, item) {
    if (!this.uid || !this.db) return;
    this._col(key).doc(String(item.id)).set(item).catch(console.error);
  },

  deleteItem(key, id) {
    if (!this.uid || !this.db) return;
    this._col(key).where('id', '==', id).get()
      .then(snap => Promise.all(snap.docs.map(doc => doc.ref.delete())))
      .catch(console.error);
  },
};

// ── File Storage (IndexedDB for photos & attachments) ─────────────────────────

const FileDB = {
  _db: null,

  _open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ht_files', 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore('files', { keyPath: 'id' });
      };
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  _cloudCol() {
    return CloudSync.db.collection('users').doc(CloudSync.uid).collection('files');
  },

  // Compress images to stay under Firestore's 1MB document limit
  _compress(dataUrl, type) {
    return new Promise(resolve => {
      if (!type.startsWith('image/')) return resolve(dataUrl);
      const img = new Image();
      img.onload = () => {
        const MAX = 1000;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  },

  save(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const id = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this._compress(e.target.result, file.type).then(dataUrl => {
          const record = { id, name: file.name, type: file.type, size: file.size, dataUrl };
          // Save to IndexedDB locally
          this._open().then(db => {
            const tx = db.transaction('files', 'readwrite');
            tx.objectStore('files').add(record);
            tx.oncomplete = () => resolve(id);
            tx.onerror = () => reject(tx.error);
          }).catch(reject);
          // Save to Firestore for cross-device access
          if (CloudSync.uid && CloudSync.db) {
            // Check size — Firestore limit is ~1MB per document
            if (dataUrl.length < 900000) {
              this._cloudCol().doc(id).set(record).catch(console.error);
            } else {
              showToast('File too large to sync — saved locally only.');
            }
          }
        });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  },

  get(id) {
    return this._open().then(db => new Promise(resolve => {
      const req = db.transaction('files', 'readonly').objectStore('files').get(id);
      req.onsuccess = () => {
        if (req.result) return resolve(req.result);
        // Not in local IndexedDB — fetch from Firestore
        if (!CloudSync.uid || !CloudSync.db) return resolve(null);
        this._cloudCol().doc(id).get()
          .then(doc => {
            if (!doc.exists) return resolve(null);
            const record = doc.data();
            // Cache locally for next time
            this._open().then(db2 => {
              const tx = db2.transaction('files', 'readwrite');
              tx.objectStore('files').put(record);
            });
            resolve(record);
          })
          .catch(() => resolve(null));
      };
      req.onerror = () => resolve(null);
    }));
  },

  delete(id) {
    this._open().then(db => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
    });
    if (CloudSync.uid && CloudSync.db) {
      this._cloudCol().doc(id).delete().catch(() => {});
    }
    return Promise.resolve();
  }
};

// ── Router ────────────────────────────────────────────────────────────────────

const PAGE_LABELS = {
  dashboard: 'Home', calcium: 'Calcium', symptoms: 'Symptoms',
  medical: 'Records', medications: 'Medications',
  appointments: 'Appointments', articles: 'Articles'
};

const App = {
  current: null,

  navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.nav-btn[data-page="${page}"]`).forEach(b => b.classList.add('active'));

    const mobileTitle = document.getElementById('mobile-page-title');
    if (mobileTitle) mobileTitle.textContent = PAGE_LABELS[page] || '';

    this.current = page;
    window.scrollTo(0, 0);

    const renders = {
      dashboard: () => DashboardPage.render(),
      calcium: () => CalciumPage.render(),
      symptoms: () => SymptomsPage.render(),
      medical: () => MedicalPage.render(),
      medications: () => MedsPage.render(),
      appointments: () => ApptsPage.render(),
      articles: () => ArticlesPage.render(),
    };
    renders[page]?.();
  },

  openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    document.body.classList.add('modal-open');
  },

  closeModal(event) {
    if (event && event.target !== document.getElementById('modal-overlay')) return;
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    document.body.classList.remove('modal-open');
  },

  forceCloseModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    document.body.classList.remove('modal-open');
  }
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

const TIPS = [
  "Rest is active recovery — your body is rebuilding bone tissue right now.",
  "Vitamin D helps your body absorb calcium. 15 minutes of sunlight goes a long way.",
  "Staying hydrated supports bone health and reduces inflammation.",
  "Sleep is when most bone repair happens. Prioritise 8–9 hours.",
  "Dairy isn't the only calcium source — broccoli, almonds, and tofu are great too.",
  "Consistent partial weight bearing, as your doctor prescribes, helps bone remodelling.",
  "Writing down how you feel each day helps you and your doctors see real progress.",
  "Small wins count. Note any improvement in pain level, no matter how small.",
  "Calcium citrate is absorbed better on an empty stomach than calcium carbonate.",
  "Stress can affect bone health. Gentle breathing exercises can help recovery.",
  "Track your appointments — follow-ups are where recovery milestones get confirmed.",
  "Your body is not broken. It's asking for more support, and you're listening.",
];

const DashboardPage = {
  render() {
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    document.getElementById('dash-greeting').textContent = greeting;
    document.getElementById('dash-date').textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });

    // Calcium
    const today = todayStr();
    const calEntries = DB.get('calcium').filter(e => e.date === today);
    const calTotal = calEntries.reduce((s, e) => s + (e.calcium_mg || 0), 0);
    const pct = Math.min(100, Math.round(calTotal / CALCIUM_GOAL * 100));
    document.getElementById('dash-calcium-total').textContent = Math.round(calTotal) + ' mg';
    document.getElementById('dash-calcium-bar').style.width = pct + '%';
    document.getElementById('dash-calcium-pct').textContent = pct + '% of 1500mg goal';

    // Pain
    const syms = DB.get('symptoms').filter(s => s.date === today);
    if (syms.length) {
      const latest = syms[syms.length - 1];
      const pain = latest.pain;
      const col = pain <= 3 ? 'text-emerald-600' : pain <= 6 ? 'text-amber-600' : 'text-red-600';
      document.getElementById('dash-pain').innerHTML = `<span class="${col}">${pain}/10</span>`;
      document.getElementById('dash-pain-label').textContent = 'Logged today';
    } else {
      document.getElementById('dash-pain').textContent = '—';
      document.getElementById('dash-pain-label').textContent = 'No log today';
    }

    // Next appointment
    const upcoming = DB.get('appointments')
      .filter(a => a.date >= today && !a.done)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (upcoming.length) {
      const next = upcoming[0];
      const days = daysFromNow(next.date);
      document.getElementById('dash-next-appt').textContent = next.doctor || next.type || 'Appointment';
      document.getElementById('dash-next-appt-date').textContent =
        days === 0 ? 'TODAY' : days === 1 ? 'Tomorrow' : `In ${days} days`;
    } else {
      document.getElementById('dash-next-appt').textContent = 'None scheduled';
      document.getElementById('dash-next-appt-date').textContent = '';
    }

    // Meds
    const meds = DB.get('medications');
    if (meds.length) {
      const taken = meds.filter(m => (m.takenDates || []).includes(today)).length;
      document.getElementById('dash-meds-taken').textContent = `${taken}/${meds.length}`;
      document.getElementById('dash-meds-label').textContent = taken === meds.length ? '✓ All taken' : 'taken today';
    } else {
      document.getElementById('dash-meds-taken').textContent = '—';
      document.getElementById('dash-meds-label').textContent = 'No medications';
    }

    // Tip (rotates by day of year)
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    document.getElementById('dash-tip').textContent = TIPS[dayOfYear % TIPS.length];

    // Calendar
    CalendarWidget.render();
  }
};

// ── Activity Calendar ─────────────────────────────────────────────────────────

const CalendarWidget = {
  year: null,
  month: null,

  init() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  },

  render() {
    if (this.year === null) this.init();
    const { year, month } = this;

    const label = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('cal-widget-month-label').textContent = label;

    // Collect all events keyed by YYYY-MM-DD
    const events = {};
    const add = (dateStr, type, item) => {
      if (!dateStr) return;
      if (!events[dateStr]) events[dateStr] = { appts: [], symptoms: [], calcium: [], meds: [], photos: [], medical: [] };
      events[dateStr][type].push(item);
    };

    DB.get('appointments').forEach(a => add(a.date, 'appts', a));
    DB.get('symptoms').forEach(s => add(s.date, 'symptoms', s));
    DB.get('calcium').forEach(c => add(c.date, 'calcium', c));
    DB.get('medications').forEach(m => (m.takenDates || []).forEach(d => add(d, 'meds', m)));
    DB.get('photos').forEach(p => add(p.date, 'photos', p));
    DB.get('medical').forEach(r => add(r.date, 'medical', r));

    const today = todayStr();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const grid = document.getElementById('cal-widget-grid');
    grid.innerHTML = '';

    // Leading empty cells
    for (let i = 0; i < firstDay; i++) {
      grid.insertAdjacentHTML('beforeend', '<div></div>');
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const ev = events[dateStr];
      const isToday = dateStr === today;
      const hasAppt    = ev?.appts?.length > 0;
      const hasSym     = ev?.symptoms?.length > 0;
      const hasCal     = ev?.calcium?.length > 0;
      const hasMeds    = ev?.meds?.length > 0;
      const hasPhotos  = ev?.photos?.length > 0;
      const hasMedical = ev?.medical?.length > 0;
      const hasAny     = hasAppt || hasSym || hasCal || hasMeds || hasPhotos || hasMedical;

      const baseCls = isToday
        ? 'bg-indigo-600 text-white'
        : hasAny
          ? 'hover:bg-indigo-50 cursor-pointer'
          : 'hover:bg-gray-50 cursor-pointer';

      grid.insertAdjacentHTML('beforeend', `
        <div onclick="CalendarWidget.showDay('${dateStr}')"
             class="relative flex flex-col items-center justify-center py-1.5 rounded-lg transition-colors ${baseCls}">
          <span class="text-xs ${isToday ? 'font-bold' : 'text-gray-700'}">${d}</span>
          ${hasAny ? `<div class="flex gap-0.5 mt-0.5">
            ${hasAppt    ? `<span class="w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white opacity-80' : 'bg-violet-500'}"></span>` : ''}
            ${hasSym     ? `<span class="w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white opacity-80' : 'bg-pink-500'}"></span>` : ''}
            ${hasCal     ? `<span class="w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white opacity-80' : 'bg-emerald-500'}"></span>` : ''}
            ${hasMeds    ? `<span class="w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white opacity-80' : 'bg-amber-500'}"></span>` : ''}
            ${hasPhotos  ? `<span class="w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white opacity-80' : 'bg-sky-500'}"></span>` : ''}
            ${hasMedical ? `<span class="w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white opacity-80' : 'bg-teal-500'}"></span>` : ''}
          </div>` : ''}
        </div>
      `);
    }
  },

  prevMonth() {
    if (this.month === 0) { this.month = 11; this.year--; }
    else this.month--;
    this.render();
  },

  nextMonth() {
    if (this.month === 11) { this.month = 0; this.year++; }
    else this.month++;
    this.render();
  },

  showDay(dateStr) {
    const appts    = DB.get('appointments').filter(a => a.date === dateStr);
    const symptoms = DB.get('symptoms').filter(s => s.date === dateStr);
    const calcium  = DB.get('calcium').filter(c => c.date === dateStr);
    const meds     = DB.get('medications').filter(m => (m.takenDates || []).includes(dateStr));
    const medical  = DB.get('medical').filter(r => r.date === dateStr);

    const noActivity = !appts.length && !symptoms.length && !calcium.length && !meds.length && !medical.length;
    let body = noActivity
      ? '<p class="text-sm text-gray-400 py-6 text-center">No activity recorded for this day.</p>'
      : '';

    if (appts.length) {
      body += `<div class="mb-5">
        <p class="text-xs font-semibold uppercase tracking-wide text-violet-600 mb-2">Appointments</p>
        ${appts.map(a => `
          <div class="bg-violet-50 rounded-xl p-3 mb-2">
            <p class="text-sm font-semibold text-gray-800">${a.doctor || 'Appointment'}</p>
            ${a.type     ? `<p class="text-xs text-gray-500 mt-0.5">${a.type}</p>` : ''}
            ${a.location ? `<p class="text-xs text-gray-500">📍 ${a.location}</p>` : ''}
            ${a.notes    ? `<p class="text-xs text-gray-600 mt-1 italic">${a.notes}</p>` : ''}
            ${a.done     ? `<span class="text-xs text-emerald-600 font-medium mt-1 block">✓ Completed</span>` : ''}
          </div>`).join('')}
      </div>`;
    }

    if (symptoms.length) {
      body += `<div class="mb-5">
        <p class="text-xs font-semibold uppercase tracking-wide text-pink-600 mb-2">Symptoms</p>
        ${symptoms.map(s => `
          <div class="bg-pink-50 rounded-xl p-3 mb-2">
            <div class="flex flex-wrap gap-4 text-sm">
              <span>Pain <strong>${s.pain}/10</strong></span>
              <span>Mobility <strong>${s.mobility}/10</strong></span>
              ${s.fatigue !== undefined ? `<span>Fatigue <strong>${s.fatigue}/10</strong></span>` : ''}
            </div>
            ${s.mood  ? `<p class="text-xs text-gray-500 mt-1">Mood: ${s.mood}</p>` : ''}
            ${s.notes ? `<p class="text-xs text-gray-600 mt-1 italic">${s.notes}</p>` : ''}
          </div>`).join('')}
      </div>`;
    }

    if (calcium.length) {
      const total = calcium.reduce((s, e) => s + (e.calcium_mg || 0), 0);
      body += `<div class="mb-5">
        <p class="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-2">Calcium — ${Math.round(total)} mg total</p>
        <div class="bg-emerald-50 rounded-xl p-3">
          ${calcium.map(c => `
            <div class="flex justify-between py-1.5 border-b border-emerald-100 last:border-0 text-sm">
              <span class="text-gray-700">${c.food}</span>
              <span class="font-medium text-emerald-700">${Math.round(c.calcium_mg)} mg</span>
            </div>`).join('')}
          <div class="flex justify-between pt-2 text-sm font-bold border-t border-emerald-200 mt-1">
            <span class="text-gray-700">Total</span>
            <span class="text-emerald-700">${Math.round(total)} / 1500 mg</span>
          </div>
        </div>
      </div>`;
    }

    if (meds.length) {
      body += `<div class="mb-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">Medications Taken</p>
        <div class="bg-amber-50 rounded-xl p-3">
          ${meds.map(m => `
            <div class="flex items-center gap-2 py-1.5 text-sm">
              <span class="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0"></span>
              <span class="text-gray-700">${m.name}${m.dose ? ' — ' + m.dose : ''}</span>
            </div>`).join('')}
        </div>
      </div>`;
    }

    if (medical.length) {
      body += `<div class="mb-5">
        <p class="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-2">Medical Records</p>
        ${medical.map(r => `
          <div class="bg-teal-50 rounded-xl p-3 mb-2">
            <p class="text-sm font-semibold text-gray-800">${r.title || 'Record'}</p>
            ${r.doctor    ? `<p class="text-xs text-gray-500 mt-0.5">Dr. ${r.doctor}</p>` : ''}
            ${r.specialty ? `<p class="text-xs text-gray-400">${r.specialty}</p>` : ''}
            ${r.values    ? `<p class="text-xs text-indigo-700 font-medium mt-1">📊 ${r.values}</p>` : ''}
            ${r.notes     ? `<p class="text-xs text-gray-600 mt-1 italic">${r.notes}</p>` : ''}
            ${(r.attachments||[]).length ? `<p class="text-xs text-sky-600 mt-1 cursor-pointer hover:underline" onclick="MedicalPage.openAttachments(${r.id})">📎 ${r.attachments.length} attachment${r.attachments.length > 1 ? 's' : ''}</p>` : ''}
          </div>`).join('')}
      </div>`;
    }

    // Photos section (always shown — allows adding even on days with no other activity)
    body += `
      <div>
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-sky-600">Photos</p>
          <label class="text-xs bg-sky-50 text-sky-600 px-2 py-1 rounded-lg hover:bg-sky-100 cursor-pointer">
            + Add Photo
            <input type="file" accept="image/*,application/pdf" multiple class="hidden"
                   onchange="CalendarWidget.handlePhotoUpload(this, '${dateStr}')" />
          </label>
        </div>
        <div id="cal-day-photos" class="grid grid-cols-3 gap-2">
          <p class="text-xs text-gray-400 col-span-3" id="cal-day-photos-empty">Loading photos…</p>
        </div>
      </div>`;

    App.openModal(fmtDate(dateStr), body);
    this._loadDayPhotos(dateStr);
  },

  _loadDayPhotos(dateStr) {
    const container = document.getElementById('cal-day-photos');
    const emptyMsg  = document.getElementById('cal-day-photos-empty');
    if (!container) return;

    const records = DB.get('photos').filter(p => p.date === dateStr);
    if (!records.length) {
      if (emptyMsg) emptyMsg.textContent = 'No photos yet.';
      return;
    }
    if (emptyMsg) emptyMsg.remove();

    records.forEach(p => {
      FileDB.get(p.fileId).then(file => {
        if (!file || !container) return;
        const isImage = file.type.startsWith('image/');
        container.insertAdjacentHTML('beforeend', `
          <div class="relative group rounded-xl overflow-hidden border border-gray-100">
            ${isImage
              ? `<img src="${file.dataUrl}" alt="${file.name}"
                      class="w-full h-24 object-cover cursor-pointer"
                      onclick="CalendarWidget.viewFile('${p.fileId}')" />`
              : `<div class="w-full h-24 flex flex-col items-center justify-center bg-gray-50 cursor-pointer gap-1"
                       onclick="CalendarWidget.viewFile('${p.fileId}')">
                   <span class="text-2xl">📄</span>
                   <span class="text-xs text-gray-500 truncate px-1 w-full text-center">${file.name}</span>
                 </div>`}
            <button onclick="CalendarWidget.deletePhoto('${p.id}', '${p.fileId}', '${dateStr}')"
                    class="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs
                           items-center justify-center hidden group-hover:flex leading-none">×</button>
          </div>`);
      });
    });
  },

  handlePhotoUpload(input, dateStr) {
    const files = Array.from(input.files);
    if (!files.length) return;
    let saved = 0;
    files.forEach(file => {
      FileDB.save(file).then(fileId => {
        DB.add('photos', { date: dateStr, fileId, name: file.name });
        saved++;
        if (saved === files.length) {
          showToast(`${saved} photo${saved > 1 ? 's' : ''} added ✓`);
          // Refresh photos in the open modal
          const container = document.getElementById('cal-day-photos');
          if (container) {
            container.innerHTML = '<p class="text-xs text-gray-400 col-span-3" id="cal-day-photos-empty">Loading photos…</p>';
            this._loadDayPhotos(dateStr);
          }
          // Re-render calendar grid to update dot
          this.render();
        }
      }).catch(() => showToast('Failed to save photo.'));
    });
    input.value = '';
  },

  viewFile(fileId) {
    FileDB.get(fileId).then(file => {
      if (!file) return;
      const arr = file.dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
      const blobUrl = URL.createObjectURL(new Blob([u8arr], { type: mime }));

      if (file.type.startsWith('image/')) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;align-items:center;justify-content:center;';
        const close = () => { document.body.removeChild(overlay); URL.revokeObjectURL(blobUrl); };
        overlay.innerHTML = `
          <button style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:22px;cursor:pointer;line-height:1;">✕</button>
          <img src="${blobUrl}" style="max-width:100%;max-height:100vh;object-fit:contain;padding:56px 16px 16px;" />`;
        overlay.querySelector('button').onclick = close;
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.body.appendChild(overlay);
      } else {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = file.name || 'attachment';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }
    });
  },

  deletePhoto(photoId, fileId, dateStr) {
    DB.remove('photos', parseFloat(photoId));
    FileDB.delete(fileId);
    const container = document.getElementById('cal-day-photos');
    if (container) {
      container.innerHTML = '<p class="text-xs text-gray-400 col-span-3" id="cal-day-photos-empty">Loading photos…</p>';
      this._loadDayPhotos(dateStr);
    }
    this.render();
  }
};

// ── Calcium Tracker ───────────────────────────────────────────────────────────

let calChart = null;

const CalciumPage = {
  render() {
    const dateInput = document.getElementById('cal-date');
    if (!dateInput.value) dateInput.value = todayStr();
    this.refreshLog();
    this.renderMyFoods();
    this.renderChart();
  },

  refreshLog() {
    const date = document.getElementById('cal-date').value || todayStr();
    const entries = DB.get('calcium').filter(e => e.date === date);
    const total = entries.reduce((s, e) => s + (e.calcium_mg || 0), 0);
    const pct = Math.min(100, Math.round(total / CALCIUM_GOAL * 100));

    document.getElementById('cal-total-display').textContent = Math.round(total) + ' mg';
    document.getElementById('cal-progress-bar').style.width = pct + '%';
    document.getElementById('cal-pct-label').textContent = pct + '% of goal';

    const list = document.getElementById('cal-log-list');
    if (!entries.length) {
      list.innerHTML = '<p class="text-sm text-gray-400">No entries for this date.</p>';
      return;
    }
    list.innerHTML = entries.map(e => `
      <div class="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
        <div>
          <p class="text-sm font-medium text-gray-800">${e.food}</p>
          ${e.grams ? `<p class="text-xs text-gray-400">${e.grams}g</p>` : ''}
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm font-bold text-indigo-600">${Math.round(e.calcium_mg)} mg</span>
          <button onclick="CalciumPage.deleteEntry(${e.id})" class="text-gray-300 hover:text-red-400 transition-colors text-sm">✕</button>
        </div>
      </div>
    `).join('');
  },

  async searchFood() {
    const query = document.getElementById('cal-search').value.trim();
    if (!query) return;
    const resultsEl = document.getElementById('cal-search-results');
    resultsEl.innerHTML = '<p class="text-sm text-gray-400 py-2">Searching...</p>';
    try {
      const res = await fetch(
        `${USDA_BASE}/foods/search?query=${encodeURIComponent(query)}&nutrients=1087&pageSize=8&api_key=${USDA_KEY}`
      );
      const data = await res.json();
      const foods = (data.foods || []).slice(0, 8);
      if (!foods.length) {
        resultsEl.innerHTML = '<p class="text-sm text-gray-400">No results. Try <button onclick="CalciumPage.openManualEntry()" class="text-indigo-600 underline">manual entry</button>.</p>';
        return;
      }
      resultsEl.innerHTML = foods.map(f => {
        const cal = f.foodNutrients?.find(n => n.nutrientId === 1087);
        const per100 = cal ? Math.round(cal.value) : null;
        return `
          <div class="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-slate-50 hover:border-indigo-200 transition-colors">
            <div class="flex-1 min-w-0 pr-3">
              <p class="text-sm font-medium text-gray-800 truncate">${f.description}</p>
              <p class="text-xs text-gray-400">${per100 !== null ? per100 + ' mg per 100g' : 'Calcium not listed'}</p>
            </div>
            ${per100 !== null ? `
              <button onclick="CalciumPage.openAddEntry('${f.description.replace(/'/g, "\\'")}', ${per100})"
                class="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors shrink-0">
                Add
              </button>` : '<span class="text-xs text-gray-400 shrink-0">No data</span>'}
          </div>`;
      }).join('');
    } catch {
      resultsEl.innerHTML = '<p class="text-sm text-red-400">Search failed. Check your connection, or <button onclick="CalciumPage.openManualEntry()" class="underline">add manually</button>.</p>';
    }
  },

  openAddEntry(foodName, calciumPer100g) {
    App.openModal('Add to Log', `
      <div class="space-y-4">
        <div>
          <p class="text-sm font-medium text-gray-700 mb-1">${foodName}</p>
          <p class="text-xs text-gray-400">${calciumPer100g} mg calcium per 100g</p>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">How many grams?</label>
          <input type="number" id="entry-grams" value="100" min="1" max="2000" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div class="bg-indigo-50 rounded-xl p-3">
          <p class="text-sm text-indigo-700" id="entry-calc-preview">= ${calciumPer100g} mg calcium</p>
        </div>
        <input type="hidden" id="entry-food" value="${foodName.replace(/"/g, '&quot;')}" />
        <input type="hidden" id="entry-per100" value="${calciumPer100g}" />
        <button onclick="CalciumPage.confirmAdd()" class="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors">Add to Log</button>
      </div>
    `);
    setTimeout(() => {
      const gramsInput = document.getElementById('entry-grams');
      if (gramsInput) {
        gramsInput.addEventListener('input', () => {
          const grams = parseFloat(gramsInput.value) || 0;
          const calcium = Math.round(calciumPer100g * grams / 100);
          document.getElementById('entry-calc-preview').textContent = `= ${calcium} mg calcium`;
        });
      }
    }, 50);
  },

  openManualEntry() {
    App.openModal('Add Manually', `
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Food name</label>
          <input type="text" id="manual-food" placeholder="e.g. Calcium citrate supplement" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Calcium amount (mg)</label>
          <input type="number" id="manual-calcium" placeholder="e.g. 500" min="1" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Amount / serving (optional)</label>
          <input type="text" id="manual-serving" placeholder="e.g. 200g, 1 tablet" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" id="manual-save" class="w-4 h-4 accent-indigo-600" />
          <span class="text-sm text-gray-700">Save to My Foods for quick access</span>
        </label>
        <button onclick="CalciumPage.confirmManual()" class="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors">Add to Log</button>
      </div>
    `);
  },

  confirmAdd() {
    const food = document.getElementById('entry-food').value;
    const per100 = parseFloat(document.getElementById('entry-per100').value);
    const grams = parseFloat(document.getElementById('entry-grams').value) || 100;
    const calcium_mg = per100 * grams / 100;
    const date = document.getElementById('cal-date').value || todayStr();
    DB.add('calcium', { food, grams, calcium_mg, date });
    App.forceCloseModal();
    this.refreshLog();
    this.renderChart();
    showToast(`Added ${Math.round(calcium_mg)} mg calcium`);
    if (App.current === 'dashboard') DashboardPage.render();
  },

  confirmManual() {
    const food = document.getElementById('manual-food').value.trim();
    const calcium_mg = parseFloat(document.getElementById('manual-calcium').value);
    const serving = document.getElementById('manual-serving').value.trim();
    const saveToMyFoods = document.getElementById('manual-save')?.checked;
    if (!food || !calcium_mg) { showToast('Please fill in food name and calcium amount.'); return; }
    const date = document.getElementById('cal-date').value || todayStr();
    DB.add('calcium', { food, calcium_mg, grams: serving || null, date });
    if (saveToMyFoods) DB.add('custom_foods', { name: food, calcium_mg, serving: serving || null });
    App.forceCloseModal();
    this.refreshLog();
    this.renderMyFoods();
    this.renderChart();
    showToast(`Added ${Math.round(calcium_mg)} mg calcium${saveToMyFoods ? ' · Saved to My Foods' : ''}`);
  },

  deleteEntry(id) {
    DB.remove('calcium', id);
    this.refreshLog();
    this.renderChart();
  },

  renderMyFoods() {
    const foods = DB.get('custom_foods');
    const el = document.getElementById('cal-my-foods');
    if (!el) return;
    if (!foods.length) {
      el.innerHTML = '<p class="text-sm text-gray-400">No saved foods yet. Create one to quick-add it anytime.</p>';
      return;
    }
    el.innerHTML = foods.map(f => `
      <div class="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-slate-50">
        <div class="flex-1 min-w-0 pr-3">
          <p class="text-sm font-medium text-gray-800 truncate">${f.name}</p>
          <p class="text-xs text-gray-400">${Math.round(f.calcium_mg)} mg${f.serving ? ' · ' + f.serving : ''}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="CalciumPage.quickAddCustomFood(${f.id})" class="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">Add</button>
          <button onclick="CalciumPage.deleteCustomFood(${f.id})" class="text-xs text-gray-300 hover:text-red-400 transition-colors">✕</button>
        </div>
      </div>
    `).join('');
  },

  openSaveFoodForm() {
    App.openModal('Create Custom Food', `
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Food name</label>
          <input type="text" id="cf-name" placeholder="e.g. Calcium citrate supplement" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Calcium per serving (mg)</label>
          <input type="number" id="cf-calcium" placeholder="e.g. 500" min="1" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Serving size (optional)</label>
          <input type="text" id="cf-serving" placeholder="e.g. 200g, 1 tablet, 1 cup" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <button onclick="CalciumPage.saveCustomFood()" class="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors">Save Food</button>
      </div>
    `);
  },

  saveCustomFood() {
    const name = document.getElementById('cf-name').value.trim();
    const calcium_mg = parseFloat(document.getElementById('cf-calcium').value);
    const serving = document.getElementById('cf-serving').value.trim();
    if (!name || !calcium_mg) { showToast('Please fill in food name and calcium amount.'); return; }
    DB.add('custom_foods', { name, calcium_mg, serving: serving || null });
    App.forceCloseModal();
    this.renderMyFoods();
    showToast('Food saved ✓');
  },

  quickAddCustomFood(id) {
    const food = DB.get('custom_foods').find(f => f.id === id);
    if (!food) return;
    const date = document.getElementById('cal-date').value || todayStr();
    DB.add('calcium', { food: food.name, calcium_mg: food.calcium_mg, grams: food.serving || null, date });
    this.refreshLog();
    this.renderChart();
    showToast(`Added ${Math.round(food.calcium_mg)} mg calcium`);
  },

  deleteCustomFood(id) {
    if (!confirm('Remove this food from My Foods?')) return;
    DB.remove('custom_foods', id);
    this.renderMyFoods();
  },

  renderChart() {
    const ctx = document.getElementById('cal-chart');
    if (!ctx) return;
    if (calChart) { calChart.destroy(); calChart = null; }

    const days = 30;
    const labels = [], data = [];
    const all = DB.get('calcium');
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      labels.push(fmtDateShort(dateStr));
      const total = all.filter(e => e.date === dateStr).reduce((s, e) => s + (e.calcium_mg || 0), 0);
      data.push(Math.round(total));
    }

    calChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Calcium (mg)',
          data,
          backgroundColor: data.map(v => v >= CALCIUM_GOAL ? '#6366f1' : '#a5b4fc'),
          borderRadius: 6,
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          annotation: {},
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 11 } }
          },
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 10 } }
        },
        responsive: true,
        maintainAspectRatio: true,
      }
    });

    // Goal line via plugin
    const goalPlugin = {
      id: 'goalLine',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right }, scales: { y } } = chart;
        const yPos = y.getPixelForValue(CALCIUM_GOAL);
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 3]);
        ctx.moveTo(left, yPos);
        ctx.lineTo(right, yPos);
        ctx.stroke();
        ctx.fillStyle = '#f43f5e';
        ctx.font = '10px sans-serif';
        ctx.fillText('1500mg goal', right - 68, yPos - 4);
        ctx.restore();
      }
    };
    calChart.options.plugins.goalLine = {};
    Chart.register(goalPlugin);
    calChart.update();
  }
};

// ── Symptom Log ───────────────────────────────────────────────────────────────

let symChart = null;

const SymptomsPage = {
  render() {
    const dateInput = document.getElementById('sym-date');
    if (!dateInput.value) dateInput.value = todayStr();
    this.renderHistory();
    this.renderChart();
  },

  save() {
    const date = document.getElementById('sym-date').value || todayStr();
    const pain = parseInt(document.getElementById('sym-pain').value);
    const mobility = parseInt(document.getElementById('sym-mobility').value);
    const energy = parseInt(document.getElementById('sym-energy').value);
    const mood = parseInt(document.getElementById('sym-mood').value);
    const weightBearing = document.getElementById('sym-weight-bearing').value;
    const notes = document.getElementById('sym-notes').value.trim();

    DB.add('symptoms', { date, pain, mobility, energy, mood, weightBearing, notes });
    showToast('Symptom log saved ✓');

    // Reset
    document.getElementById('sym-date').value = todayStr();
    ['sym-pain','sym-mobility','sym-energy','sym-mood'].forEach(id => {
      document.getElementById(id).value = 5;
    });
    document.getElementById('sym-pain-val').textContent = '5';
    document.getElementById('sym-mobility-val').textContent = '5';
    document.getElementById('sym-energy-val').textContent = '5';
    document.getElementById('sym-mood-val').textContent = '5';
    document.getElementById('sym-notes').value = '';
    document.getElementById('sym-weight-bearing').value = 'none';

    this.renderHistory();
    this.renderChart();
  },

  renderHistory() {
    const all = DB.get('symptoms').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
    const el = document.getElementById('sym-history');
    if (!all.length) {
      el.innerHTML = '<p class="text-sm text-gray-400">No entries yet.</p>';
      return;
    }
    const wbLabels = { none: 'No weight bearing', partial: 'Partial weight bearing', full: 'Full weight bearing', crutches: 'With support' };
    el.innerHTML = all.map(s => `
      <div class="border border-gray-100 rounded-xl p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold text-gray-700">${fmtDate(s.date)}</span>
          <button onclick="SymptomsPage.deleteEntry(${s.id})" class="text-gray-300 hover:text-red-400 text-sm">✕</button>
        </div>
        <div class="grid grid-cols-4 gap-2 mb-2">
          <div class="text-center">
            <p class="text-xs text-gray-400">Pain</p>
            <p class="text-sm font-bold ${s.pain <= 3 ? 'text-emerald-600' : s.pain <= 6 ? 'text-amber-600' : 'text-red-600'}">${s.pain}/10</p>
          </div>
          <div class="text-center">
            <p class="text-xs text-gray-400">Mobility</p>
            <p class="text-sm font-bold text-indigo-600">${s.mobility}/10</p>
          </div>
          <div class="text-center">
            <p class="text-xs text-gray-400">Energy</p>
            <p class="text-sm font-bold text-amber-600">${s.energy}/10</p>
          </div>
          <div class="text-center">
            <p class="text-xs text-gray-400">Mood</p>
            <p class="text-sm font-bold text-purple-600">${s.mood}/10</p>
          </div>
        </div>
        ${s.weightBearing ? `<p class="text-xs text-gray-500 mb-1">⚖️ ${wbLabels[s.weightBearing] || s.weightBearing}</p>` : ''}
        ${s.notes ? `<p class="text-xs text-gray-500 italic">"${s.notes}"</p>` : ''}
      </div>
    `).join('');
  },

  deleteEntry(id) {
    DB.remove('symptoms', id);
    this.renderHistory();
    this.renderChart();
  },

  renderChart() {
    const ctx = document.getElementById('sym-chart');
    if (!ctx) return;
    if (symChart) { symChart.destroy(); symChart = null; }

    const days = 30;
    const all = DB.get('symptoms');
    const labels = [], painData = [], mobilityData = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      labels.push(fmtDateShort(dateStr));
      const entries = all.filter(s => s.date === dateStr);
      if (entries.length) {
        const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
        painData.push(avg(entries.map(e => e.pain)));
        mobilityData.push(avg(entries.map(e => e.mobility)));
      } else {
        painData.push(null);
        mobilityData.push(null);
      }
    }

    symChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Pain',
            data: painData,
            borderColor: '#f43f5e',
            backgroundColor: 'transparent',
            tension: 0.4,
            spanGaps: true,
            pointRadius: 4,
            pointBackgroundColor: '#f43f5e',
          },
          {
            label: 'Mobility',
            data: mobilityData,
            borderColor: '#6366f1',
            backgroundColor: 'transparent',
            tension: 0.4,
            spanGaps: true,
            pointRadius: 4,
            pointBackgroundColor: '#6366f1',
          }
        ]
      },
      options: {
        scales: {
          y: {
            min: 0, max: 10,
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 11 } }
          },
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 10 } }
        },
        plugins: { legend: { labels: { font: { size: 11 } } } },
        responsive: true,
        maintainAspectRatio: true,
      }
    });
  }
};

// ── Medical Records ───────────────────────────────────────────────────────────

const TYPE_COLORS = {
  appointment: 'bg-blue-100 text-blue-700',
  test: 'bg-purple-100 text-purple-700',
  result: 'bg-emerald-100 text-emerald-700',
  diagnosis: 'bg-amber-100 text-amber-700',
};
const TYPE_LABELS = {
  appointment: 'Appointment', test: 'Test', result: 'Result / Finding', diagnosis: 'Note'
};

let medFilter = 'all';

const MedicalPage = {
  render() { this.renderList(); },

  filter(type) {
    medFilter = type;
    document.querySelectorAll('.filter-btn').forEach(b => {
      const active = b.dataset.filter === type;
      b.className = `filter-btn px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`;
    });
    this.renderList();
  },

  renderList() {
    let records = DB.get('medical').sort((a, b) => b.date.localeCompare(a.date));
    if (medFilter !== 'all') records = records.filter(r => r.type === medFilter);
    const el = document.getElementById('med-list');
    if (!records.length) {
      el.innerHTML = '<div class="text-center py-10 text-gray-400 text-sm">No records yet. Add your first one!</div>';
      return;
    }
    el.innerHTML = records.map(r => {
      const attachCount = (r.attachments || []).length;
      return `
      <div class="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 fade-in">
        <div class="flex items-start justify-between mb-2">
          <div>
            <span class="inline-block text-xs font-medium px-2.5 py-1 rounded-full ${TYPE_COLORS[r.type] || 'bg-gray-100 text-gray-600'} mb-2">
              ${TYPE_LABELS[r.type] || r.type}
            </span>
            <h4 class="font-semibold text-gray-800">${r.title || r.doctor || 'Record'}</h4>
            ${r.doctor && r.title ? `<p class="text-sm text-gray-500">Dr. ${r.doctor}</p>` : ''}
            ${r.specialty ? `<p class="text-xs text-gray-400">${r.specialty}</p>` : ''}
          </div>
          <div class="text-right shrink-0 ml-3">
            <p class="text-sm text-gray-500">${fmtDate(r.date)}</p>
            <div class="flex flex-col gap-1 mt-1 items-end">
              ${attachCount ? `<span class="text-xs text-sky-600 cursor-pointer hover:underline" onclick="MedicalPage.openAttachments(${r.id})">📎 ${attachCount} file${attachCount > 1 ? 's' : ''}</span>` : ''}
              <label class="text-xs bg-sky-50 text-sky-600 px-2 py-1 rounded-lg hover:bg-sky-100 cursor-pointer">
                📎 Attach
                <input type="file" accept="image/*,application/pdf,.doc,.docx" multiple class="hidden"
                       onchange="MedicalPage.handleAttachments(this, ${r.id})" />
              </label>
              <button onclick="MedicalPage.delete(${r.id})" class="text-xs text-gray-300 hover:text-red-400">Delete</button>
            </div>
          </div>
        </div>
        ${r.notes ? `<p class="text-sm text-gray-600 mt-2 leading-relaxed bg-gray-50 rounded-xl p-3">${r.notes}</p>` : ''}
        ${r.values ? `<p class="text-sm text-indigo-700 mt-2 font-medium">📊 ${r.values}</p>` : ''}
      </div>`;
    }).join('');
  },

  openForm(record) {
    const r = record || {};
    App.openModal(record ? 'Edit Record' : 'Add Medical Record', `
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Type</label>
          <select id="med-type" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="appointment" ${r.type==='appointment'?'selected':''}>Appointment</option>
            <option value="test" ${r.type==='test'?'selected':''}>Test / Scan / Blood work</option>
            <option value="result" ${r.type==='result'?'selected':''}>Result / Finding</option>
            <option value="diagnosis" ${r.type==='diagnosis'?'selected':''}>Note</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Title / Description</label>
          <input type="text" id="med-title" value="${r.title||''}" placeholder="e.g. Bone density DEXA scan" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Date</label>
            <input type="date" id="med-date" value="${r.date||todayStr()}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Doctor</label>
            <input type="text" id="med-doctor" value="${r.doctor||''}" placeholder="Dr. Name" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Specialty</label>
          <input type="text" id="med-specialty" value="${r.specialty||''}" placeholder="e.g. Orthopedics, Sports Medicine, Endocrinology" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Test Values / Scores</label>
          <input type="text" id="med-values" value="${r.values||''}" placeholder="e.g. T-score: -2.8, Vitamin D: 18 ng/mL" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Notes</label>
          <textarea id="med-notes" rows="4" placeholder="Doctor's findings, recommendations, what was discussed..." class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none">${r.notes||''}</textarea>
        </div>
        <button onclick="MedicalPage.save(${r.id||'null'})" class="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors">Save Record</button>
      </div>
    `);
  },

  save(editId) {
    const entry = {
      type: document.getElementById('med-type').value,
      title: document.getElementById('med-title').value.trim(),
      date: document.getElementById('med-date').value,
      doctor: document.getElementById('med-doctor').value.trim(),
      specialty: document.getElementById('med-specialty').value.trim(),
      values: document.getElementById('med-values').value.trim(),
      notes: document.getElementById('med-notes').value.trim(),
    };
    if (!entry.date) { showToast('Please select a date.'); return; }
    if (editId) {
      DB.update('medical', editId, entry);
    } else {
      DB.add('medical', entry);
    }
    App.forceCloseModal();
    this.renderList();
    showToast('Record saved ✓');
  },

  handleAttachments(input, recordId) {
    const files = Array.from(input.files);
    if (!files.length) return;
    let saved = 0;
    files.forEach(file => {
      FileDB.save(file).then(fileId => {
        const record = DB.get('medical').find(r => r.id === recordId);
        const attachments = [...(record?.attachments || []), fileId];
        DB.update('medical', recordId, { attachments });
        saved++;
        if (saved === files.length) {
          showToast(`${saved} file${saved > 1 ? 's' : ''} attached ✓`);
          this.renderList();
        }
      }).catch(() => showToast('Failed to save file.'));
    });
    input.value = '';
  },

  openAttachments(recordId) {
    const record = DB.get('medical').find(r => r.id === recordId);
    if (!record) return;
    const fileIds = record.attachments || [];
    if (!fileIds.length) { showToast('No attachments yet.'); return; }

    App.openModal(`Files — ${record.title || 'Record'}`, `
      <div id="med-attachments-grid" class="space-y-2">
        <p class="text-xs text-gray-400">Loading files…</p>
      </div>`);

    const grid = document.getElementById('med-attachments-grid');
    grid.innerHTML = '';
    fileIds.forEach(fileId => {
      FileDB.get(fileId).then(file => {
        if (!file || !grid) return;
        const isImage = file.type.startsWith('image/');
        grid.insertAdjacentHTML('beforeend', `
          <div class="flex items-center gap-3 p-3 border border-gray-100 rounded-xl group">
            ${isImage
              ? `<img src="${file.dataUrl}" class="w-14 h-14 object-cover rounded-lg flex-shrink-0 cursor-pointer"
                       onclick="CalendarWidget.viewFile('${fileId}')" />`
              : `<div class="w-14 h-14 flex items-center justify-center bg-gray-100 rounded-lg flex-shrink-0 cursor-pointer text-2xl"
                       onclick="CalendarWidget.viewFile('${fileId}')">📄</div>`}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 truncate">${file.name}</p>
              <p class="text-xs text-gray-400">${(file.size / 1024).toFixed(0)} KB</p>
            </div>
            <button onclick="MedicalPage.deleteAttachment(${recordId}, '${fileId}')"
                    class="text-xs text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
          </div>`);
      });
    });
  },

  deleteAttachment(recordId, fileId) {
    const record = DB.get('medical').find(r => r.id === recordId);
    if (!record) return;
    DB.update('medical', recordId, { attachments: (record.attachments || []).filter(id => id !== fileId) });
    FileDB.delete(fileId);
    this.openAttachments(recordId);
    this.renderList();
  },

  delete(id) {
    if (!confirm('Delete this record?')) return;
    DB.remove('medical', id);
    this.renderList();
  }
};

// ── Medications ───────────────────────────────────────────────────────────────

const MedsPage = {
  render() {
    this.renderChecklist();
    this.renderList();
  },

  renderChecklist() {
    const meds = DB.get('medications');
    const today = todayStr();
    const el = document.getElementById('meds-checklist');
    if (!meds.length) {
      el.innerHTML = '<p class="text-sm text-gray-400">No medications added yet.</p>';
      return;
    }
    el.innerHTML = meds.map(m => {
      const taken = (m.takenDates || []).includes(today);
      return `
        <div class="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
          <button onclick="MedsPage.toggleTaken(${m.id})" class="w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${taken ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300 hover:border-emerald-400'}">
            ${taken ? '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
          </button>
          <div class="flex-1">
            <p class="text-sm font-medium ${taken ? 'text-gray-400 line-through' : 'text-gray-800'}">${m.name}</p>
            <p class="text-xs text-gray-400">${m.dose || ''} ${m.frequency ? '· ' + m.frequency : ''}</p>
          </div>
        </div>
      `;
    }).join('');
  },

  toggleTaken(id) {
    const today = todayStr();
    const meds = DB.get('medications');
    const med = meds.find(m => m.id === id);
    if (!med) return;
    const dates = med.takenDates || [];
    const idx = dates.indexOf(today);
    if (idx === -1) dates.push(today);
    else dates.splice(idx, 1);
    DB.update('medications', id, { takenDates: dates });
    this.renderChecklist();
    if (App.current === 'dashboard') DashboardPage.render();
  },

  renderList() {
    const meds = DB.get('medications');
    const el = document.getElementById('meds-list');
    if (!meds.length) {
      el.innerHTML = '<p class="text-sm text-gray-400">No medications added yet.</p>';
      return;
    }
    el.innerHTML = meds.map(m => `
      <div class="flex items-start justify-between py-3 border-b border-gray-50 last:border-0">
        <div>
          <p class="text-sm font-medium text-gray-800">💊 ${m.name}</p>
          ${m.dose ? `<p class="text-xs text-gray-500">${m.dose}</p>` : ''}
          ${m.frequency ? `<p class="text-xs text-gray-400">${m.frequency}</p>` : ''}
          ${m.notes ? `<p class="text-xs text-gray-400 italic mt-1">${m.notes}</p>` : ''}
          ${m.startDate ? `<p class="text-xs text-gray-400">Started: ${fmtDate(m.startDate)}</p>` : ''}
        </div>
        <button onclick="MedsPage.delete(${m.id})" class="text-gray-300 hover:text-red-400 text-sm ml-3 shrink-0">✕</button>
      </div>
    `).join('');
  },

  openForm() {
    App.openModal('Add Medication / Supplement', `
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Name</label>
          <input type="text" id="med-name" placeholder="e.g. Calcium Citrate, Vitamin D3, Iron" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Dose</label>
            <input type="text" id="med-dose" placeholder="e.g. 500mg" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Frequency</label>
            <select id="med-freq" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
              <option value="Once daily">Once daily</option>
              <option value="Twice daily">Twice daily</option>
              <option value="Three times daily">Three times daily</option>
              <option value="With meals">With meals</option>
              <option value="As needed">As needed</option>
              <option value="Weekly">Weekly</option>
            </select>
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Start Date</label>
          <input type="date" id="med-start" value="${todayStr()}" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Notes</label>
          <textarea id="med-notes-input" rows="2" placeholder="e.g. Take with food, prescribed by Dr. X" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"></textarea>
        </div>
        <button onclick="MedsPage.save()" class="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors">Add Medication</button>
      </div>
    `);
  },

  save() {
    const name = document.getElementById('med-name').value.trim();
    if (!name) { showToast('Please enter a medication name.'); return; }
    DB.add('medications', {
      name,
      dose: document.getElementById('med-dose').value.trim(),
      frequency: document.getElementById('med-freq').value,
      startDate: document.getElementById('med-start').value,
      notes: document.getElementById('med-notes-input').value.trim(),
      takenDates: [],
    });
    App.forceCloseModal();
    this.render();
    showToast('Medication added ✓');
  },

  delete(id) {
    if (!confirm('Remove this medication?')) return;
    DB.remove('medications', id);
    this.render();
  }
};

// ── Appointments ──────────────────────────────────────────────────────────────

const APPT_TYPES = ['Orthopedics', 'Sports Medicine', 'Endocrinology', 'Nutritionist', 'Physiotherapy', 'Rheumatology', 'General Practitioner', 'Other'];

const ApptsPage = {
  render() {
    this.checkNotifBanner();
    this.renderLists();
  },

  checkNotifBanner() {
    const banner = document.getElementById('notif-banner');
    if ('Notification' in window && Notification.permission === 'default') {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  },

  enableNotifications() {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        showToast('Reminders enabled ✓');
        this.scheduleNotifications();
      }
      document.getElementById('notif-banner').classList.add('hidden');
    });
  },

  scheduleNotifications() {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tStr = tomorrow.toISOString().split('T')[0];
    const upcoming = DB.get('appointments').filter(a => a.date === tStr && !a.done);
    upcoming.forEach(a => {
      new Notification('Appointment tomorrow', {
        body: `${a.type || 'Appointment'} with ${a.doctor || 'your doctor'} — ${a.time || 'check your tracker'}`,
        icon: '💜',
      });
    });
  },

  renderLists() {
    const today = todayStr();
    const all = DB.get('appointments').sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = all.filter(a => a.date >= today && !a.done);
    const past = all.filter(a => a.date < today || a.done).reverse().slice(0, 15);

    const upEl = document.getElementById('appts-upcoming');
    const pastEl = document.getElementById('appts-past');

    upEl.innerHTML = upcoming.length
      ? upcoming.map(a => this.apptCard(a, false)).join('')
      : '<p class="text-sm text-gray-400 py-2">No upcoming appointments.</p>';

    pastEl.innerHTML = past.length
      ? past.map(a => this.apptCard(a, true)).join('')
      : '<p class="text-sm text-gray-400 py-2">No past appointments.</p>';
  },

  apptCard(a, isPast) {
    const days = daysFromNow(a.date);
    const badge = isPast || a.done
      ? '<span class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Done</span>'
      : days === 0
        ? '<span class="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">TODAY</span>'
        : days === 1
          ? '<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Tomorrow</span>'
          : `<span class="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">In ${days} days</span>`;

    const attachCount = (a.attachments || []).length;

    return `
      <div class="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 fade-in">
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              ${badge}
              <span class="text-xs text-gray-400">${fmtDate(a.date)}${a.time ? ' · ' + a.time : ''}</span>
              ${attachCount ? `<span class="text-xs text-sky-600 cursor-pointer hover:underline" onclick="ApptsPage.openAttachments(${a.id})">📎 ${attachCount} file${attachCount > 1 ? 's' : ''}</span>` : ''}
            </div>
            <h4 class="font-semibold text-gray-800">${a.type || 'Appointment'}</h4>
            ${a.doctor ? `<p class="text-sm text-gray-500">Dr. ${a.doctor}</p>` : ''}
            ${a.location ? `<p class="text-xs text-gray-400">📍 ${a.location}</p>` : ''}
            ${a.notes ? `<p class="text-xs text-gray-500 mt-2 italic">${a.notes}</p>` : ''}
          </div>
          <div class="flex flex-col gap-1 ml-3 shrink-0">
            ${!isPast && !a.done ? `<button onclick="ApptsPage.markDone(${a.id})" class="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-100">✓ Done</button>` : ''}
            <label class="text-xs bg-sky-50 text-sky-600 px-2 py-1 rounded-lg hover:bg-sky-100 cursor-pointer text-center">
              📎 Attach
              <input type="file" accept="image/*,application/pdf,.doc,.docx" multiple class="hidden"
                     onchange="ApptsPage.handleAttachments(this, ${a.id})" />
            </label>
            <button onclick="ApptsPage.delete(${a.id})" class="text-xs text-gray-300 hover:text-red-400 text-center">Delete</button>
          </div>
        </div>
      </div>`;
  },

  markDone(id) {
    DB.update('appointments', id, { done: true });
    this.renderLists();
  },

  openForm() {
    App.openModal('Add Appointment', `
      <div class="space-y-4">
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Type / Specialty</label>
          <select id="appt-type" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            ${APPT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Date</label>
            <input type="date" id="appt-date" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-1">Time</label>
            <input type="time" id="appt-time" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Doctor</label>
          <input type="text" id="appt-doctor" placeholder="Dr. Name" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Location / Clinic</label>
          <input type="text" id="appt-location" placeholder="Hospital or clinic name" class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>
        <div>
          <label class="text-sm font-medium text-gray-700 block mb-1">Notes</label>
          <textarea id="appt-notes" rows="3" placeholder="Questions to ask, things to bring, purpose of visit..." class="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"></textarea>
        </div>
        <button onclick="ApptsPage.save()" class="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium hover:bg-indigo-700 transition-colors">Save Appointment</button>
      </div>
    `);
  },

  save() {
    const date = document.getElementById('appt-date').value;
    if (!date) { showToast('Please select a date.'); return; }
    DB.add('appointments', {
      type: document.getElementById('appt-type').value,
      date,
      time: document.getElementById('appt-time').value,
      doctor: document.getElementById('appt-doctor').value.trim(),
      location: document.getElementById('appt-location').value.trim(),
      notes: document.getElementById('appt-notes').value.trim(),
      done: false,
    });
    App.forceCloseModal();
    this.renderLists();
    showToast('Appointment saved ✓');
  },

  delete(id) {
    if (!confirm('Delete this appointment?')) return;
    DB.remove('appointments', id);
    this.renderLists();
  },

  handleAttachments(input, apptId) {
    const files = Array.from(input.files);
    if (!files.length) return;
    let saved = 0;
    files.forEach(file => {
      FileDB.save(file).then(fileId => {
        const appt = DB.get('appointments').find(a => a.id === apptId);
        const attachments = [...(appt?.attachments || []), fileId];
        DB.update('appointments', apptId, { attachments });
        saved++;
        if (saved === files.length) {
          showToast(`${saved} file${saved > 1 ? 's' : ''} attached ✓`);
          this.renderLists();
        }
      }).catch(() => showToast('Failed to save file.'));
    });
    input.value = '';
  },

  openAttachments(apptId) {
    const appt = DB.get('appointments').find(a => a.id === apptId);
    if (!appt) return;
    const fileIds = appt.attachments || [];
    if (!fileIds.length) { showToast('No attachments yet.'); return; }

    const title = `Files — ${appt.type || 'Appointment'} (${fmtDateShort(appt.date)})`;
    App.openModal(title, `
      <div id="appt-attachments-grid" class="space-y-2">
        <p class="text-xs text-gray-400">Loading files…</p>
      </div>`);

    const grid = document.getElementById('appt-attachments-grid');
    grid.innerHTML = '';
    fileIds.forEach(fileId => {
      FileDB.get(fileId).then(file => {
        if (!file || !grid) return;
        const isImage = file.type.startsWith('image/');
        grid.insertAdjacentHTML('beforeend', `
          <div class="flex items-center gap-3 p-3 border border-gray-100 rounded-xl group">
            ${isImage
              ? `<img src="${file.dataUrl}" class="w-14 h-14 object-cover rounded-lg flex-shrink-0 cursor-pointer"
                       onclick="CalendarWidget.viewFile('${fileId}')" />`
              : `<div class="w-14 h-14 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 text-2xl cursor-pointer"
                       onclick="CalendarWidget.viewFile('${fileId}')">📄</div>`}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-800 truncate">${file.name}</p>
              <p class="text-xs text-gray-400">${(file.size / 1024).toFixed(0)} KB</p>
              <button onclick="ApptsPage.deleteAttachment(${apptId}, '${fileId}')"
                      class="text-xs text-red-400 hover:text-red-600 mt-0.5">Remove</button>
            </div>
            <button onclick="CalendarWidget.viewFile('${fileId}')"
                    class="text-xs bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 shrink-0">
              Open
            </button>
          </div>`);
      });
    });
  },

  deleteAttachment(apptId, fileId) {
    if (!confirm('Remove this file?')) return;
    const appt = DB.get('appointments').find(a => a.id === apptId);
    if (!appt) return;
    DB.update('appointments', apptId, { attachments: (appt.attachments || []).filter(id => id !== fileId) });
    FileDB.delete(fileId);
    this.openAttachments(apptId); // refresh the modal
    this.renderLists();
  }
};

// ── Articles ──────────────────────────────────────────────────────────────────

const CURATED = [
  {
    title: 'RED-S: Relative Energy Deficiency in Sport — IOC Consensus',
    desc: 'The International Olympic Committee\'s official consensus statement on RED-S, its causes, health consequences and treatment.',
    url: 'https://bjsm.bmj.com/content/48/7/491',
    tag: 'Clinical Guide'
  },
  {
    title: 'Bone Stress Injuries in Athletes — A Practical Guide',
    desc: 'Covers diagnosis, imaging, grading and return-to-sport protocols for stress fractures including the hip.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6107801/',
    tag: 'Stress Fractures'
  },
  {
    title: 'Low Bone Mineral Density in Female Athletes — Causes & Management',
    desc: 'Detailed review of low BMD in active women, hormonal factors, and evidence-based interventions.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7585763/',
    tag: 'Bone Density'
  },
  {
    title: 'Calcium and Vitamin D: What You Need to Know',
    desc: 'NIH Office of Dietary Supplements fact sheet on calcium — sources, recommended intakes, and bone health.',
    url: 'https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/',
    tag: 'Nutrition'
  },
  {
    title: 'The Female Athlete Triad — A Clinical Review',
    desc: 'Overview of the triad of low energy availability, menstrual dysfunction, and low bone density in female athletes.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4021299/',
    tag: 'Female Athlete'
  },
  {
    title: 'Return to Sport After Stress Fracture — Rehabilitation Protocol',
    desc: 'Evidence-based progressive loading protocols for returning to activity after bone stress injuries.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6107801/',
    tag: 'Recovery'
  },
  {
    title: 'Calcium-Rich Foods — USDA Nutritional Database',
    desc: 'Search any food for its full nutritional profile including calcium content per serving.',
    url: 'https://fdc.nal.usda.gov/',
    tag: 'Nutrition Tool'
  },
];

const TAG_COLORS = {
  'Clinical Guide': 'bg-blue-100 text-blue-700',
  'Stress Fractures': 'bg-red-100 text-red-700',
  'Bone Density': 'bg-purple-100 text-purple-700',
  'Nutrition': 'bg-emerald-100 text-emerald-700',
  'Female Athlete': 'bg-pink-100 text-pink-700',
  'Recovery': 'bg-indigo-100 text-indigo-700',
  'Nutrition Tool': 'bg-amber-100 text-amber-700',
};

const ArticlesPage = {
  render() {
    this.renderCurated();
    this.renderSaved();
  },

  renderCurated() {
    document.getElementById('art-curated').innerHTML = CURATED.map(a => `
      <div class="py-3 border-b border-gray-50 last:border-0">
        <div class="flex items-start gap-3">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs px-2 py-0.5 rounded-full ${TAG_COLORS[a.tag] || 'bg-gray-100 text-gray-600'}">${a.tag}</span>
            </div>
            <a href="${a.url}" target="_blank" rel="noopener" class="text-sm font-semibold text-indigo-700 hover:underline">${a.title}</a>
            <p class="text-xs text-gray-500 mt-1 leading-relaxed">${a.desc}</p>
          </div>
        </div>
      </div>
    `).join('');
  },

  renderSaved() {
    const saved = DB.get('articles');
    const el = document.getElementById('art-saved');
    if (!saved.length) {
      el.innerHTML = '<p class="text-sm text-gray-400">No saved articles yet.</p>';
      return;
    }
    el.innerHTML = saved.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(a => `
      <div class="py-3 border-b border-gray-50 last:border-0">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <a href="${a.url}" target="_blank" rel="noopener" class="text-sm font-semibold text-indigo-700 hover:underline truncate block">${a.title || a.url}</a>
            ${a.notes ? `<p class="text-xs text-gray-500 mt-1 italic">${a.notes}</p>` : ''}
            <p class="text-xs text-gray-400 mt-1">${fmtDate(a.savedDate)}</p>
          </div>
          <button onclick="ArticlesPage.delete(${a.id})" class="text-gray-300 hover:text-red-400 text-sm shrink-0">✕</button>
        </div>
      </div>
    `).join('');
  },

  searchWeb() {
    const query = document.getElementById('art-search-input').value.trim();
    const base = 'bone health stress fracture recovery';
    const q = encodeURIComponent(query ? `${query} ${base}` : base);
    window.open(`https://scholar.google.com/scholar?q=${q}`, '_blank', 'noopener');
  },

  saveArticle() {
    const url = document.getElementById('art-url').value.trim();
    const title = document.getElementById('art-title').value.trim();
    const notes = document.getElementById('art-notes').value.trim();
    if (!url) { showToast('Please paste a URL.'); return; }
    DB.add('articles', { url, title: title || url, notes, savedDate: todayStr() });
    document.getElementById('art-url').value = '';
    document.getElementById('art-title').value = '';
    document.getElementById('art-notes').value = '';
    this.renderSaved();
    showToast('Article saved ✓');
  },

  delete(id) {
    DB.remove('articles', id);
    this.renderSaved();
  }
};

// ── Date-change listeners ─────────────────────────────────────────────────────

document.addEventListener('change', e => {
  if (e.target.id === 'cal-date') CalciumPage.refreshLog();
});

// ── Enter key support ─────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.activeElement.id === 'cal-search') CalciumPage.searchFood();
    if (document.activeElement.id === 'art-search-input') ArticlesPage.searchWeb();
    if (e.key === 'Escape') App.forceCloseModal();
  }
});

// ── Wire nav buttons ──────────────────────────────────────────────────────────

document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
  btn.addEventListener('click', () => App.navigate(btn.dataset.page));
});

// ── Init ──────────────────────────────────────────────────────────────────────

CloudSync.init();
