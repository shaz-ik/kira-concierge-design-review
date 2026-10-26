/* Kira Concierge — Admin dashboard (working prototype).
   One page, hash-routed: #setup #menu #knowledge-base #staff #rooms #requests #analytics.
   Live hotel data (menu, requests, rooms, SLA targets) is read from and written to Kira.store,
   so every other open app updates instantly. Admin-only data (departments, knowledge base,
   staff roster, tablet registry, wizard step) lives under state.admin and is filled in lazily
   from the hi-fi mockup's content the first time it's needed. */
(function () {
  'use strict';

  var K = window.Kira;
  var store = K.store;
  var esc = K.fmt.esc;
  var toast = K.ui.toast;
  var MIN = 60000;
  var DAY = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* =====================================================================
     Reference data (from the hi-fi mockup)
     ===================================================================== */

  var ROUTING = ['KDS + mobile', 'KDS screen + printer', 'Mobile app', 'Desktop', 'Tablet', 'Printer'];
  var DEPT_ROUTING = {
    'Dining': 'KDS + mobile', 'Housekeeping': 'Mobile app', 'Front desk': 'Desktop', 'Valet': 'Mobile app',
    'Concierge': 'Desktop', 'Spa': 'Desktop', 'Butler service': 'Mobile app', 'Maintenance': 'Mobile app',
    'Kids club': 'Tablet', 'Laundry': 'Mobile app', 'Bell desk': 'Mobile app', 'Pool & beach': 'Mobile app', 'Security': 'Mobile app'
  };
  // A leading "-" means the department ships disabled in that template.
  var TEMPLATE = {
    5: ['Dining', 'Housekeeping', 'Concierge', 'Valet', 'Front desk', 'Spa', '-Butler service', 'Maintenance', '-Kids club', 'Laundry', 'Bell desk', 'Pool & beach', 'Security'],
    4: ['Dining', 'Housekeeping', 'Concierge', 'Valet', 'Front desk', 'Spa', 'Maintenance', 'Laundry', 'Bell desk', '-Security'],
    3: ['Dining', 'Housekeeping', 'Front desk', 'Maintenance', 'Laundry', '-Valet']
  };
  var STARS = {
    3: { label: '3★ Midscale', blurb: 'Core services — dining, housekeeping, front desk, maintenance' },
    4: { label: '4★ Upscale', blurb: 'Adds concierge, valet, spa and bell desk' },
    5: { label: '5★ Luxury', blurb: 'Full service — butler, kids club, pool & beach, security' }
  };
  var LANGS = [
    { id: 'en', label: 'English' }, { id: 'ar', label: 'Arabic', native: 'العربية' }, { id: 'ru', label: 'Russian' },
    { id: 'zh', label: 'Chinese' }, { id: 'fr', label: 'French' }, { id: 'de', label: 'German' },
    { id: 'hi', label: 'Hindi' }, { id: 'ur', label: 'Urdu' }, { id: 'es', label: 'Spanish' },
    { id: 'it', label: 'Italian' }, { id: 'ja', label: 'Japanese' }
  ];
  var WIZARD = ['Hotel info', 'Star rating', 'Languages', 'Departments'];

  function template(stars) {
    return (TEMPLATE[stars] || TEMPLATE[5]).map(function (n) {
      var off = n.charAt(0) === '-';
      if (off) n = n.slice(1);
      return { name: n, on: !off, routing: DEPT_ROUTING[n] || 'Mobile app' };
    });
  }

  function dateTs(y, m, d) { return new Date(y, m, d, 10, 0).getTime(); }

  var KB_SEED = [
    { id: 'kb1', title: 'Pool hours', cat: 'Facilities', at: dateTs(2026, 9, 12),
      en: 'Open 6am–10pm daily. Rooftop pool, level 8. Towels are provided poolside.',
      ar: 'المسبح مفتوح يومياً من 6 صباحاً حتى 10 مساءً، على السطح في الطابق الثامن. تتوفر المناشف بجانب المسبح.',
      q: 'What time does the pool close?',
      ans: 'The rooftop pool on level 8 is open until 10pm tonight. Towels are waiting poolside.' },
    { id: 'kb2', title: 'Spa policies', cat: 'Facilities', at: dateTs(2026, 9, 3),
      en: 'The Marina Spa on level 2 is open 9am–9pm. Treatments are by appointment; please arrive 15 minutes early. Guests must be 16 or older.',
      ar: 'يقع مارينا سبا في الطابق الثاني ويفتح من 9 صباحاً حتى 9 مساءً. العلاجات بموعد مسبق، ويُرجى الحضور قبل الموعد بـ 15 دقيقة. يجب ألا يقل عمر الضيوف عن 16 عاماً.',
      q: 'Can I book a massage this afternoon?',
      ans: 'The Marina Spa on level 2 takes appointments until 9pm — shall I request a slot for you this afternoon? Please arrive 15 minutes early.' },
    { id: 'kb3', title: 'Gym & fitness', cat: 'Facilities', at: dateTs(2026, 8, 28),
      en: 'The fitness centre on level 3 is open 24 hours with your room key. Personal trainers are available 7am–7pm on request.',
      ar: 'مركز اللياقة البدنية في الطابق الثالث مفتوح على مدار 24 ساعة باستخدام مفتاح غرفتك. يتوفر مدربون شخصيون من 7 صباحاً حتى 7 مساءً عند الطلب.',
      q: 'Is the gym open now?',
      ans: 'Yes — the fitness centre on level 3 is open 24 hours. Just tap your room key at the door.' },
    { id: 'kb4', title: 'Wifi info', cat: 'Guest services', at: dateTs(2026, 9, 15),
      en: 'Join the network "GrandMarina-Guest" and sign in with your room number and last name. High-speed wifi is free for Kira Privé members.',
      ar: 'اتصل بشبكة "GrandMarina-Guest" وسجّل الدخول برقم غرفتك واسم العائلة. الإنترنت عالي السرعة مجاني لأعضاء كيرا بريفيه.',
      q: 'What’s the wifi password?',
      ans: 'Join “GrandMarina-Guest” and sign in with your room number and last name — no password needed.' },
    { id: 'kb5', title: 'Late checkout', cat: 'Guest services', at: dateTs(2026, 9, 9),
      en: 'Standard checkout is 11am. Late checkout until 2pm is free when the room is available; after 2pm a fee of AED 90 applies. Guests can request it from the in-room tablet.',
      ar: 'موعد المغادرة المعتاد هو 11 صباحاً. المغادرة المتأخرة حتى 2 ظهراً مجانية عند توفر الغرفة، وبعد 2 ظهراً تُطبَّق رسوم قدرها 90 درهماً. يمكن للضيوف طلبها من الجهاز اللوحي في الغرفة.',
      q: 'Can I check out late tomorrow?',
      ans: 'Of course — checkout until 2pm is free if the room is available; later than that is AED 90. Shall I send the request to the front desk?' },
    { id: 'kb6', title: 'Airport transfers', cat: 'Guest services', at: dateTs(2026, 9, 1),
      en: 'Private transfers to Dubai International (DXB) take about 30 minutes and cost AED 250 per car. Please book at least 4 hours ahead through the concierge.',
      ar: 'تستغرق رحلة النقل الخاصة إلى مطار دبي الدولي حوالي 30 دقيقة وتكلفتها 250 درهماً للسيارة. يُرجى الحجز قبل 4 ساعات على الأقل عبر الكونسيرج.',
      q: 'How do I get to the airport?',
      ans: 'A private car to DXB takes about 30 minutes and costs AED 250. Would you like me to ask the concierge to book one?' }
  ];

  // id, name, department, role, routing, status, on shift, last seen
  var STAFF_SEED = [
    ['s1', 'Ahmed R.', 'Dining', 'Kitchen', 'KDS screen + printer', 'active', true, ''],
    ['s2', 'Faisal K.', 'Dining', 'Waiter', 'Mobile app', 'active', true, ''],
    ['s3', 'Yusuf T.', 'Dining', 'Waiter', 'Mobile app', 'active', true, ''],
    ['s4', 'Noor A.', 'Housekeeping', 'Room attendant', 'Mobile app', 'active', true, ''],
    ['s5', 'Fatima S.', 'Front desk', 'Duty manager', 'Desktop', 'active', true, ''],
    ['s6', 'Omar H.', 'Valet', 'Attendant', 'Mobile app', 'active', true, ''],
    ['s7', 'Karim B.', 'Valet', 'Concierge & valet', 'Mobile app', 'active', true, ''],
    ['s8', 'Hana W.', 'Housekeeping', 'Room attendant', 'Mobile app', 'active', false, '2 h ago'],
    ['s9', 'Rami D.', 'Maintenance', 'Technician', 'Mobile app', 'active', false, 'Yesterday'],
    ['s10', 'Layla M.', 'Concierge', 'Concierge', 'Desktop', 'invited', false, ''],
    ['s11', 'Sara L.', 'Spa', 'Therapist', 'Desktop', 'invited', false, '']
  ];
  // Staff not listed in the roster sample (synced from HR) — keeps the mockup's 64 total.
  var HEAD_BASE = { 'Dining': 11, 'Housekeeping': 20, 'Front desk': 5, 'Valet': 3, 'Concierge': 3, 'Spa': 2, 'Maintenance': 3, 'Laundry': 2, 'Bell desk': 2, 'Pool & beach': 1, 'Security': 1 };

  // number, floor, type, status ('live' mirrors state.rooms[n].tablet), minutes (online: last-ping lag; offline: offline for)
  var ROOM_SEED = [
    ['115', 1, 'Garden Twin', 'live'],
    ['205', 2, 'Deluxe Twin', 'online', 2], ['206', 2, 'Deluxe King', 'online', 0], ['207', 2, 'Deluxe Twin', 'none'],
    ['208', 2, 'Deluxe King', 'live'], ['209', 2, 'Deluxe Twin', 'online', 4],
    ['301', 3, 'Deluxe King', 'live'], ['302', 3, 'Deluxe Twin', 'online', 1], ['303', 3, 'Deluxe King', 'online', 0],
    ['304', 3, 'Deluxe Twin', 'none'], ['320', 3, 'Family Suite', 'live'],
    ['410', 4, 'Deluxe King', 'online', 0], ['411', 4, 'Deluxe Twin', 'online', 1], ['412', 4, 'Marina Suite', 'live'],
    ['413', 4, 'Deluxe King', 'none'], ['414', 4, 'Deluxe Twin', 'offline', 180],
    ['517', 5, 'Marina Suite', 'live'], ['604', 6, 'Royal Suite', 'live', 47]
  ];
  var ROOM_TYPES = ['Deluxe King', 'Deluxe Twin', 'Marina Suite', 'Family Suite', 'Garden Twin', 'Royal Suite'];

  function tabletIdFor(n) { return 'KIRA-TB-0' + n; }

  function seedRooms(s) {
    var t0 = s.seededAt || Date.now();
    return ROOM_SEED.map(function (r) {
      var live = s.rooms && s.rooms[r[0]];
      var st = r[3] === 'live' ? (live && live.tablet === 'offline' ? 'offline' : 'online') : r[3];
      return {
        number: r[0], floor: r[1], type: live ? live.type : r[2],
        tabletId: st === 'none' ? null : tabletIdFor(r[0]), status: st,
        lag: st === 'online' ? (r[4] || 0) : 0,
        seenAt: st === 'offline' ? t0 - (r[4] || 30) * MIN : null
      };
    });
  }

  /** Fill in any missing admin data (deterministic, so reading without writing is safe). */
  function admin(s) {
    if (!s.admin || typeof s.admin !== 'object') s.admin = {};
    var a = s.admin;
    if (!a.setup) {
      a.setup = {
        step: 4, maxStep: 4, complete: false, location: 'Dubai Marina', roomsCount: 120, floors: 8,
        langs: ['en', 'ar', 'ru', 'zh', 'fr', 'de'], depts: template((s.hotel && s.hotel.stars) || 5)
      };
    }
    if (!a.kb) {
      a.kb = KB_SEED.map(function (k) {
        return { id: k.id, title: k.title, cat: k.cat, en: k.en, ar: k.ar, q: k.q, ans: k.ans, ansFor: k.en, status: 'published', updatedAt: k.at, by: 'Hotel admin' };
      });
    }
    if (!a.staff) {
      a.staff = STAFF_SEED.map(function (r) {
        return { id: r[0], name: r[1], dept: r[2], role: r[3], routing: r[4], status: r[5], onShift: r[6], lastSeen: r[7] };
      });
    }
    if (!a.headBase) a.headBase = Object.assign({}, HEAD_BASE);
    if (!a.rooms) a.rooms = seedRooms(s);
    return a;
  }

  /* =====================================================================
     Small helpers
     ===================================================================== */

  function $(id) { return document.getElementById(id); }
  function cap(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }
  function lower(t) { return String(t).toLowerCase(); }
  function num(n) { return Number(n).toLocaleString('en-US'); }
  function dayMonth(ts) { var d = new Date(ts); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function initials(name) {
    return String(name || '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || 'K';
  }
  function hashIdx(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h + str.charCodeAt(i) * (i + 1)) % 997; return h; }
  function qAttr(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  function truncate(t, n) { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function byNumber(a, b) { return Number(a.number) - Number(b.number); }

  /** Replace a region's HTML only if it changed; keeps keyboard focus on the same control. */
  function region(id, html) {
    var el = $(id);
    if (!el || el.__html === html) return;
    var act = document.activeElement, key = null;
    if (act && act !== document.body && el.contains(act)) key = act.getAttribute('data-key');
    el.innerHTML = html;
    el.__html = html;
    if (key) {
      var n = el.querySelector('[data-key="' + qAttr(key) + '"]');
      if (n) n.focus({ preventScroll: true });
    }
  }

  function chip(act, value, label, active, key) {
    return '<button type="button" class="tab-chip' + (active ? ' active' : '') + '" aria-pressed="' + !!active +
      '" data-act="' + act + '" data-v="' + esc(value) + '" data-key="' + esc(key || act + '-' + value) + '">' + esc(label) + '</button>';
  }

  function options(list, selected) {
    return list.map(function (o) {
      var v = typeof o === 'string' ? o : o.v, l = typeof o === 'string' ? o : o.l;
      return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }

  function field(label, control, errKey, extraCls) {
    return '<label class="adm-field' + (extraCls ? ' ' + extraCls : '') + '"><span class="adm-field-label">' + esc(label) + '</span>' + control +
      (errKey ? '<span class="adm-field-error" data-err="' + errKey + '"></span>' : '') + '</label>';
  }

  function focusKey(key) {
    var n = document.querySelector('[data-key="' + qAttr(key) + '"]');
    if (n) n.focus({ preventScroll: true });
    return !!n;
  }

  function setError(scope, key, msg) {
    var e = scope.querySelector('[data-err="' + key + '"]');
    if (e) e.textContent = msg || '';
    var input = e && e.parentNode.querySelector('.tool-input');
    if (input) { if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    return input;
  }

  // Rows that just appeared get the proto "is-new" highlight; a negative delay keeps the
  // animation continuous if the row is re-rendered while it plays.
  var fresh = {};
  function markFresh(key) { fresh[key] = Date.now(); }
  function trOpen(cls, freshKey) {
    var t = fresh[freshKey], style = '';
    if (t) {
      var el = Date.now() - t;
      if (el < 2400) { cls = (cls ? cls + ' ' : '') + 'is-new'; style = ' style="--new-delay:-' + el + 'ms"'; }
      else delete fresh[freshKey];
    }
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + style + '>';
  }

  function enabledDepts(s) { return admin(s).setup.depts.filter(function (d) { return d.on; }); }
  function deptRouting(s, name) {
    var d = admin(s).setup.depts.filter(function (x) { return x.name === name; })[0];
    return (d && d.routing) || DEPT_ROUTING[name] || 'Mobile app';
  }
  function headcount(s, name) {
    var a = admin(s);
    return (a.headBase[name] || 0) + a.staff.filter(function (p) { return p.dept === name && p.status !== 'inactive'; }).length;
  }
  function totalStaff(s) {
    var a = admin(s), total = 0;
    Object.keys(a.headBase).forEach(function (k) { total += a.headBase[k]; });
    return total + a.staff.filter(function (p) { return p.status !== 'inactive'; }).length;
  }

  /* =====================================================================
     UI state (module-level, survives re-renders)
     ===================================================================== */

  var ui = {
    setup: { adding: false },
    menu: { cat: 'all', q: '' },
    kb: { q: '', sel: null, drafts: {} },
    staff: { tab: 'all', q: '', adding: false, editId: null },
    rooms: { floor: 'all', q: '', registering: false, confirm: null, pinging: {} },
    req: { dept: 'all', slaOpen: false },
    an: { range: 7 }
  };
  var drawer = null;            // open menu drawer: { id, openerKey }
  var kbDetailFor = null;       // which article the KB detail form is showing
  var route = null, built = null, builtSig = null;
  var lastSeed = null, knownIds = null, lastChange = Date.now();

  function resetTransient() {
    closeDrawer(true);
    ui.setup.adding = false;
    ui.kb.sel = null; ui.kb.drafts = {};
    ui.staff.adding = false; ui.staff.editId = null;
    ui.rooms.registering = false; ui.rooms.confirm = null; ui.rooms.pinging = {};
    ui.req.slaOpen = false;
    kbDetailFor = null;
  }

  /* =====================================================================
     View: Setup wizard
     ===================================================================== */

  var setupTimer = null, setupPending = {};
  function flushSetup() {
    clearTimeout(setupTimer);
    var p = setupPending;
    setupPending = {};
    if (!Object.keys(p).length) return;
    store.update(function (s) {
      var st = admin(s).setup;
      if ('name' in p && p.name.trim()) s.hotel.name = p.name.trim().slice(0, 60);
      if ('location' in p) st.location = p.location.trim().slice(0, 60);
      if ('roomsCount' in p) { var r = parseInt(p.roomsCount, 10); if (r > 0 && r < 10000) st.roomsCount = r; }
      if ('floors' in p) { var f = parseInt(p.floors, 10); if (f > 0 && f < 200) st.floors = f; }
    });
  }

  function langSummary(st) {
    var on = LANGS.filter(function (l) { return st.langs.indexOf(l.id) >= 0; });
    var shown = on.slice(0, 2).map(function (l) { return l.native ? '<bdi lang="' + l.id + '">' + esc(l.native) + '</bdi>' : esc(l.label); });
    if (on.length > 2) shown.push('+' + (on.length - 2) + ' more');
    return shown.join(' · ');
  }

  var SetupView = {
    title: 'Setup',
    right: function () { return 'Draft saved automatically'; },
    sig: function (s) { return String(admin(s).setup.step); },
    build: function (s) {
      var st = admin(s).setup, step = st.step, body = '', hint = '';
      if (step === 1) {
        hint = 'You can change hotel details at any time.';
        body = '<p class="panel-title">Hotel info</p>' +
          '<p class="adm-wizard-meta">Shown on guest tablets and staff apps. Changes save as you type.</p>' +
          '<div class="adm-form-grid adm-wizard-form">' +
            field('Hotel name', '<input class="tool-input" data-in="setup-field" data-field="name" maxlength="60" value="' + esc(s.hotel.name) + '">', 'name') +
            field('Location', '<input class="tool-input" data-in="setup-field" data-field="location" maxlength="60" value="' + esc(st.location) + '">') +
            field('Rooms', '<input class="tool-input" type="number" min="1" max="9999" inputmode="numeric" data-in="setup-field" data-field="roomsCount" value="' + esc(st.roomsCount) + '">') +
            field('Floors', '<input class="tool-input" type="number" min="1" max="199" inputmode="numeric" data-in="setup-field" data-field="floors" value="' + esc(st.floors) + '">') +
          '</div>';
      } else if (step === 2) {
        hint = 'Changing the rating reloads the department template in step 4.';
        body = '<p class="panel-title">Star rating</p>' +
          '<p class="adm-wizard-meta">Kira loads the department template that matches your rating.</p>' +
          '<div class="adm-choice-grid" id="r-stars" role="group" aria-label="Star rating"></div>';
      } else if (step === 3) {
        hint = 'Guests can switch language at any time on the tablet.';
        body = '<p class="panel-title">Languages</p>' +
          '<p class="adm-wizard-meta" id="r-lang-meta"></p>' +
          '<div class="dept-grid" id="r-langs" role="group" aria-label="Languages"></div>';
      } else {
        hint = 'Routing for each department is set under Staff &amp; departments.';
        body = '<p class="panel-title" id="r-dept-title"></p>' +
          '<p class="adm-wizard-meta" id="r-dept-meta"></p>' +
          '<div class="dept-grid" id="r-dept-grid" role="group" aria-label="Departments"></div>' +
          '<div id="r-dept-form">' + (ui.setup.adding ? deptFormHtml() : '') + '</div>';
      }
      return '<div class="wizard-steps" id="r-wiz-steps"></div>' +
        '<div class="adm-summary cols-4" id="r-wiz-summary"></div>' +
        '<div class="adm-wizard-body">' + body + '</div>' +
        '<div class="adm-footer-actions"><span class="adm-hint">' + hint + '</span><div class="panel-actions">' +
          '<button type="button" class="btn-tool btn-tool-secondary" data-act="wiz-back"' + (step === 1 ? ' disabled' : '') + '>Back</button>' +
          '<button type="button" class="btn-tool btn-tool-primary" data-act="wiz-next">Continue</button>' +
        '</div></div>';
    },
    update: function (s) {
      var st = admin(s).setup, stars = s.hotel.stars || 5;
      region('r-wiz-steps', WIZARD.map(function (n, i) {
        var k = i + 1, active = k === st.step;
        var done = !active && (k < st.maxStep || (k === st.maxStep && st.complete));
        return '<button type="button" class="wizard-step' + (active ? ' active' : done ? ' done' : '') + '" data-act="wiz-step" data-v="' + k + '" data-key="wiz-' + k + '"' +
          (active ? ' aria-current="step"' : '') + '>' + k + '. ' + esc(n) + '</button>';
      }).join(''));
      region('r-wiz-summary',
        '<div><div class="adm-k">Hotel</div><div class="adm-v">' + esc(s.hotel.name + (st.location ? ', ' + st.location : '')) + '</div></div>' +
        '<div><div class="adm-k">Star rating</div><div class="adm-v">' + esc(STARS[stars].label) + '</div></div>' +
        '<div><div class="adm-k">Rooms</div><div class="adm-v">' + num(st.roomsCount) + ' rooms · ' + st.floors + ' floors</div></div>' +
        '<div><div class="adm-k">Languages</div><div class="adm-v">' + langSummary(st) + '</div></div>');

      if (st.step === 2) {
        region('r-stars', [3, 4, 5].map(function (n) {
          var on = n === stars;
          return '<button type="button" class="adm-choice" aria-pressed="' + on + '" data-act="wiz-stars" data-v="' + n + '" data-key="stars-' + n + '">' +
            '<span class="adm-choice-stars">' + esc(STARS[n].label) + '</span>' +
            '<span class="adm-choice-meta">' + TEMPLATE[n].length + ' departments · ' + esc(STARS[n].blurb) + '</span></button>';
        }).join(''));
      }
      if (st.step === 3) {
        region('r-lang-meta', st.langs.length + ' languages enabled · English is the base language; Kira detects each guest’s language automatically.');
        region('r-langs', LANGS.map(function (l) {
          var on = st.langs.indexOf(l.id) >= 0;
          return '<button type="button" class="dept-chip' + (on ? '' : ' off') + '" aria-pressed="' + on + '" data-act="lang-toggle" data-v="' + l.id + '" data-key="lang-' + l.id + '">' +
            esc(l.label) + (l.native ? ' · <bdi lang="' + l.id + '">' + esc(l.native) + '</bdi>' : '') + '</button>';
        }).join(''));
      }
      if (st.step === 4) {
        var on = st.depts.filter(function (d) { return d.on; }).length;
        region('r-dept-title', stars + '★ template loaded — ' + st.depts.length + ' departments. Disable or add as needed.');
        region('r-dept-meta', on + ' enabled · ' + (st.depts.length - on) + ' disabled. Select a department to toggle it.');
        region('r-dept-grid', st.depts.map(function (d) {
          return '<button type="button" class="dept-chip' + (d.on ? '' : ' off') + '" aria-pressed="' + d.on + '" data-act="dept-toggle" data-v="' + esc(d.name) +
            '" data-key="dept-' + esc(d.name) + '">' + esc(d.name) + '</button>';
        }).join('') + '<button type="button" class="dept-chip add" data-act="dept-add-open" data-key="dept-add" aria-expanded="' + ui.setup.adding + '">+ Add department</button>');
      }
    }
  };

  function deptFormHtml() {
    return '<form class="adm-panel" data-submit="dept-add" novalidate>' +
      '<p class="panel-title">Add a department</p>' +
      '<p class="adm-sub">It joins the template and becomes available for staff routing.</p>' +
      '<div class="adm-form-grid">' +
        field('Department name', '<input class="tool-input" name="f-name" maxlength="40" placeholder="e.g. Private dining" autocomplete="off">', 'name') +
        field('Routing target', '<select class="tool-input" name="f-routing">' + options(ROUTING, 'Mobile app') + '</select>') +
      '</div>' +
      '<div class="panel-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="dept-add-cancel">Cancel</button>' +
      '<button type="submit" class="btn-tool btn-tool-primary">Add department</button></div></form>';
  }

  function goStep(n) {
    flushSetup();
    n = Math.max(1, Math.min(4, n));
    store.update(function (s) { var st = admin(s).setup; st.step = n; st.maxStep = Math.max(st.maxStep || 1, n); });
  }

  /* =====================================================================
     View: Menu editor
     ===================================================================== */

  var MENU_TABS = [{ id: 'all', label: 'All' }].concat(['starters', 'mains', 'desserts', 'drinks'].map(function (id) {
    var c = K.data.MENU_CATS.filter(function (x) { return x.id === id; })[0];
    return { id: id, label: c ? (c.adminLabel || c.label) : cap(id) };
  }));
  var CAT_ORDER = { starters: 0, mains: 1, desserts: 2, drinks: 3 };
  var ALLERGENS = ['Gluten', 'Dairy', 'Nuts', 'Egg', 'Fish', 'Shellfish', 'Sesame', 'Soy'];
  var AVAIL = [
    { id: 'available', label: 'Available', hint: 'Guests can see and order it.' },
    { id: 'soldout', label: 'Sold out today', hint: 'Guests still see it, marked sold out — it can’t be ordered.' },
    { id: 'paused', label: 'Paused', hint: 'Hidden from guests until you switch it back on.' }
  ];

  function catLabel(id) {
    var t = MENU_TABS.filter(function (c) { return c.id === id; })[0];
    return t ? t.label : cap(id);
  }
  function availLabel(st) { return st === 'paused' ? 'Paused' : st === 'soldout' ? 'Sold out today' : 'Available'; }
  function sortedMenu(menu) {
    return menu.map(function (m, i) { return { m: m, i: i }; }).sort(function (a, b) {
      var ca = CAT_ORDER[a.m.cat], cb = CAT_ORDER[b.m.cat];
      ca = ca == null ? 9 : ca; cb = cb == null ? 9 : cb;
      return ca - cb || a.i - b.i;
    }).map(function (x) { return x.m; });
  }
  function parseAllergens(str) { return String(str || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function formatAllergens(list) { return list.map(function (x, i) { x = lower(x); return i === 0 ? cap(x) : x; }).join(', '); }

  var MenuView = {
    title: 'Menu',
    right: function () { return 'Changes sync to guest tablets instantly'; },
    build: function () {
      return '<div class="adm-head"><div><h3 class="adm-title">In-room dining menu</h3><p class="adm-sub" id="r-menu-sub"></p></div>' +
        '<div class="adm-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="menu-preview">Preview on tablet</button>' +
        '<button type="button" class="btn-tool btn-tool-primary" data-act="menu-add">+ Add item</button></div></div>' +
        '<div class="adm-toolbar"><div class="tabs-row" id="r-menu-tabs" role="group" aria-label="Filter by category"></div>' +
        '<input class="tool-input adm-search" type="search" placeholder="Search items" aria-label="Search menu items" data-in="menu-q" value="' + esc(ui.menu.q) + '"></div>' +
        '<div class="adm-table-wrap"><div class="table-scroll"><table class="data-table"><caption class="adm-sr">Menu items</caption>' +
        '<thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Allergens</th><th scope="col" class="adm-num">Price</th><th scope="col">Availability</th><th scope="col"><span class="adm-sr">Actions</span></th></tr></thead>' +
        '<tbody id="r-menu-rows"></tbody></table></div><div class="adm-table-foot" id="r-menu-foot"></div></div>';
    },
    update: function (s) {
      var menu = sortedMenu(s.menu), cats = {};
      menu.forEach(function (m) { cats[m.cat] = 1; });
      region('r-menu-sub', menu.length + ' items across ' + Object.keys(cats).length + ' categories · names shown to guests in English and Arabic');
      region('r-menu-tabs', MENU_TABS.map(function (c) { return chip('menu-cat', c.id, c.label, ui.menu.cat === c.id); }).join(''));
      var q = ui.menu.q.trim(), ql = lower(q);
      var rows = menu.filter(function (m) {
        if (ui.menu.cat !== 'all' && m.cat !== ui.menu.cat) return false;
        return !q || lower(m.name).indexOf(ql) >= 0 || String(m.nameAr || '').indexOf(q) >= 0;
      });
      region('r-menu-rows', rows.length ? rows.map(menuRow).join('') :
        '<tr><td colspan="6" class="adm-empty">' + (q ? 'No items match “' + esc(q) + '”.' : 'No items in this category yet.') + '</td></tr>');
      region('r-menu-foot', '<span>Showing ' + rows.length + ' of ' + menu.length + ' items</span><span>Paused items are hidden from guests</span>');
    }
  };

  function menuRow(m) {
    var st = m.status || 'available', on = st !== 'paused';
    var thumb = ['', ' sand', ' cool'][hashIdx(m.id) % 3];
    return trOpen('', 'menu:' + m.id) +
      '<td><div class="adm-cell"><span class="adm-thumb' + thumb + '" aria-hidden="true"></span><div><div class="adm-cell-title">' + esc(m.name) + '</div>' +
      '<div class="adm-cell-meta"><bdi lang="ar">' + esc(m.nameAr || '—') + '</bdi></div></div></div></td>' +
      '<td>' + esc(catLabel(m.cat)) + '</td><td class="adm-cell-meta">' + esc(m.allergens || '—') + '</td><td class="adm-num">' + K.fmt.money(m.price) + '</td>' +
      '<td><button type="button" class="adm-switch' + (st === 'soldout' ? ' is-soldout' : '') + '" role="switch" aria-checked="' + on + '" aria-label="Show ' + esc(m.name) + ' to guests" title="' + (on ? 'Pause — hide from guests' : 'Make available to guests') +
      '" data-act="menu-toggle" data-v="' + esc(m.id) + '" data-key="tog-' + esc(m.id) + '"><span class="adm-toggle' + (on ? ' on' : '') + (st === 'soldout' ? ' soldout' : '') + '" aria-hidden="true"></span>' + availLabel(st) + '</button></td>' +
      '<td class="adm-cell-actions"><button type="button" class="btn-tool btn-tool-secondary adm-row-action" data-act="menu-edit" data-v="' + esc(m.id) + '" data-key="edit-' + esc(m.id) + '">Edit<span class="adm-sr"> ' + esc(m.name) + '</span></button></td></tr>';
  }

  function openMenuDrawer(id, openerKey) {
    var s = store.get();
    var m = id ? s.menu.filter(function (x) { return x.id === id; })[0] : null;
    if (id && !m) { toast('That item no longer exists', 'warn'); return; }
    var d = m ? Object.assign({}, m) : { name: '', nameAr: '', cat: ui.menu.cat !== 'all' ? ui.menu.cat : 'mains', allergens: '', price: '', status: 'available' };
    drawer = { id: id, openerKey: openerKey };
    var have = parseAllergens(d.allergens).map(lower);
    var known = ALLERGENS.map(lower);
    var extras = parseAllergens(d.allergens).filter(function (x) { return known.indexOf(lower(x)) < 0; });
    var tags = ALLERGENS.map(function (a) {
      var on = have.indexOf(lower(a)) >= 0;
      return '<button type="button" class="adm-tag" aria-pressed="' + on + '" data-act="menu-allergen" data-v="' + a + '">' + a + '</button>';
    }).join('');
    var seg = AVAIL.map(function (o) {
      var on = (d.status || 'available') === o.id;
      return '<button type="button" class="tab-chip' + (on ? ' active' : '') + '" aria-pressed="' + on + '" data-act="menu-status" data-v="' + o.id + '">' + o.label + '</button>';
    }).join('');
    var hint = (AVAIL.filter(function (o) { return o.id === (d.status || 'available'); })[0] || AVAIL[0]).hint;
    var thumb = id ? ['', ' sand', ' cool'][hashIdx(id) % 3] : ' sand';

    $('adm-drawer-host').innerHTML =
      '<div class="adm-scrim" data-act="drawer-close"></div>' +
      '<aside class="adm-drawer" role="dialog" aria-modal="true" aria-labelledby="adm-drawer-title">' +
        '<div class="adm-drawer-head"><div><h3 class="adm-title" id="adm-drawer-title">' + (m ? 'Edit item' : 'Add item') + '</h3>' +
        '<p class="adm-sub">' + (m ? esc(m.name) + ' · changes go live on guest tablets when you save' : 'New items appear on guest tablets when you save') + '</p></div>' +
        '<button type="button" class="btn-tool btn-tool-secondary adm-row-action" data-act="drawer-close">Close</button></div>' +
        '<form class="adm-drawer-body" id="adm-menu-form" data-submit="menu-save" novalidate data-extra="' + esc(extras.join(', ')) + '" data-orig="' + esc(d.allergens || '') + '">' +
          '<div class="adm-photo"><span class="adm-thumb lg' + thumb + '" aria-hidden="true"></span><div>' +
            '<button type="button" class="btn-tool btn-tool-secondary adm-row-action" data-act="menu-photo">Upload photo</button>' +
            '<div class="adm-hint">Square JPG or PNG, at least 800 px</div></div></div>' +
          field('Name (English)', '<input class="tool-input" name="f-name" maxlength="60" autocomplete="off" value="' + esc(d.name) + '">', 'name') +
          field('Name (Arabic)', '<input class="tool-input" name="f-ar" maxlength="60" lang="ar" dir="rtl" autocomplete="off" value="' + esc(d.nameAr || '') + '">') +
          '<div class="adm-form-grid">' +
            field('Category', '<select class="tool-input" name="f-cat">' + options(MENU_TABS.slice(1).map(function (c) { return { v: c.id, l: c.label }; }), d.cat) + '</select>') +
            field('Price (AED)', '<input class="tool-input" name="f-price" type="number" min="0" step="0.5" inputmode="decimal" value="' + esc(d.price) + '">', 'price') +
          '</div>' +
          '<div class="adm-field"><span class="adm-field-label" id="adm-allergen-label">Allergens</span><div class="adm-tags" role="group" aria-labelledby="adm-allergen-label">' + tags + '</div>' +
            (extras.length ? '<span class="adm-hint">Also tagged: ' + esc(extras.join(', ')) + '</span>' : '') +
            '<span class="adm-hint">Shown to guests and flagged on kitchen tickets.</span></div>' +
          '<div class="adm-field"><span class="adm-field-label" id="adm-avail-label">Availability</span><div class="tabs-row adm-seg" role="group" aria-labelledby="adm-avail-label">' + seg + '</div>' +
            '<span class="adm-hint" id="adm-avail-hint">' + esc(hint) + '</span></div>' +
        '</form>' +
        '<div class="adm-drawer-foot"><button type="button" class="btn-tool btn-tool-secondary" data-act="drawer-close">Cancel</button>' +
        '<button type="submit" form="adm-menu-form" class="btn-tool btn-tool-primary">' + (m ? 'Save' : 'Add item') + '</button></div>' +
      '</aside>';
    document.documentElement.classList.add('adm-lock');
    var first = document.querySelector('#adm-menu-form [name="f-name"]');
    if (first) first.focus();
  }

  function closeDrawer(silent) {
    if (!drawer) return;
    var key = drawer.openerKey;
    drawer = null;
    $('adm-drawer-host').innerHTML = '';
    document.documentElement.classList.remove('adm-lock');
    if (!silent && key) {
      var n = document.querySelector('[data-key="' + qAttr(key) + '"]') || document.querySelector('[data-act="menu-add"]');
      if (n) n.focus({ preventScroll: true });
    }
  }

  /* =====================================================================
     View: Knowledge base
     ===================================================================== */

  function findKb(kb, id) { return kb.filter(function (a) { return a.id === id; })[0] || null; }
  function kbFields(a) { return { title: a.title, cat: a.cat, en: a.en, ar: a.ar }; }
  function kbDirty(a, d) { return !!d && (d.title !== a.title || d.cat !== a.cat || d.en !== a.en || d.ar !== a.ar); }

  function sentences(t) {
    var out = [], cur = '';
    for (var i = 0; i < t.length; i++) {
      cur += t[i];
      if (/[.!?]/.test(t[i]) && (i === t.length - 1 || /\s/.test(t[i + 1]))) { out.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  /** "How Kira will answer": the curated reply while the content matches it, else built from the first sentence(s). */
  function kiraAnswer(a, d) {
    var en = String(d.en || '').replace(/\s+/g, ' ').trim();
    if (a && a.ans && en === String(a.ansFor || '').trim()) return a.ans;
    if (!en) return 'I don’t have that information yet — let me connect you with the front desk.';
    var parts = sentences(en), reply = parts[0];
    if (reply.length < 60 && parts[1]) reply += ' ' + parts[1];
    if (!/[.!?]$/.test(reply)) reply += '.';
    if (/^[A-Z][a-z]/.test(reply) && !/^I\b/.test(reply)) reply = reply.charAt(0).toLowerCase() + reply.slice(1);
    return 'Happy to help — ' + reply;
  }
  function kiraQuestion(a, d) {
    if (a && a.q) return a.q;
    var t = String(d.title || '').trim();
    return t ? 'Can you tell me about ' + lower(t) + '?' : 'Can you help me with something?';
  }

  var KbView = {
    title: 'Knowledge base',
    right: function () { return 'Feeds Kira’s answers to guests'; },
    build: function () {
      kbDetailFor = null;
      return '<div class="kb-layout"><div class="kb-list">' +
        '<input class="tool-input adm-search" type="search" placeholder="Search articles" aria-label="Search articles" data-in="kb-q" value="' + esc(ui.kb.q) + '">' +
        '<div class="kb-items" id="r-kb-items"></div>' +
        '<button type="button" class="kb-add" data-act="kb-add">+ Add article</button></div>' +
        '<div class="kb-detail" id="r-kb-detail"></div></div>';
    },
    update: function (s) {
      var kb = admin(s).kb;
      if (!ui.kb.sel || !findKb(kb, ui.kb.sel)) ui.kb.sel = kb.length ? kb[0].id : null;
      region('r-kb-items', kbListHtml(kb));
      if (kbDetailFor !== ui.kb.sel || !$('kb-f-title')) renderKbDetail(s);
      else refreshKbMeta(s);
    }
  };

  function kbListHtml(kb) {
    var q = lower(ui.kb.q.trim());
    var groups = {}, order = [];
    kb.forEach(function (a) {
      var d = ui.kb.drafts[a.id] || a;
      if (q && lower(d.title + ' ' + d.cat + ' ' + d.en + ' ' + a.title).indexOf(q) < 0) return;
      var g = a.cat || 'General';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(a);
    });
    var pref = ['Facilities', 'Guest services'];
    order.sort(function (x, y) {
      var ix = pref.indexOf(x), iy = pref.indexOf(y);
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.localeCompare(y);
    });
    if (!order.length) return '<p class="adm-hint kb-empty">' + (q ? 'No articles match “' + esc(ui.kb.q.trim()) + '”.' : 'No articles yet.') + '</p>';
    return order.map(function (g) {
      return '<div class="adm-k">' + esc(g) + '</div>' + groups[g].map(function (a) {
        var d = ui.kb.drafts[a.id], dirty = kbDirty(a, d), active = a.id === ui.kb.sel;
        var meta = dirty ? 'Unsaved changes' : a.status === 'draft' ? 'Draft · not live yet' : 'Updated ' + dayMonth(a.updatedAt);
        return '<button type="button" class="kb-item' + (active ? ' active' : '') + '"' + (active ? ' aria-current="true"' : '') +
          ' data-act="kb-select" data-v="' + esc(a.id) + '" data-key="kb-' + esc(a.id) + '">' + esc((d || a).title || 'Untitled article') +
          '<small' + (dirty || a.status === 'draft' ? ' class="is-dirty"' : '') + '>' + meta + '</small></button>';
      }).join('');
    }).join('');
  }

  function renderKbDetail(s) {
    var kb = admin(s).kb, a = findKb(kb, ui.kb.sel), el = $('r-kb-detail');
    kbDetailFor = ui.kb.sel;
    if (!el) return;
    if (!a) {
      el.innerHTML = '<div class="adm-empty-block"><p class="panel-title">No articles yet</p><p class="adm-sub">Add the facts Kira should know — opening hours, policies, directions.</p>' +
        '<div class="panel-actions" style="justify-content:flex-start"><button type="button" class="btn-tool btn-tool-primary" data-act="kb-add">+ Add article</button></div></div>';
      el.__html = null;
      return;
    }
    var d = ui.kb.drafts[a.id] || kbFields(a);
    var cats = {};
    kb.forEach(function (x) { if (x.cat) cats[x.cat] = 1; });
    ['Facilities', 'Guest services', 'Dining', 'Local area'].forEach(function (c) { cats[c] = 1; });
    el.innerHTML =
      '<div class="adm-head"><div><h3 class="adm-title" id="kb-h-title"></h3><p class="adm-sub" id="kb-sub"></p></div><span class="badge" id="kb-badge"></span></div>' +
      '<div class="kb-fields">' +
        '<div class="tool-form-row"><label for="kb-f-title">Title</label><input id="kb-f-title" class="tool-input" maxlength="80" autocomplete="off" data-in="kb-field" data-field="title" value="' + esc(d.title) + '"><span class="adm-field-error" id="kb-err-title"></span></div>' +
        '<div class="tool-form-row"><label for="kb-f-cat">Category</label><input id="kb-f-cat" class="tool-input" maxlength="40" list="kb-cats" autocomplete="off" data-in="kb-field" data-field="cat" value="' + esc(d.cat) + '">' +
        '<datalist id="kb-cats">' + Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
      '</div>' +
      '<div class="tool-form-row"><label for="kb-f-en">Content (English)</label><textarea id="kb-f-en" class="tool-input" rows="3" data-in="kb-field" data-field="en">' + esc(d.en) + '</textarea></div>' +
      '<div class="tool-form-row"><label for="kb-f-ar">Content (Arabic)</label><textarea id="kb-f-ar" class="tool-input" rows="3" lang="ar" dir="rtl" data-in="kb-field" data-field="ar">' + esc(d.ar) + '</textarea></div>' +
      '<div class="adm-k">How Kira will answer</div>' +
      '<div class="kb-preview"><div class="q" id="kb-prev-q"></div><div class="a" id="kb-prev-a"></div></div>' +
      '<div class="adm-footer-actions"><span class="adm-hint" id="kb-hint"></span><div class="panel-actions">' +
        '<button type="button" class="btn-tool btn-tool-secondary" id="kb-discard" data-act="kb-discard">Discard</button>' +
        '<button type="button" class="btn-tool btn-tool-primary" id="kb-save" data-act="kb-save">Save</button></div></div>';
    el.__html = null;
    refreshKbMeta(s);
  }

  function refreshKbMeta(s) {
    var a = findKb(admin(s).kb, kbDetailFor);
    if (!a || !$('kb-h-title')) return;
    var d = ui.kb.drafts[a.id] || kbFields(a), dirty = kbDirty(a, d), draft = a.status === 'draft';
    $('kb-h-title').textContent = d.title.trim() || 'Untitled article';
    $('kb-sub').textContent = (d.cat.trim() || 'General') + ' · ' + (draft ? 'draft — Kira won’t use it until you publish' : 'live for guests');
    var badge = $('kb-badge');
    badge.className = 'badge ' + (dirty || draft ? 'badge-warn' : 'badge-ok');
    badge.textContent = dirty ? 'Unsaved changes' : draft ? 'Draft' : 'Published';
    $('kb-prev-q').textContent = 'Guest: “' + kiraQuestion(a, d) + '”';
    $('kb-prev-a').textContent = kiraAnswer(a, d);
    $('kb-hint').textContent = draft ? 'Draft created ' + dayMonth(a.updatedAt) + ' by ' + (a.by || 'Hotel admin') : 'Last updated ' + dayMonth(a.updatedAt) + ' by ' + (a.by || 'Hotel admin');
    var save = $('kb-save'), discard = $('kb-discard');
    save.textContent = draft ? 'Publish' : 'Save';
    save.disabled = !draft && !dirty;
    discard.textContent = draft ? 'Delete draft' : 'Discard';
    discard.disabled = !draft && !dirty;
  }

  /* =====================================================================
     View: Staff & departments
     ===================================================================== */

  var STAFF_STATUS = { active: ['badge-ok', 'Active'], invited: ['badge-warn', 'Invite sent'], inactive: ['badge-err', 'Deactivated'] };

  var StaffView = {
    title: 'Staff & departments',
    right: function (s) { return totalStaff(s) + ' staff · ' + enabledDepts(s).length + ' departments'; },
    build: function (s) {
      return '<div class="adm-head"><div><h3 class="adm-title">Staff &amp; departments</h3><p class="adm-sub">Who receives each request, and on which device</p></div>' +
        '<div class="adm-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="staff-manage">Manage departments</button>' +
        '<button type="button" class="btn-tool btn-tool-primary" data-act="staff-add" aria-expanded="' + ui.staff.adding + '">+ Add staff</button></div></div>' +
        '<div class="adm-dept-cards" id="r-dept-cards"></div>' +
        '<div id="r-staff-form">' + (ui.staff.adding ? staffFormHtml(s) : '') + '</div>' +
        '<div class="adm-toolbar"><div class="tabs-row" id="r-staff-tabs" role="group" aria-label="Filter staff"></div>' +
        '<input class="tool-input adm-search" type="search" placeholder="Search staff" aria-label="Search staff" data-in="staff-q" value="' + esc(ui.staff.q) + '"></div>' +
        '<div class="adm-table-wrap"><div class="table-scroll"><table class="data-table"><caption class="adm-sr">Staff members</caption>' +
        '<thead><tr><th scope="col">Staff member</th><th scope="col">Department</th><th scope="col">Routing</th><th scope="col">Last active</th><th scope="col">Status</th><th scope="col"><span class="adm-sr">Actions</span></th></tr></thead>' +
        '<tbody id="r-staff-rows"></tbody></table></div><div class="adm-table-foot" id="r-staff-foot"></div></div>';
    },
    update: function (s) {
      var a = admin(s);
      var names = enabledDepts(s).map(function (d) { return d.name; });
      var pref = ['Dining', 'Housekeeping', 'Front desk', 'Valet'].filter(function (n) { return names.indexOf(n) >= 0; });
      var ordered = pref.concat(names.filter(function (n) { return pref.indexOf(n) < 0; }));
      var shown = ordered.slice(0, 4), rest = ordered.slice(4);
      region('r-dept-cards', shown.map(function (n) {
        return '<div class="adm-card"><div class="adm-dept-name">' + esc(n) + '</div><div class="adm-dept-count">' + headcount(s, n) + ' <small>staff</small></div><span class="adm-channel">' + esc(deptRouting(s, n)) + '</span></div>';
      }).join('') + (rest.length ? '<div class="adm-card more"><div class="adm-dept-name">+' + rest.length + ' more</div><div class="adm-cell-meta adm-more-list">' +
        esc(rest.slice(0, 4).join(', ')) + (rest.length > 4 ? '…' : '') + '</div></div>' : ''));

      region('r-staff-tabs', [['all', 'All staff'], ['shift', 'On shift'], ['invited', 'Invited']].map(function (t) {
        return chip('staff-tab', t[0], t[1], ui.staff.tab === t[0]);
      }).join(''));

      var q = lower(ui.staff.q.trim());
      var rows = a.staff.filter(function (p) {
        if (ui.staff.tab === 'shift' && !(p.onShift && p.status === 'active')) return false;
        if (ui.staff.tab === 'invited' && p.status !== 'invited') return false;
        return !q || lower(p.name + ' ' + p.dept + ' ' + p.role + ' ' + p.routing).indexOf(q) >= 0;
      });
      if (!ui.staff.editId || !a.staff.some(function (p) { return p.id === ui.staff.editId; })) {
        ui.staff.editId = null;
        region('r-staff-rows', rows.length ? rows.map(function (p) { return staffRow(p); }).join('') :
          '<tr><td colspan="6" class="adm-empty">' + (q ? 'No staff match “' + esc(ui.staff.q.trim()) + '”.' : ui.staff.tab === 'invited' ? 'No pending invites.' : 'Nobody here yet.') + '</td></tr>');
      }
      region('r-staff-foot', '<span>Showing ' + rows.length + ' of ' + totalStaff(s) + ' staff</span><span>Routing is set per department, overridable per person</span>');
    }
  };

  function staffRow(p) {
    var b = STAFF_STATUS[p.status] || STAFF_STATUS.active;
    var last = p.status === 'invited' ? '—' : p.onShift && p.status === 'active' ? 'On shift' : (p.lastSeen || '—');
    var actions = (p.status === 'invited' ? '<button type="button" class="btn-tool btn-tool-secondary adm-row-action" data-act="staff-resend" data-v="' + esc(p.id) + '" data-key="resend-' + esc(p.id) + '">Resend</button>' : '') +
      '<button type="button" class="btn-tool btn-tool-secondary adm-row-action" data-act="staff-edit" data-v="' + esc(p.id) + '" data-key="sedit-' + esc(p.id) + '">Edit<span class="adm-sr"> ' + esc(p.name) + '</span></button>';
    return trOpen('', 'staff:' + p.id) +
      '<td><div class="adm-cell"><span class="adm-avatar">' + esc(initials(p.name)) + '</span><div class="adm-cell-title">' + esc(p.name) + '</div></div></td>' +
      '<td>' + esc(p.dept) + '<div class="adm-cell-meta">' + esc(p.role || '—') + '</div></td><td><span class="adm-channel">' + esc(p.routing) + '</span></td>' +
      '<td class="adm-cell-meta">' + esc(last) + '</td><td><span class="badge ' + b[0] + '">' + b[1] + '</span></td>' +
      '<td class="adm-cell-actions">' + actions + '</td></tr>';
  }

  function staffEditRow(s, p) {
    var depts = enabledDepts(s).map(function (d) { return d.name; });
    if (depts.indexOf(p.dept) < 0) depts.unshift(p.dept);
    return '<tr class="adm-edit-row"><td colspan="6"><form class="adm-inline-form" data-submit="staff-edit-save" data-v="' + esc(p.id) + '" novalidate>' +
      '<div class="adm-inline-who"><span class="adm-avatar">' + esc(initials(p.name)) + '</span><div><div class="adm-cell-title">' + esc(p.name) + '</div><div class="adm-cell-meta">Editing</div></div></div>' +
      field('Department', '<select class="tool-input" name="f-dept">' + options(depts, p.dept) + '</select>') +
      field('Role', '<input class="tool-input" name="f-role" maxlength="40" value="' + esc(p.role) + '">') +
      field('Routing', '<select class="tool-input" name="f-routing">' + options(ROUTING.indexOf(p.routing) >= 0 ? ROUTING : [p.routing].concat(ROUTING), p.routing) + '</select>') +
      field('Status', '<select class="tool-input" name="f-status">' + options([{ v: 'active', l: 'Active' }, { v: 'invited', l: 'Invite sent' }, { v: 'inactive', l: 'Deactivated' }], p.status) + '</select>') +
      '<div class="panel-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="staff-edit-cancel">Cancel</button>' +
      '<button type="submit" class="btn-tool btn-tool-primary">Save</button></div></form></td></tr>';
  }

  function staffFormHtml(s) {
    var depts = enabledDepts(s).map(function (d) { return d.name; });
    return '<form class="adm-panel" data-submit="staff-add" novalidate>' +
      '<p class="panel-title">Add staff member</p><p class="adm-sub">They get an invite to sign in to the Kira staff app; requests start routing once they accept.</p>' +
      '<div class="adm-form-grid">' +
        field('Full name', '<input class="tool-input" name="f-name" maxlength="40" autocomplete="off" placeholder="e.g. Mariam K.">', 'name') +
        field('Department', '<select class="tool-input" name="f-dept" data-ch="staff-dept">' + options(depts, depts[0]) + '</select>') +
        field('Role', '<input class="tool-input" name="f-role" maxlength="40" autocomplete="off" placeholder="e.g. Waiter">') +
        field('Routing', '<select class="tool-input" name="f-routing">' + options(ROUTING, deptRouting(s, depts[0])) + '</select>') +
      '</div>' +
      '<div class="panel-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="staff-add-cancel">Cancel</button>' +
      '<button type="submit" class="btn-tool btn-tool-primary">Send invite</button></div></form>';
  }

  function renderStaffForm() {
    var host = $('r-staff-form');
    if (!host) return;
    host.innerHTML = ui.staff.adding ? staffFormHtml(store.get()) : '';
    var btn = document.querySelector('[data-act="staff-add"]');
    if (btn) btn.setAttribute('aria-expanded', String(ui.staff.adding));
    if (ui.staff.adding) host.querySelector('[name="f-name"]').focus();
  }

  function refreshStaffRows() {
    var el = $('r-staff-rows');
    if (el) el.__html = null;
    render();
  }

  /* =====================================================================
     View: Rooms & tablets
     ===================================================================== */

  function findRoom(list, n) { return list.filter(function (r) { return r.number === n; })[0] || null; }
  function roomState(e, s) {
    if (!e.tabletId) return 'none';
    if (ui.rooms.pinging[e.number]) return 'pinging';
    var live = s.rooms && s.rooms[e.number];
    if (live) return live.tablet === 'offline' ? 'offline' : 'online';
    return e.status === 'offline' ? 'offline' : 'online';
  }

  var RoomsView = {
    title: 'Rooms',
    right: function (s) {
      var rooms = admin(s).rooms, floors = {};
      rooms.forEach(function (r) { floors[r.floor] = 1; });
      return rooms.length + ' rooms · ' + Object.keys(floors).length + ' floors';
    },
    build: function () {
      return '<div class="adm-head"><div><h3 class="adm-title">Rooms &amp; tablets</h3><p class="adm-sub">Bind each in-room tablet to its room. Rollout runs floor by floor.</p></div>' +
        '<div class="adm-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="rooms-import">Import room list</button>' +
        '<button type="button" class="btn-tool btn-tool-primary" data-act="rooms-register" aria-expanded="' + ui.rooms.registering + '">+ Register tablet</button></div></div>' +
        '<div class="adm-summary cols-4" id="r-rooms-summary"></div>' +
        '<div id="r-rooms-form">' + (ui.rooms.registering ? roomFormHtml() : '') + '</div>' +
        '<div class="adm-toolbar"><div class="tabs-row" id="r-rooms-tabs" role="group" aria-label="Filter by floor"></div>' +
        '<input class="tool-input adm-search" type="search" placeholder="Room or tablet ID" aria-label="Search rooms or tablet IDs" data-in="rooms-q" value="' + esc(ui.rooms.q) + '"></div>' +
        '<div class="adm-table-wrap"><div class="table-scroll"><table class="data-table"><caption class="adm-sr" id="r-rooms-caption">Rooms</caption>' +
        '<thead><tr><th scope="col">Room</th><th scope="col">Type</th><th scope="col">Tablet ID</th><th scope="col">Status</th><th scope="col">Last seen</th><th scope="col"><span class="adm-sr">Actions</span></th></tr></thead>' +
        '<tbody id="r-rooms-rows"></tbody></table></div><div class="adm-table-foot" id="r-rooms-foot"></div></div>';
    },
    update: function (s) {
      var rooms = admin(s).rooms.slice().sort(byNumber);
      var c = { online: 0, offline: 0, none: 0 };
      rooms.forEach(function (e) { var st = roomState(e, s); c[st === 'pinging' ? 'offline' : st]++; });
      var bound = c.online + c.offline, pct = rooms.length ? Math.round(bound / rooms.length * 100) : 0;
      region('r-rooms-summary',
        '<div><div class="adm-k">Rollout</div><div class="adm-v big">' + pct + '%</div><div class="adm-progress" role="img" aria-label="' + bound + ' of ' + rooms.length + ' rooms bound"><span style="width: ' + pct + '%;"></span></div></div>' +
        '<div><div class="adm-k"><span class="adm-dot ok"></span>Online</div><div class="adm-v big">' + c.online + '</div></div>' +
        '<div><div class="adm-k"><span class="adm-dot err"></span>Offline</div><div class="adm-v big">' + c.offline + '</div></div>' +
        '<div><div class="adm-k"><span class="adm-dot warn"></span>Not registered</div><div class="adm-v big">' + c.none + '</div></div>');

      var floors = [];
      rooms.forEach(function (r) { if (floors.indexOf(r.floor) < 0) floors.push(r.floor); });
      floors.sort(function (x, y) { return x - y; });
      if (ui.rooms.floor !== 'all' && floors.indexOf(Number(ui.rooms.floor)) < 0) ui.rooms.floor = 'all';
      region('r-rooms-tabs', chip('rooms-floor', 'all', 'All floors', ui.rooms.floor === 'all') +
        floors.map(function (f) { return chip('rooms-floor', String(f), 'Floor ' + f, String(ui.rooms.floor) === String(f)); }).join(''));

      var scope = rooms.filter(function (r) { return ui.rooms.floor === 'all' || String(r.floor) === String(ui.rooms.floor); });
      var q = lower(ui.rooms.q.trim());
      var rows = scope.filter(function (r) { return !q || lower(r.number + ' ' + (r.tabletId || '') + ' ' + r.type).indexOf(q) >= 0; });
      var scopeLabel = ui.rooms.floor === 'all' ? 'All floors' : 'Floor ' + ui.rooms.floor;
      region('r-rooms-caption', 'Rooms — ' + scopeLabel);
      region('r-rooms-rows', rows.length ? rows.map(function (e) { return roomRow(s, e); }).join('') :
        '<tr><td colspan="6" class="adm-empty">' + (q ? 'No room or tablet matches “' + esc(ui.rooms.q.trim()) + '”.' : 'No rooms on this floor yet.') + '</td></tr>');
      region('r-rooms-foot', '<span>' + scopeLabel + ' · ' + rows.length + ' of ' + scope.length + ' rooms shown</span><span>Offline tablets alert the front desk after 15 min</span>');
    }
  };

  function roomRow(s, e) {
    var st = roomState(e, s), n = esc(e.number), badge, seen, actions;
    if (st === 'online') { badge = '<span class="badge badge-ok">Bound, online</span>'; seen = e.lag ? e.lag + ' min ago' : 'Just now'; }
    else if (st === 'offline') { badge = '<span class="badge badge-err">Offline</span>'; seen = cap(K.fmt.ago(e.seenAt || store.get().seededAt)); }
    else if (st === 'pinging') { badge = '<span class="badge badge-warn">Pinging…</span>'; seen = cap(K.fmt.ago(e.seenAt || store.get().seededAt)); }
    else { badge = '<span class="badge badge-warn">Not registered</span>'; seen = '—'; }

    var btn = function (act, label, primary, extraCls) {
      return '<button type="button" class="btn-tool ' + (primary ? 'btn-tool-primary' : 'btn-tool-secondary') + ' adm-row-action' + (extraCls ? ' ' + extraCls : '') +
        '" data-act="' + act + '" data-v="' + n + '" data-key="' + act + '-' + n + '">' + label + '<span class="adm-sr"> room ' + n + '</span></button>';
    };
    if (ui.rooms.confirm === e.number && e.tabletId) actions = btn('room-unbind-no', 'Cancel') + btn('room-unbind-yes', 'Confirm unbind', false, 'is-danger');
    else if (st === 'online') actions = btn('room-unbind', 'Unbind');
    else if (st === 'offline') actions = btn('room-ping', 'Troubleshoot') + btn('room-unbind', 'Unbind');
    else if (st === 'pinging') actions = '<button type="button" class="btn-tool btn-tool-secondary adm-row-action" disabled>Pinging…</button>';
    else actions = btn('room-bind', 'Bind tablet', true);

    return trOpen('', 'room:' + e.number) +
      '<td class="adm-cell-title">' + n + '</td><td>' + esc(e.type) + '</td>' +
      (e.tabletId ? '<td class="adm-id">' + esc(e.tabletId) + '</td>' : '<td class="adm-cell-meta">—</td>') +
      '<td>' + badge + '</td><td class="adm-cell-meta">' + esc(seen) + '</td><td class="adm-cell-actions">' + actions + '</td></tr>';
  }

  function roomFormHtml() {
    return '<form class="adm-panel" data-submit="room-register" novalidate>' +
      '<p class="panel-title">Register a tablet</p><p class="adm-sub">Enter the room the tablet is going into — Kira assigns its tablet ID and binds it.</p>' +
      '<div class="adm-form-grid">' +
        field('Room number', '<input class="tool-input" name="f-room" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="e.g. 415" data-in="room-preview">', 'room') +
        field('Room type (new rooms)', '<select class="tool-input" name="f-type">' + options(ROOM_TYPES, 'Deluxe King') + '</select>') +
        field('Tablet ID', '<input class="tool-input adm-id-input" name="f-id" readonly tabindex="-1" value="KIRA-TB-0…" aria-readonly="true">') +
      '</div>' +
      '<div class="panel-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="rooms-register-cancel">Cancel</button>' +
      '<button type="submit" class="btn-tool btn-tool-primary">Register &amp; bind</button></div></form>';
  }

  function renderRoomForm() {
    var host = $('r-rooms-form');
    if (!host) return;
    host.innerHTML = ui.rooms.registering ? roomFormHtml() : '';
    var btn = document.querySelector('[data-act="rooms-register"]');
    if (btn) btn.setAttribute('aria-expanded', String(ui.rooms.registering));
    if (ui.rooms.registering) host.querySelector('[name="f-room"]').focus();
  }

  /* =====================================================================
     View: Live request board
     ===================================================================== */

  var REQ_TABS = [['all', 'All departments'], ['dining', 'Dining'], ['housekeeping', 'Housekeeping'], ['valet', 'Valet'], ['concierge', 'Concierge'], ['frontdesk', 'Front desk']];
  var SLA_FIELDS = [['dining', 'Dining'], ['housekeeping', 'Housekeeping'], ['valet', 'Valet'], ['concierge', 'Concierge'], ['checkout', 'Front desk · late checkout'], ['help', 'Front desk · help & emergencies']];

  function inTab(r, tab) {
    if (tab === 'all') return true;
    if (tab === 'frontdesk') return r.dept === 'checkout' || r.dept === 'help';
    return r.dept === tab;
  }

  var RequestsView = {
    title: 'Request board',
    right: function () { return '<span class="adm-live">Live</span>'; },
    rightHtml: true,
    build: function (s) {
      return '<div class="adm-head"><div><h3 class="adm-title">Live request board</h3><p class="adm-sub" id="r-req-sub"></p></div>' +
        '<div class="adm-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="sla-open" aria-expanded="' + ui.req.slaOpen + '">SLA settings</button></div></div>' +
        '<div id="r-sla-panel">' + (ui.req.slaOpen ? slaFormHtml(s) : '') + '</div>' +
        '<div class="adm-summary cols-4" id="r-req-summary"></div>' +
        '<div class="adm-toolbar"><div class="tabs-row" id="r-req-tabs" role="group" aria-label="Filter by department"></div></div>' +
        '<div class="adm-table-wrap"><div class="table-scroll"><table class="data-table"><caption class="adm-sr">Open guest requests</caption>' +
        '<thead><tr><th scope="col">Room</th><th scope="col">Department</th><th scope="col">Request</th><th scope="col">Assigned</th><th scope="col">SLA</th><th scope="col">Status</th><th scope="col">Escalation</th></tr></thead>' +
        '<tbody id="r-req-rows"></tbody></table></div><div class="adm-table-foot" id="r-req-foot"></div></div>';
    },
    update: function (s) {
      var now = Date.now();
      var open = s.requests.filter(function (r) { return store.isOpen(r) && inTab(r, ui.req.dept); }).map(function (r) {
        return { r: r, sla: store.sla(r, now) };
      }).sort(function (a, b) { return a.sla.minsLeft - b.sla.minsLeft; });
      var c = { ok: 0, warn: 0, err: 0 };
      open.forEach(function (x) { c[x.sla.level]++; });
      var tabLabel = REQ_TABS.filter(function (t) { return t[0] === ui.req.dept; })[0][1];
      region('r-req-sub', (ui.req.dept === 'all' ? 'All departments, hotel-wide' : esc(tabLabel)) + ' · ' + open.length + ' open');
      region('r-req-summary',
        '<div><div class="adm-k">Open</div><div class="adm-v big">' + open.length + '</div></div>' +
        '<div><div class="adm-k"><span class="adm-dot ok"></span>On track</div><div class="adm-v big">' + c.ok + '</div></div>' +
        '<div><div class="adm-k"><span class="adm-dot warn"></span>At risk</div><div class="adm-v big">' + c.warn + '</div></div>' +
        '<div><div class="adm-k"><span class="adm-dot err"></span>Overdue</div><div class="adm-v big">' + c.err + '</div></div>');
      region('r-req-tabs', REQ_TABS.map(function (t) { return chip('req-tab', t[0], t[1], ui.req.dept === t[0]); }).join(''));
      region('r-req-rows', open.length ? open.map(function (x) { return reqRow(x.r, x.sla); }).join('') :
        '<tr><td colspan="7" class="adm-empty">No open requests' + (ui.req.dept === 'all' ? '' : ' for ' + esc(tabLabel)) + '. New ones appear here the moment a guest asks.</td></tr>');
      var sla = s.settings.sla;
      region('r-req-foot', '<span>SLA targets: Dining ' + sla.dining + ' min · Housekeeping ' + sla.housekeeping + ' min · Valet ' + sla.valet + ' min · Concierge ' + sla.concierge +
        ' min · Front desk ' + sla.checkout + ' min</span><span>Updated ' + K.fmt.ago(lastChange) + '</span>');
    }
  };

  function reqRow(r, sla) {
    var escalation = r.escalated || (sla.level === 'err' ? 'Manager notified' : '');
    var who = r.claimedBy || r.assignee || '—';
    return trOpen(sla.level === 'err' ? 'adm-row-alert' : '', 'req:' + r.id) +
      '<td class="adm-cell-title">' + esc(r.room) + '</td><td>' + esc(store.deptLabel(r)) + '</td>' +
      '<td><span class="adm-id">' + esc(r.ref || '#' + r.id) + '</span><div class="adm-cell-meta">' + esc(store.summary(r)) + '</div></td>' +
      '<td class="adm-nowrap">' + esc(who) + '</td><td><span class="badge badge-' + sla.level + '">' + esc(sla.label) + '</span></td>' +
      '<td class="adm-nowrap">' + esc(store.statusLabel(r)) + '</td>' +
      (escalation ? '<td class="adm-escalated">' + esc(escalation) + '</td>' : '<td class="adm-cell-meta">—</td>') + '</tr>';
  }

  function slaFormHtml(s) {
    var sla = s.settings.sla;
    return '<form class="adm-panel" data-submit="sla-save" novalidate>' +
      '<p class="panel-title">SLA targets</p><p class="adm-sub">Minutes from request to completion. New requests use these targets; open ones keep the target they started with. Overdue requests notify the duty manager.</p>' +
      '<div class="adm-form-grid">' + SLA_FIELDS.map(function (f) {
        return field(f[1], '<input class="tool-input" type="number" min="1" max="240" inputmode="numeric" name="sla-' + f[0] + '" value="' + esc(sla[f[0]]) + '">', 'sla-' + f[0]);
      }).join('') + '</div>' +
      '<div class="panel-actions"><button type="button" class="btn-tool btn-tool-secondary" data-act="sla-cancel">Cancel</button>' +
      '<button type="submit" class="btn-tool btn-tool-primary">Save targets</button></div></form>';
  }

  function renderSlaPanel() {
    var host = $('r-sla-panel');
    if (!host) return;
    host.innerHTML = ui.req.slaOpen ? slaFormHtml(store.get()) : '';
    var btn = document.querySelector('[data-act="sla-open"]');
    if (btn) btn.setAttribute('aria-expanded', String(ui.req.slaOpen));
    if (ui.req.slaOpen) host.querySelector('input').focus();
  }

  /* =====================================================================
     View: Analytics
     ===================================================================== */

  var AN_LANGS = ['English', 'Arabic', 'Russian', 'Chinese', 'French', 'German'];
  var AN_DEPTS = ['Dining', 'Housekeeping', 'Concierge', 'Valet', 'Front desk'];
  var AN = {
    7: { total: 342, sla: '94%', langs: 6, resp: '2.1s', prev: 'last week',
      delta: ['▲ 12% vs last week', '▲ 2 pts vs last week', 'Arabic: 31% of requests', '▼ 0.3s faster'],
      dept: [128, 88, 64, 40, 22], lang: [41, 31, 11, 8, 5, 4] },
    30: { total: 1486, sla: '93%', langs: 7, resp: '2.2s', prev: 'previous 30 days',
      delta: ['▲ 8% vs previous 30 days', '▲ 1 pt vs previous 30 days', 'Arabic: 30% of requests', '▼ 0.2s faster'],
      dept: [552, 386, 271, 180, 97], lang: [41, 30, 11, 8, 5, 4] },
    90: { total: 4410, sla: '91%', langs: 9, resp: '2.4s', prev: 'previous 90 days',
      delta: ['▲ 21% vs previous 90 days', '▲ 4 pts vs previous 90 days', 'Arabic: 29% of requests', '▼ 0.6s faster'],
      dept: [1650, 1140, 802, 530, 288], lang: [42, 29, 12, 7, 5, 3] }
  };

  function rangeLabel(days) {
    var end = new Date(Date.now() - DAY), start = new Date(end.getTime() - (days - 1) * DAY);
    var e = end.getDate() + ' ' + MONTHS[end.getMonth()] + ' ' + end.getFullYear();
    if (start.getFullYear() !== end.getFullYear()) return start.getDate() + ' ' + MONTHS[start.getMonth()] + ' ' + start.getFullYear() + ' – ' + e;
    if (start.getMonth() !== end.getMonth()) return start.getDate() + ' ' + MONTHS[start.getMonth()] + ' – ' + e;
    return start.getDate() + '–' + e;
  }

  var AnalyticsView = {
    title: 'Analytics',
    right: function () { return esc(rangeLabel(ui.an.range)); },
    rightHtml: true,
    build: function () {
      return '<div class="adm-head"><div><h3 class="adm-title">Analytics</h3><p class="adm-sub" id="r-an-sub"></p></div>' +
        '<div class="adm-actions"><div class="tabs-row" id="r-an-tabs" role="group" aria-label="Date range"></div>' +
        '<button type="button" class="btn-tool btn-tool-secondary" data-act="an-export">Export CSV</button></div></div>' +
        '<div class="adm-live-strip" id="r-an-live"></div>' +
        '<div class="stat-grid" id="r-an-stats"></div>' +
        '<div class="adm-chart-grid" id="r-an-charts"></div>';
    },
    update: function (s) {
      var d = AN[ui.an.range];
      region('r-an-sub', 'Requests and Kira performance vs. the ' + (ui.an.range === 7 ? 'previous 7 days' : d.prev) + ' · sample data');
      region('r-an-tabs', [7, 30, 90].map(function (n) { return chip('an-range', String(n), n + ' days', ui.an.range === n); }).join(''));

      var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      var today = s.requests.filter(function (r) { return r.createdAt >= midnight.getTime(); });
      var open = s.requests.filter(store.isOpen);
      var overdue = open.filter(function (r) { var x = store.sla(r); return x && x.level === 'err'; }).length;
      region('r-an-live', '<span class="adm-live">Live</span><span>Today so far: <strong>' + today.length + '</strong> requests · <strong>' + open.length + '</strong> open · <strong>' + overdue + '</strong> overdue</span>' +
        '<span class="adm-hint">From the live request board — the figures below are sample data for this preview.</span>');

      var label = ['Total requests', 'SLA compliance', 'Languages used', 'Avg. response time'];
      var vals = [num(d.total), d.sla, String(d.langs), d.resp];
      region('r-an-stats', vals.map(function (v, i) {
        return '<div class="stat-tile"><div class="value">' + v + '</div><div class="label">' + label[i] + '</div><div class="adm-delta' + (i === 2 ? ' neutral' : '') + '">' + esc(d.delta[i]) + '</div></div>';
      }).join(''));

      var max = Math.max.apply(null, d.dept);
      var aria = 'Requests by department: ' + AN_DEPTS.map(function (n, i) { return n + ' ' + num(d.dept[i]); }).join(', ');
      region('r-an-charts',
        '<div class="adm-card"><div class="adm-card-head"><span class="adm-card-title">Requests by department</span><span class="adm-cell-meta">' + num(d.total) + ' total</span></div>' +
        '<div class="bar-chart" role="img" aria-label="' + esc(aria) + '">' + d.dept.map(function (v, i) {
          return '<div class="bar" data-value="' + num(v) + '" title="' + AN_DEPTS[i] + ': ' + num(v) + ' requests" style="height: ' + Math.round(v / max * 88) + '%;"></div>';
        }).join('') + '</div>' +
        '<div class="adm-axis" aria-hidden="true">' + AN_DEPTS.map(function (n) { return '<span>' + n.replace('Housekeeping', 'House&shy;keeping') + '</span>'; }).join('') + '</div></div>' +
        '<div class="adm-card"><div class="adm-card-head"><span class="adm-card-title">Requests by language</span><span class="adm-cell-meta">Share of total</span></div>' +
        d.lang.map(function (v, i) {
          var n = AN_LANGS[i] === 'Arabic' ? 'Arabic · <bdi lang="ar">العربية</bdi>' : AN_LANGS[i];
          return '<div class="adm-hbar"><span>' + n + '</span><div class="adm-hbar-track"><div class="adm-hbar-fill" style="width: ' + v + '%;"></div></div><span class="adm-num">' + v + '%</span></div>';
        }).join('') + '</div>');
    }
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function requestsCsv(s) {
    var rows = [['id', 'room', 'department', 'status', 'created', 'summary']];
    s.requests.slice().sort(function (a, b) { return a.createdAt - b.createdAt; }).forEach(function (r) {
      rows.push([r.id, r.room, store.deptLabel(r), store.statusLabel(r), stamp(r.createdAt), store.summary(r)]);
    });
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
  }
  function exportCsv() {
    var s = store.get();
    var blob = new Blob(['\ufeff' + requestsCsv(s)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'kira-requests-' + stamp(Date.now()).slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('Exported ' + s.requests.length + ' requests to CSV', 'ok');
  }

  /* =====================================================================
     Router + render loop
     ===================================================================== */

  var VIEWS = {
    'setup': SetupView, 'menu': MenuView, 'knowledge-base': KbView, 'staff': StaffView,
    'rooms': RoomsView, 'requests': RequestsView, 'analytics': AnalyticsView
  };

  function parseRoute() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    return VIEWS[h] ? h : 'requests';
  }

  function trackArrivals(s) {
    var ids = {}, arrivals = [];
    s.requests.forEach(function (r) { ids[r.id] = 1; if (knownIds && !knownIds[r.id]) arrivals.push(r); });
    knownIds = ids;
    arrivals.forEach(function (r) { markFresh('req:' + r.id); });
    if (arrivals.length === 1) {
      var r = arrivals[0];
      toast('New request · Room ' + r.room + ' · ' + store.deptLabel(r) + ': ' + truncate(store.summary(r), 48), 'ok');
    } else if (arrivals.length > 1) {
      toast(arrivals.length + ' new requests on the board', 'ok');
    }
  }

  function renderShell(s) {
    var v = VIEWS[route];
    var open = s.requests.filter(store.isOpen).length;
    var count = $('adm-nav-count');
    count.textContent = open;
    count.hidden = !open;
    count.setAttribute('aria-label', open + ' open');
    var hotel = s.hotel && s.hotel.name || 'Your hotel';
    $('adm-hotel-name').textContent = hotel;
    $('adm-hotel-initials').textContent = initials(hotel);
    $('adm-crumb-hotel').textContent = hotel;
    $('adm-crumb-page').textContent = v.title;
    region('adm-topbar-right', v.rightHtml ? v.right(s) : esc(v.right(s)));
    var links = document.querySelectorAll('.tool-sidebar .tool-link');
    for (var i = 0; i < links.length; i++) {
      var on = links[i].getAttribute('href') === '#' + route;
      links[i].classList.toggle('active', on);
      if (on) links[i].setAttribute('aria-current', 'page'); else links[i].removeAttribute('aria-current');
    }
    document.title = v.title + ' — Kira Admin';
  }

  function render() {
    var s = store.get();
    admin(s);
    if (s.seededAt !== lastSeed) {
      if (lastSeed !== null) resetTransient();
      lastSeed = s.seededAt;
      built = null;
      knownIds = null;
    }
    if (!route) route = parseRoute();
    trackArrivals(s);
    renderShell(s);
    var v = VIEWS[route];
    var sig = v.sig ? v.sig(s) : '';
    if (built !== route || sig !== builtSig) {
      $('adm-view').innerHTML = v.build(s);
      built = route;
      builtSig = sig;
    }
    v.update(s);
  }

  function onRoute() {
    var r = parseRoute();
    if (location.hash !== '#' + r) history.replaceState(null, '', '#' + r);
    if (r === route && built === route) return;
    flushSetup();
    closeDrawer(true);
    ui.staff.editId = null;
    ui.rooms.confirm = null;
    route = r;
    built = null;
    render();
    window.scrollTo(0, 0);
    revealActiveLink();
  }

  /** In the narrow-screen nav strip, keep the current section's link in view. */
  function revealActiveLink() {
    var nav = document.querySelector('.tool-sidebar'), link = document.querySelector('.tool-sidebar .tool-link.active');
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    var l = link.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft, w = link.offsetWidth;
    if (l < nav.scrollLeft || l + w > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, l - 16);
  }

  /* =====================================================================
     Actions (click), inputs, submits
     ===================================================================== */

  function val(form, name) { var el = form.querySelector('[name="' + name + '"]'); return el ? el.value : ''; }

  var ACTIONS = {
    /* ---- Setup ---- */
    'wiz-step': function (t) { goStep(Number(t.getAttribute('data-v'))); },
    'wiz-back': function () { goStep(admin(store.get()).setup.step - 1); },
    'wiz-next': function () {
      var st = admin(store.get()).setup;
      if (st.step === 1) {
        var nameEl = document.querySelector('[data-field="name"]');
        if (nameEl && !nameEl.value.trim()) {
          var input = setError($('adm-view'), 'name', 'Enter the hotel name to continue');
          if (input) input.focus();
          return;
        }
      }
      if (st.step < 4) { goStep(st.step + 1); return; }
      flushSetup();
      store.update(function (s) { admin(s).setup.complete = true; });
      toast('Departments saved — next, set routing per department', 'ok');
      location.hash = '#staff';
    },
    'wiz-stars': function (t) {
      var n = Number(t.getAttribute('data-v')), s = store.get();
      if ((s.hotel.stars || 5) === n) return;
      store.update(function (x) { x.hotel.stars = n; admin(x).setup.depts = template(n); });
      toast(STARS[n].label + ' template loaded — ' + TEMPLATE[n].length + ' departments', 'ok');
    },
    'lang-toggle': function (t) {
      var id = t.getAttribute('data-v');
      if (id === 'en') { toast('English is the base language and can’t be turned off', 'warn'); return; }
      store.update(function (s) {
        var st = admin(s).setup, i = st.langs.indexOf(id);
        if (i >= 0) st.langs.splice(i, 1); else st.langs.push(id);
      });
    },
    'dept-toggle': function (t) {
      var name = t.getAttribute('data-v');
      store.update(function (s) {
        admin(s).setup.depts.forEach(function (d) { if (d.name === name) d.on = !d.on; });
      });
    },
    'dept-add-open': function () {
      ui.setup.adding = true;
      var host = $('r-dept-form');
      if (host && !host.firstChild) host.innerHTML = deptFormHtml();
      var b = document.querySelector('[data-act="dept-add-open"]');
      if (b) b.setAttribute('aria-expanded', 'true');
      var i = host && host.querySelector('[name="f-name"]');
      if (i) i.focus();
    },
    'dept-add-cancel': function () {
      ui.setup.adding = false;
      var host = $('r-dept-form');
      if (host) host.innerHTML = '';
      var b = document.querySelector('[data-act="dept-add-open"]');
      if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
    },

    /* ---- Menu ---- */
    'menu-cat': function (t) { ui.menu.cat = t.getAttribute('data-v'); render(); },
    'menu-preview': function () {
      var w = window.open('../guest/index.html', '_blank');
      if (w) { try { w.opener = null; } catch (e) {} }
      toast(w ? 'Guest tablet opened in a new tab' : 'Allow pop-ups to open the guest tablet', w ? 'ok' : 'warn');
    },
    'menu-add': function (t) { openMenuDrawer(null, 'menu-add'); },
    'menu-edit': function (t) { openMenuDrawer(t.getAttribute('data-v'), t.getAttribute('data-key')); },
    'menu-toggle': function (t) {
      var id = t.getAttribute('data-v'), name = '', next = '';
      store.update(function (s) {
        s.menu.forEach(function (m) {
          if (m.id !== id) return;
          m.status = m.status === 'paused' ? 'available' : 'paused';
          name = m.name; next = m.status;
        });
      });
      if (name) toast(next === 'paused' ? name + ' paused — hidden from guests' : name + ' is back on guest tablets', next === 'paused' ? 'warn' : 'ok');
    },
    'menu-allergen': function (t) { t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true')); },
    'menu-status': function (t) {
      var seg = t.parentNode.querySelectorAll('[data-act="menu-status"]');
      for (var i = 0; i < seg.length; i++) { var on = seg[i] === t; seg[i].classList.toggle('active', on); seg[i].setAttribute('aria-pressed', String(on)); }
      var o = AVAIL.filter(function (x) { return x.id === t.getAttribute('data-v'); })[0];
      $('adm-avail-hint').textContent = o ? o.hint : '';
    },
    'menu-photo': function () { toast('Photo upload isn’t part of the prototype — a placeholder image is used'); },
    'drawer-close': function () { closeDrawer(); },

    /* ---- Knowledge base ---- */
    'kb-select': function (t) {
      ui.kb.sel = t.getAttribute('data-v');
      kbDetailFor = null;
      render();
    },
    'kb-add': function () {
      var id = 'kb' + Date.now(), cur = findKb(admin(store.get()).kb, ui.kb.sel);
      ui.kb.sel = id;
      kbDetailFor = null;
      if (ui.kb.q) {
        ui.kb.q = '';
        var search = document.querySelector('[data-in="kb-q"]');
        if (search) search.value = '';
      }
      store.update(function (s) {
        admin(s).kb.push({ id: id, title: 'Untitled article', cat: (cur && cur.cat) || 'Guest services', en: '', ar: '', status: 'draft', updatedAt: Date.now(), by: 'Hotel admin' });
      });
      var title = $('kb-f-title');
      if (title) { title.focus(); title.select(); }
      return true;
    },
    'kb-save': function () {
      var s = store.get(), id = kbDetailFor, a = findKb(admin(s).kb, id);
      if (!a) return;
      var d = ui.kb.drafts[id] || kbFields(a);
      if (!d.title.trim()) {
        $('kb-err-title').textContent = 'Give the article a title';
        $('kb-f-title').setAttribute('aria-invalid', 'true');
        $('kb-f-title').focus();
        return;
      }
      var wasDraft = a.status === 'draft';
      delete ui.kb.drafts[id];
      kbDetailFor = null;
      store.update(function (x) {
        var art = findKb(admin(x).kb, id);
        if (!art) return;
        art.title = d.title.trim(); art.cat = d.cat.trim() || 'General'; art.en = d.en.trim(); art.ar = d.ar.trim();
        art.status = 'published'; art.updatedAt = Date.now(); art.by = 'Hotel admin';
      });
      toast(wasDraft ? '“' + d.title.trim() + '” published — Kira can use it right away' : 'Saved — Kira’s answers are updated', 'ok');
    },
    'kb-discard': function () {
      var s = store.get(), id = kbDetailFor, a = findKb(admin(s).kb, id);
      if (!a) return;
      delete ui.kb.drafts[id];
      kbDetailFor = null;
      if (a.status === 'draft') {
        ui.kb.sel = null;
        store.update(function (x) { var kb = admin(x).kb; for (var i = kb.length - 1; i >= 0; i--) if (kb[i].id === id) kb.splice(i, 1); });
        toast('Draft deleted');
      } else {
        render();
        toast('Changes discarded');
      }
    },

    /* ---- Staff ---- */
    'staff-tab': function (t) { ui.staff.tab = t.getAttribute('data-v'); ui.staff.editId = null; render(); },
    'staff-manage': function () {
      flushSetup();
      store.update(function (s) { var st = admin(s).setup; st.step = 4; st.maxStep = Math.max(st.maxStep || 1, 4); });
      location.hash = '#setup';
    },
    'staff-add': function () { ui.staff.adding = !ui.staff.adding; renderStaffForm(); },
    'staff-add-cancel': function () { ui.staff.adding = false; renderStaffForm(); var b = document.querySelector('[data-act="staff-add"]'); if (b) b.focus(); },
    'staff-resend': function (t) {
      var id = t.getAttribute('data-v'), p = admin(store.get()).staff.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      store.update(function (s) { admin(s).staff.forEach(function (x) { if (x.id === id) x.invitedAt = Date.now(); }); });
      toast('Invite re-sent to ' + p.name, 'ok');
    },
    'staff-edit': function (t) {
      var id = t.getAttribute('data-v'), s = store.get(), p = admin(s).staff.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      if (ui.staff.editId) refreshStaffRows();
      ui.staff.editId = id;
      var row = document.querySelector('[data-act="staff-edit"][data-v="' + qAttr(id) + '"]');
      row = row && row.closest('tr');
      if (!row) return;
      row.outerHTML = staffEditRow(s, p);
      $('r-staff-rows').__html = null;
      var f = document.querySelector('.adm-edit-row select');
      if (f) f.focus();
    },
    'staff-edit-cancel': function () {
      var id = ui.staff.editId;
      ui.staff.editId = null;
      refreshStaffRows();
      var b = document.querySelector('[data-key="sedit-' + qAttr(id) + '"]');
      if (b) b.focus();
    },

    /* ---- Rooms ---- */
    'rooms-floor': function (t) { ui.rooms.floor = t.getAttribute('data-v'); ui.rooms.confirm = null; render(); },
    'rooms-import': function () { toast('Room list import (CSV or PMS sync) isn’t part of the prototype'); },
    'rooms-register': function () { ui.rooms.registering = !ui.rooms.registering; renderRoomForm(); },
    'rooms-register-cancel': function () { ui.rooms.registering = false; renderRoomForm(); var b = document.querySelector('[data-act="rooms-register"]'); if (b) b.focus(); },
    'room-bind': function (t) {
      var n = t.getAttribute('data-v');
      bindRoom(n);
      toast(tabletIdFor(n) + ' bound to room ' + n + ' — online', 'ok');
      return focusKey('room-unbind-' + n);
    },
    'room-unbind': function (t) {
      var n = t.getAttribute('data-v');
      ui.rooms.confirm = n;
      render();
      return focusKey('room-unbind-no-' + n);
    },
    'room-unbind-no': function (t) {
      var n = t.getAttribute('data-v');
      ui.rooms.confirm = null;
      render();
      return focusKey('room-unbind-' + n) || focusKey('room-ping-' + n);
    },
    'room-unbind-yes': function (t) {
      var n = t.getAttribute('data-v'), id = '';
      ui.rooms.confirm = null;
      store.update(function (s) {
        var e = findRoom(admin(s).rooms, n);
        if (!e) return;
        id = e.tabletId; e.tabletId = null; e.status = 'none'; e.lag = 0; e.seenAt = null;
        if (s.rooms[n]) s.rooms[n].tablet = 'offline';
      });
      toast((id || 'Tablet') + ' unbound from room ' + n, 'warn');
      return focusKey('room-bind-' + n);
    },
    'room-ping': function (t) {
      var n = t.getAttribute('data-v'), e = findRoom(admin(store.get()).rooms, n);
      if (!e || ui.rooms.pinging[n]) return;
      var id = e.tabletId, seed = store.get().seededAt;
      ui.rooms.pinging[n] = true;
      render();
      toast('Ping sent to ' + id + '…');
      setTimeout(function () {
        delete ui.rooms.pinging[n];
        if (store.get().seededAt !== seed) return;
        store.update(function (s) {
          var x = findRoom(admin(s).rooms, n);
          if (!x || !x.tabletId) return;
          x.status = 'online'; x.lag = 0; x.seenAt = null;
          if (s.rooms[n]) s.rooms[n].tablet = 'online';
        });
        toast(id + ' is back online', 'ok');
      }, 2000);
    },

    /* ---- Request board ---- */
    'req-tab': function (t) { ui.req.dept = t.getAttribute('data-v'); render(); },
    'sla-open': function () { ui.req.slaOpen = !ui.req.slaOpen; renderSlaPanel(); },
    'sla-cancel': function () { ui.req.slaOpen = false; renderSlaPanel(); var b = document.querySelector('[data-act="sla-open"]'); if (b) b.focus(); },

    /* ---- Analytics ---- */
    'an-range': function (t) { ui.an.range = Number(t.getAttribute('data-v')); render(); },
    'an-export': function () { exportCsv(); }
  };

  function bindRoom(n, type) {
    store.update(function (s) {
      var rooms = admin(s).rooms, e = findRoom(rooms, n);
      if (!e) {
        e = { number: n, floor: Math.floor(Number(n) / 100), type: type || 'Deluxe King', tabletId: null, status: 'none', lag: 0, seenAt: null };
        rooms.push(e);
      }
      e.tabletId = tabletIdFor(n); e.status = 'online'; e.lag = 0; e.seenAt = null;
      if (s.rooms[n]) s.rooms[n].tablet = 'online';
    });
    markFresh('room:' + n);
  }

  var SUBMITS = {
    'dept-add': function (form) {
      var name = val(form, 'f-name').trim().replace(/\s+/g, ' '), routing = val(form, 'f-routing');
      var st = admin(store.get()).setup;
      var err = !name ? 'Enter a department name' : name.length < 2 ? 'Use at least 2 characters' :
        st.depts.some(function (d) { return lower(d.name) === lower(name); }) ? name + ' is already in the list' : '';
      var input = setError(form, 'name', err);
      if (err) { if (input) input.focus(); return; }
      ui.setup.adding = false;
      $('r-dept-form').innerHTML = '';
      store.update(function (s) { admin(s).setup.depts.push({ name: name, on: true, routing: routing }); });
      toast(name + ' added — routed to ' + routing, 'ok');
      var b = document.querySelector('[data-act="dept-add-open"]');
      if (b) b.focus();
    },
    'menu-save': function (form) {
      var name = val(form, 'f-name').trim(), priceRaw = val(form, 'f-price'), price = Number(priceRaw);
      var errName = name ? '' : 'Enter the item name';
      var errPrice = priceRaw === '' || !isFinite(price) || price <= 0 ? 'Enter a price above 0' : price > 10000 ? 'That price looks too high' : '';
      var i1 = setError(form, 'name', errName), i2 = setError(form, 'price', errPrice);
      if (errName) { i1.focus(); return; }
      if (errPrice) { i2.focus(); return; }
      var tags = [];
      form.querySelectorAll('[data-act="menu-allergen"][aria-pressed="true"]').forEach(function (b) { tags.push(b.getAttribute('data-v')); });
      var extra = parseAllergens(form.getAttribute('data-extra'));
      var orig = form.getAttribute('data-orig') || '';
      var chosen = tags.map(lower).concat(extra.map(lower)).sort().join('|');
      var before = parseAllergens(orig).map(lower).sort().join('|');
      var allergens = chosen === before ? orig : formatAllergens(tags.concat(extra));
      var statusBtn = form.querySelector('[data-act="menu-status"][aria-pressed="true"]');
      var fields = {
        name: name, nameAr: val(form, 'f-ar').trim(), cat: val(form, 'f-cat'),
        allergens: allergens, price: Math.round(price * 100) / 100,
        status: statusBtn ? statusBtn.getAttribute('data-v') : 'available'
      };
      var id = drawer && drawer.id, newId = 'm' + Date.now();
      store.update(function (s) {
        if (id) s.menu.forEach(function (m) { if (m.id === id) Object.assign(m, fields); });
        else s.menu.push(Object.assign({ id: newId }, fields));
      });
      markFresh('menu:' + (id || newId));
      if (!id && ui.menu.cat !== 'all' && ui.menu.cat !== fields.cat) ui.menu.cat = 'all';
      if (!id && ui.menu.q) {
        ui.menu.q = '';
        var search = document.querySelector('[data-in="menu-q"]');
        if (search) search.value = '';
      }
      if (drawer && !id) drawer.openerKey = 'edit-' + newId;
      closeDrawer();
      render();
      toast(id ? name + ' saved — guest tablets updated' : name + ' added to the menu', 'ok');
    },
    'staff-add': function (form) {
      var name = val(form, 'f-name').trim().replace(/\s+/g, ' ');
      var err = !name ? 'Enter their name' : name.length < 2 ? 'Use at least 2 characters' : '';
      var input = setError(form, 'name', err);
      if (err) { input.focus(); return; }
      var p = { id: 's' + Date.now(), name: name, dept: val(form, 'f-dept'), role: val(form, 'f-role').trim() || 'Team member', routing: val(form, 'f-routing'), status: 'invited', onShift: false, lastSeen: '', invitedAt: Date.now() };
      ui.staff.adding = false;
      if (ui.staff.tab === 'shift') ui.staff.tab = 'all';
      markFresh('staff:' + p.id);
      renderStaffForm();
      store.update(function (s) { admin(s).staff.unshift(p); });
      toast('Invite sent to ' + name, 'ok');
      var b = document.querySelector('[data-act="staff-add"]');
      if (b) b.focus();
    },
    'staff-edit-save': function (form) {
      var id = form.getAttribute('data-v'), name = '';
      var patch = { dept: val(form, 'f-dept'), role: val(form, 'f-role').trim(), routing: val(form, 'f-routing'), status: val(form, 'f-status') };
      ui.staff.editId = null;
      $('r-staff-rows').__html = null;
      store.update(function (s) {
        admin(s).staff.forEach(function (p) {
          if (p.id !== id) return;
          Object.assign(p, patch);
          if (patch.status !== 'active') p.onShift = false;
          name = p.name;
        });
      });
      toast(name + ' updated', 'ok');
      var b = document.querySelector('[data-key="sedit-' + qAttr(id) + '"]');
      if (b) b.focus();
    },
    'room-register': function (form) {
      var n = val(form, 'f-room').trim(), type = val(form, 'f-type');
      var rooms = admin(store.get()).rooms, e = findRoom(rooms, n);
      var err = !/^\d{3,4}$/.test(n) ? 'Enter a 3- or 4-digit room number' : (e && e.tabletId) ? 'Room ' + n + ' already has ' + e.tabletId + ' — unbind it first' : '';
      var input = setError(form, 'room', err);
      if (err) { input.focus(); return; }
      ui.rooms.registering = false;
      renderRoomForm();
      var floor = Math.floor(Number(n) / 100);
      if (ui.rooms.floor !== 'all' && String(ui.rooms.floor) !== String(floor)) ui.rooms.floor = 'all';
      ui.rooms.q = '';
      var search = document.querySelector('[data-in="rooms-q"]');
      if (search) search.value = '';
      bindRoom(n, type);
      toast(tabletIdFor(n) + ' registered and bound to room ' + n, 'ok');
      var b = document.querySelector('[data-act="rooms-register"]');
      if (b) b.focus();
    },
    'sla-save': function (form) {
      var next = {}, firstBad = null;
      SLA_FIELDS.forEach(function (f) {
        var raw = val(form, 'sla-' + f[0]), v = Number(raw);
        var err = raw === '' || !isFinite(v) || v < 1 || v > 240 || Math.round(v) !== v ? 'Whole minutes, 1–240' : '';
        var input = setError(form, 'sla-' + f[0], err);
        if (err && !firstBad) firstBad = input;
        next[f[0]] = Math.round(v);
      });
      if (firstBad) { firstBad.focus(); return; }
      ui.req.slaOpen = false;
      renderSlaPanel();
      store.update(function (s) { Object.assign(s.settings.sla, next); });
      toast('SLA targets saved — new requests use them', 'ok');
      var b = document.querySelector('[data-act="sla-open"]');
      if (b) b.focus();
    }
  };

  var INPUTS = {
    'setup-field': function (el) {
      var f = el.getAttribute('data-field');
      setupPending[f] = el.value;
      if (f === 'name') setError($('adm-view'), 'name', el.value.trim() ? '' : 'Enter the hotel name');
      clearTimeout(setupTimer);
      setupTimer = setTimeout(flushSetup, 350);
    },
    'menu-q': function (el) { ui.menu.q = el.value; render(); },
    'kb-q': function (el) { ui.kb.q = el.value; region('r-kb-items', kbListHtml(admin(store.get()).kb)); },
    'kb-field': function (el) {
      var s = store.get(), id = kbDetailFor, a = findKb(admin(s).kb, id);
      if (!a) return;
      var d = ui.kb.drafts[id] || (ui.kb.drafts[id] = kbFields(a));
      var f = el.getAttribute('data-field');
      d[f] = el.value;
      if (!kbDirty(a, d)) delete ui.kb.drafts[id];
      if (f === 'title' && el.value.trim()) { $('kb-err-title').textContent = ''; el.removeAttribute('aria-invalid'); }
      refreshKbMeta(s);
      region('r-kb-items', kbListHtml(admin(s).kb));
    },
    'staff-q': function (el) { ui.staff.q = el.value; ui.staff.editId = null; render(); },
    'rooms-q': function (el) { ui.rooms.q = el.value; render(); },
    'room-preview': function (el) {
      var form = el.form, n = el.value.trim();
      form.querySelector('[name="f-id"]').value = /^\d{3,4}$/.test(n) ? tabletIdFor(n) : 'KIRA-TB-0…';
      if (n) setError(form, 'room', '');
    }
  };

  var CHANGES = {
    'staff-dept': function (el) {
      var r = el.form.querySelector('[name="f-routing"]');
      if (r) r.value = deptRouting(store.get(), el.value);
    }
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    var act = t.getAttribute('data-act'), fn = ACTIONS[act];
    if (!fn) return;
    e.preventDefault();
    var key = t.getAttribute('data-key');
    var keepFocus = fn(t, e);
    // If the clicked control was re-rendered away, put focus back on its replacement
    // (same data-key; for page-level buttons without a row value, the same action).
    if (!keepFocus && !document.body.contains(t) && (!document.activeElement || document.activeElement === document.body)) {
      var n = (key && document.querySelector('[data-key="' + qAttr(key) + '"]')) ||
        (!t.hasAttribute('data-v') && document.querySelector('[data-act="' + act + '"]'));
      if (n && !n.disabled) n.focus({ preventScroll: true });
    }
  });
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-in');
    if (k && INPUTS[k]) INPUTS[k](e.target, e);
  });
  document.addEventListener('change', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-ch');
    if (k && CHANGES[k]) CHANGES[k](e.target, e);
  });
  document.addEventListener('submit', function (e) {
    var form = e.target, k = form.getAttribute('data-submit');
    e.preventDefault();
    if (k && SUBMITS[k]) SUBMITS[k](form, e);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (drawer) { closeDrawer(); return; }
      if (ui.rooms.confirm) { ui.rooms.confirm = null; render(); return; }
    }
    if (e.key === 'Tab' && drawer) {
      var panel = document.querySelector('.adm-drawer');
      var f = panel ? panel.querySelectorAll('button:not([disabled]), input:not([readonly]), select, textarea') : [];
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('beforeunload', flushSetup);

  /* =====================================================================
     Boot
     ===================================================================== */

  K.ui.launcherPill('../index.html');
  route = parseRoute();
  if (location.hash !== '#' + route) history.replaceState(null, '', '#' + route);
  store.subscribe(function () { lastChange = Date.now(); render(); });
  K.ui.every(render);
  revealActiveLink();
})();
