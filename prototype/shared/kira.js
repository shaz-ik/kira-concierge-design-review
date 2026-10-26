/* Kira Concierge — working prototype runtime.
   One shared "hotel" lives in localStorage. Every write is broadcast to every
   other open tab or iframe (BroadcastChannel + the native storage event), so an
   order placed on the guest tablet lands on the kitchen screen the moment it's
   sent, and the kitchen's "Mark ready" moves the guest's tracker. No backend.

   Usage in an app page:
     <script src="../shared/kira.js"></script>
     Kira.store.subscribe(render);          // fires now + on every change
     Kira.store.createRequest({...});       // returns the new request
     Kira.store.setStatus(id, 'ready', { by: 'Ahmed R.', text: 'Marked ready by Ahmed R.' });
*/
(function () {
  'use strict';

  var KEY = 'kira-concierge-proto-v1';
  var MIN = 60000;

  /* ---------------- Static reference data ---------------- */

  var DEPTS = {
    dining:       { label: 'Dining',       sla: 25 },
    housekeeping: { label: 'Housekeeping', sla: 30 },
    valet:        { label: 'Valet',        sla: 10 },
    concierge:    { label: 'Concierge',    sla: 30 },
    checkout:     { label: 'Front desk',   sla: 15 },
    help:         { label: 'Front desk',   sla: 2 }
  };

  // Display label for every status, per department — every app uses these so
  // the same request reads the same everywhere.
  var STATUS = {
    dining:       { incoming: 'Incoming', preparing: 'Preparing', ready: 'Ready', out: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' },
    housekeeping: { received: 'Received', progress: 'In progress', done: 'Done', cancelled: 'Cancelled' },
    valet:        { received: 'Received', progress: 'Bringing car', done: 'Ready at entrance', cancelled: 'Cancelled' },
    concierge:    { received: 'Received', progress: 'In progress', done: 'Confirmed with guest', cancelled: 'Cancelled' },
    checkout:     { pending: 'Pending', approved: 'Approved — awaiting guest', confirmed: 'Approved', declined: 'Guest declined fee', denied: 'Denied', cancelled: 'Cancelled' },
    help:         { open: 'Open', resolved: 'Resolved' }
  };
  var CLOSED = { delivered: 1, done: 1, cancelled: 1, confirmed: 1, declined: 1, denied: 1, resolved: 1 };

  var MENU_CATS = [
    { id: 'starters', label: 'Starters' },
    { id: 'mains',    label: 'Mains' },
    { id: 'drinks',   label: 'Drinks', adminLabel: 'Beverages' },
    { id: 'desserts', label: 'Desserts' }
  ];

  var STAFF = [
    { name: 'Ahmed R.',  dept: 'dining',       role: 'Kitchen',            shift: 'Shift until 3:00 PM' },
    { name: 'Faisal K.', dept: 'dining',       role: 'Waiter',             shift: 'Shift until 3:00 PM' },
    { name: 'Yusuf T.',  dept: 'dining',       role: 'Waiter',             shift: 'Shift until 5:00 PM' },
    { name: 'Noor A.',   dept: 'housekeeping', role: 'Housekeeping',       shift: 'Shift until 4:00 PM' },
    { name: 'Omar H.',   dept: 'valet',        role: 'Valet',              shift: 'Shift until 6:00 PM' },
    { name: 'Karim B.',  dept: 'valet',        role: 'Concierge & valet',  shift: 'Shift until 6:00 PM' },
    { name: 'Fatima S.', dept: 'checkout',     role: 'Front desk',         shift: 'Shift until 3:00 PM' }
  ];

  var SERVICE_RATE = 0.15;           // service charge & VAT on dining
  var LATE_FEE = 90;                 // AED, applies to checkouts after 2:00 PM
  var LATE_FEE_AFTER_HOUR = 14;

  /* ---------------- Seed: the hotel at the start of a demo ---------------- */

  function seed() {
    var now = Date.now();
    var ago = function (m) { return now - m * MIN; };
    var h = function (m, text) { return { at: ago(m), text: text }; };

    var menu = [
      { id: 'm1',  cat: 'starters', name: 'Fattoush salad',                nameAr: 'سلطة فتوش',               allergens: 'Gluten',               price: 38, status: 'available' },
      { id: 'm2',  cat: 'starters', name: 'Hummus & warm bread',           nameAr: 'حمص مع خبز دافئ',          allergens: 'Gluten, sesame',       price: 34, status: 'available' },
      { id: 'm3',  cat: 'starters', name: 'Lentil soup',                   nameAr: 'شوربة عدس',               allergens: '',                     price: 32, status: 'soldout' },
      { id: 'm4',  cat: 'starters', name: 'Garden salad',                  nameAr: 'سلطة الحديقة',             allergens: '',                     price: 30, status: 'available' },
      { id: 'm5',  cat: 'mains',    name: 'Wagyu smash burger',            nameAr: 'برغر واغيو سماش',          allergens: 'Gluten, dairy',        price: 68, status: 'available' },
      { id: 'm6',  cat: 'mains',    name: 'Chicken shawarma plate',        nameAr: 'طبق شاورما دجاج',          allergens: 'Gluten',               price: 54, status: 'available' },
      { id: 'm7',  cat: 'mains',    name: 'Grilled hammour, saffron rice', nameAr: 'هامور مشوي مع أرز بالزعفران', allergens: 'Nuts, fish',        price: 92, status: 'available' },
      { id: 'm8',  cat: 'mains',    name: 'Arabic breakfast platter',      nameAr: 'طبق فطور عربي',            allergens: 'Gluten, dairy, egg',   price: 72, status: 'available' },
      { id: 'm9',  cat: 'drinks',   name: 'Coke',                          nameAr: 'كوكاكولا',                allergens: '',                     price: 18, status: 'available' },
      { id: 'm10', cat: 'drinks',   name: 'Fresh orange juice',            nameAr: 'عصير برتقال طازج',         allergens: '',                     price: 26, status: 'available' },
      { id: 'm11', cat: 'drinks',   name: 'Lemon mint',                    nameAr: 'ليمون بالنعناع',           allergens: '',                     price: 28, status: 'available' },
      { id: 'm12', cat: 'drinks',   name: 'Arabic coffee',                 nameAr: 'قهوة عربية',              allergens: '',                     price: 22, status: 'available' },
      { id: 'm13', cat: 'desserts', name: 'Umm Ali',                       nameAr: 'أم علي',                  allergens: 'Dairy, nuts, gluten',  price: 42, status: 'paused' },
      { id: 'm14', cat: 'desserts', name: 'Kunafa',                        nameAr: 'كنافة',                   allergens: 'Dairy, gluten, nuts',  price: 44, status: 'available' },
      { id: 'm15', cat: 'desserts', name: 'Dates platter',                 nameAr: 'طبق تمر',                 allergens: '',                     price: 30, status: 'available' }
    ];

    var rooms = {
      '412': { number: '412', floor: 4, type: 'Marina Suite',  guest: 'Mr. J. Clarke',   tier: 'Kira Privé — Gold',   checkedIn: '18 Oct', nights: 3, checkout: '11:00 AM', nextArrival: '1:00 PM', lang: 'EN', tablet: 'online',
               vehicle: { model: 'Toyota Camry', plate: 'ABC 123', bay: 'Basement B2, bay 14', keyTag: '57' } },
      '208': { number: '208', floor: 2, type: 'Deluxe King',   guest: 'Ms. L. Haddad',   tier: 'Kira Privé — Silver', checkedIn: '20 Oct', nights: 5, checkout: '11:00 AM', nextArrival: null,      lang: 'AR', tablet: 'online',
               vehicle: { model: 'Nissan Patrol', plate: 'DXB 7781', bay: 'Basement B1, bay 3', keyTag: '55' } },
      '115': { number: '115', floor: 1, type: 'Garden Twin',   guest: 'Mr. & Mrs. Rossi', tier: '—',                  checkedIn: '21 Oct', nights: 4, checkout: '11:00 AM', nextArrival: null,      lang: 'EN', tablet: 'online', vehicle: null },
      '301': { number: '301', floor: 3, type: 'Deluxe King',   guest: 'Mr. S. Al Mansoori', tier: 'Kira Privé — Platinum', checkedIn: '22 Oct', nights: 2, checkout: '11:00 AM', nextArrival: null, lang: 'AR', tablet: 'online',
               vehicle: { model: 'Range Rover Sport', plate: 'DXB 2290', bay: 'Basement B2, bay 9', keyTag: '56' } },
      '320': { number: '320', floor: 3, type: 'Family Suite',  guest: 'The Okafor family', tier: '—',                 checkedIn: '19 Oct', nights: 7, checkout: '11:00 AM', nextArrival: '3:00 PM', lang: 'EN', tablet: 'online', vehicle: null },
      '517': { number: '517', floor: 5, type: 'Marina Suite',  guest: 'Ms. A. Novak',    tier: 'Kira Privé — Gold',   checkedIn: '21 Oct', nights: 3, checkout: '1:00 PM',  nextArrival: null,      lang: 'EN', tablet: 'online', vehicle: null },
      '604': { number: '604', floor: 6, type: 'Royal Suite',   guest: 'Mr. K. Tanaka',   tier: 'Kira Privé — Platinum', checkedIn: '17 Oct', nights: 6, checkout: '3:00 PM', nextArrival: null,      lang: 'EN', tablet: 'offline', vehicle: null }
    };

    var item = function (menuId, qty, note) {
      var m = menu.filter(function (x) { return x.id === menuId; })[0];
      return { menuId: menuId, name: m.name, qty: qty, price: m.price, note: note || '', allergens: m.allergens };
    };
    var dining = function (o) {
      o.dept = 'dining';
      o.subtotal = o.items.reduce(function (s, i) { return s + i.qty * i.price; }, 0);
      o.total = round2(o.subtotal * (1 + SERVICE_RATE));
      return o;
    };

    var requests = [
      // ---- Dining
      dining({ id: '4811', ref: '#4811', room: '604', status: 'out', createdAt: ago(24), updatedAt: ago(3), slaMin: 25, channel: 'tablet',
        items: [item('m12', 2), item('m15', 1)], assignee: 'Ahmed R.', claimedBy: 'Faisal K.', guestAllergies: [], deliveryNote: '',
        history: [h(24, 'Placed by guest via in-room tablet'), h(23, 'Printed at kitchen pass'), h(18, 'Started by Ahmed R.'), h(5, 'Marked ready by Ahmed R.'), h(3, 'Claimed by Faisal K.')] }),
      dining({ id: '4815', ref: '#4815', room: '301', status: 'ready', createdAt: ago(15), updatedAt: ago(0.5), slaMin: 25, channel: 'tablet',
        items: [item('m5', 1)], assignee: 'Ahmed R.', guestAllergies: [], deliveryNote: '',
        history: [h(15, 'Placed by guest via in-room tablet'), h(15, 'Printed at kitchen pass'), h(11, 'Started by Ahmed R.'), h(0.5, 'Marked ready by Ahmed R.')] }),
      dining({ id: '4818', ref: '#4818', room: '208', status: 'incoming', createdAt: ago(13), updatedAt: ago(13), slaMin: 25, channel: 'tablet',
        items: [item('m6', 2)], guestAllergies: [], deliveryNote: '',
        history: [h(13, 'Placed by guest via in-room tablet'), h(13, 'Printed at kitchen pass')] }),
      dining({ id: '4819', ref: '#4819', room: '115', status: 'preparing', createdAt: ago(19), updatedAt: ago(8), slaMin: 25, channel: 'voice',
        items: [item('m3', 1), item('m4', 1)], assignee: 'Ahmed R.', guestAllergies: ['nuts'], deliveryNote: '',
        history: [h(19, 'Placed by guest via voice'), h(19, 'Printed at kitchen pass'), h(8, 'Started by Ahmed R.')] }),
      dining({ id: '4820', ref: '#4820', room: '517', status: 'preparing', createdAt: ago(16), updatedAt: ago(5), slaMin: 25, channel: 'tablet',
        items: [item('m8', 1), item('m10', 1)], assignee: 'Ahmed R.', guestAllergies: [], deliveryNote: '',
        history: [h(16, 'Placed by guest via in-room tablet'), h(16, 'Printed at kitchen pass'), h(5, 'Started by Ahmed R.')] }),

      // ---- Housekeeping
      { id: 'HK-187', ref: '#HK-187', dept: 'housekeeping', room: '604', status: 'done', createdAt: ago(62), updatedAt: ago(39), slaMin: 30, channel: 'tablet',
        title: 'Toiletries refill', assignee: 'Noor A.', history: [h(62, 'Requested via in-room tablet'), h(55, 'Accepted by Noor A.'), h(39, 'Marked done by Noor A.')] },
      { id: 'HK-190', ref: '#HK-190', dept: 'housekeeping', room: '115', status: 'done', createdAt: ago(41), updatedAt: ago(23), slaMin: 30, channel: 'voice',
        title: '2× Extra pillows', assignee: 'Noor A.', history: [h(41, 'Requested via voice'), h(36, 'Accepted by Noor A.'), h(23, 'Marked done by Noor A.')] },
      { id: 'HK-198', ref: '#HK-198', dept: 'housekeeping', room: '208', status: 'progress', createdAt: ago(19), updatedAt: ago(11), slaMin: 30, channel: 'tablet',
        title: 'Clean room', assignee: 'Noor A.', history: [h(19, 'Requested via in-room tablet'), h(11, 'Accepted by Noor A.')] },
      { id: 'HK-200', ref: '#HK-200', dept: 'housekeeping', room: '320', status: 'progress', createdAt: ago(16), updatedAt: ago(6), slaMin: 30, channel: 'tablet',
        title: 'Baby cot, 2× Extra hangers', assignee: 'Noor A.', history: [h(16, 'Requested via in-room tablet'), h(6, 'Accepted by Noor A.')] },
      { id: 'HK-202', ref: '#HK-202', dept: 'housekeeping', room: '517', status: 'received', createdAt: ago(12), updatedAt: ago(12), slaMin: 30, channel: 'voice',
        title: 'Iron and ironing board', history: [h(12, 'Requested via voice')] },

      // ---- Valet
      { id: 'V-55', ref: '#V-55', dept: 'valet', room: '208', status: 'done', createdAt: ago(58), updatedAt: ago(50), slaMin: 10, channel: 'tablet',
        title: 'Car to entrance', vehicle: rooms['208'].vehicle, assignee: 'Omar H.',
        history: [h(58, 'Requested via in-room tablet'), h(57, 'Accepted by Omar H.'), h(50, 'Handed over at entrance')] },
      { id: 'V-56', ref: '#V-56', dept: 'valet', room: '301', status: 'progress', createdAt: ago(12), updatedAt: ago(11), slaMin: 10, channel: 'voice',
        title: 'Car to entrance', vehicle: rooms['301'].vehicle, assignee: 'Omar H.', escalated: 'Manager notified',
        history: [h(12, 'Requested via voice'), h(11, 'Accepted by Omar H.'), h(2, 'SLA passed — duty manager notified')] },

      // ---- Concierge
      { id: 'C-31', ref: '#C-31', dept: 'concierge', room: '604', status: 'received', createdAt: ago(4), updatedAt: ago(4), slaMin: 26, channel: 'voice',
        title: 'Dinner booking', detail: 'Table for 2, tonight 8:00 PM — terrace seating preferred', history: [h(4, 'Requested via voice')] },
      { id: 'C-32', ref: '#C-32', dept: 'concierge', room: '208', status: 'received', createdAt: ago(12), updatedAt: ago(12), slaMin: 20, channel: 'tablet',
        title: 'Desert safari', detail: '4 guests, tomorrow afternoon — asked for hotel pickup', history: [h(12, 'Requested via in-room tablet')] },

      // ---- Front desk: checkout extensions
      { id: 'CO-9',  ref: '#CO-9',  dept: 'checkout', room: '517', status: 'confirmed', createdAt: ago(40), updatedAt: ago(32), slaMin: 15, channel: 'tablet',
        from: '11:00 AM', to: '1:00 PM', fee: 0, decidedBy: 'Fatima S.', decidedAt: ago(32), history: [h(40, 'Requested via in-room tablet'), h(32, 'Approved by Fatima S. — no fee')] },
      { id: 'CO-10', ref: '#CO-10', dept: 'checkout', room: '320', status: 'denied', createdAt: ago(64), updatedAt: ago(57), slaMin: 15, channel: 'voice',
        from: '11:00 AM', to: '6:00 PM', fee: LATE_FEE, reason: 'Room needed for an incoming guest at 3:00 PM.', decidedBy: 'Fatima S.', decidedAt: ago(57),
        history: [h(64, 'Requested via voice'), h(57, 'Denied by Fatima S.')] },
      { id: 'CO-11', ref: '#CO-11', dept: 'checkout', room: '604', status: 'confirmed', createdAt: ago(90), updatedAt: ago(80), slaMin: 15, channel: 'tablet',
        from: '11:00 AM', to: '3:00 PM', fee: LATE_FEE, decidedBy: 'Fatima S.', decidedAt: ago(84),
        history: [h(90, 'Requested via in-room tablet'), h(84, 'Approved by Fatima S. — AED 90.00'), h(80, 'Fee confirmed by guest')] },
      { id: 'CO-12', ref: '#CO-12', dept: 'checkout', room: '208', status: 'pending', createdAt: ago(14), updatedAt: ago(14), slaMin: 15, channel: 'tablet',
        from: '11:00 AM', to: '2:00 PM', fee: 0, history: [h(14, 'Requested via in-room tablet')] }
    ];

    return {
      version: 1,
      seededAt: now,
      hotel: { name: 'Grand Marina Hotel', stars: 5 },
      guestRoom: '412',
      rooms: rooms,
      menu: menu,
      requests: requests,
      counters: { dining: 4821, housekeeping: 203, valet: 57, concierge: 33, checkout: 13, help: 1 },
      settings: { autopilot: false, sla: { dining: 25, housekeeping: 30, valet: 10, concierge: 30, checkout: 15, help: 2 } },
      admin: {}   // free namespace for admin-only data (departments, KB, etc.)
    };
  }

  /* ---------------- Persistence + live sync ---------------- */

  var state = null;
  var listeners = [];
  var channel = null;
  try { channel = new BroadcastChannel(KEY); } catch (e) { /* older browsers: storage event still syncs */ }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) {
      try { var parsed = JSON.parse(raw); if (parsed && parsed.version === 1) return parsed; } catch (e) {}
    }
    var fresh = seed();
    persist(fresh);
    return fresh;
  }
  function persist(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { console.error(e); }
    }
  }
  function refreshFromDisk() { state = load(); emit(); }

  if (channel) channel.onmessage = refreshFromDisk;
  window.addEventListener('storage', function (e) { if (e.key === KEY) refreshFromDisk(); });

  state = load();

  /** Mutate the shared state. Re-reads from disk first so writes from other tabs aren't lost. */
  function update(mutator) {
    state = load();
    var result = mutator(state);
    persist(state);
    if (channel) channel.postMessage('changed');
    emit();
    return result;
  }

  /* ---------------- Request helpers ---------------- */

  function find(id) {
    for (var i = 0; i < state.requests.length; i++) if (state.requests[i].id === id) return state.requests[i];
    return null;
  }
  function findIn(s, id) {
    for (var i = 0; i < s.requests.length; i++) if (s.requests[i].id === id) return s.requests[i];
    return null;
  }

  function nextId(s, dept) {
    var n = s.counters[dept]++;
    var prefix = { dining: '', housekeeping: 'HK-', valet: 'V-', concierge: 'C-', checkout: 'CO-', help: 'H-' }[dept];
    return prefix + n;
  }

  /**
   * Create a request. Required: dept, room. Everything else is department-specific
   * (dining: items[], deliveryNote; housekeeping: title; valet: vehicle; checkout: from, to, fee; help: kind).
   * Returns the stored request.
   */
  function createRequest(fields) {
    return update(function (s) {
      var id = nextId(s, fields.dept);
      var now = Date.now();
      var firstStatus = { dining: 'incoming', housekeeping: 'received', valet: 'received', concierge: 'received', checkout: 'pending', help: 'open' }[fields.dept];
      var r = Object.assign({
        id: id, ref: '#' + id, status: firstStatus, createdAt: now, updatedAt: now,
        slaMin: s.settings.sla[fields.dept], channel: 'tablet', history: []
      }, fields);
      if (r.dept === 'dining') {
        r.subtotal = r.items.reduce(function (sum, i) { return sum + i.qty * i.price; }, 0);
        r.total = round2(r.subtotal * (1 + SERVICE_RATE));
        r.guestAllergies = r.guestAllergies || [];
      }
      var via = r.channel === 'voice' ? 'voice' : 'in-room tablet';
      r.history.push({ at: now, text: (r.dept === 'dining' ? 'Placed by guest via ' : 'Requested via ') + via });
      if (r.dept === 'dining') r.history.push({ at: now, text: 'Printed at kitchen pass' });
      s.requests.push(r);
      return r;
    });
  }

  /** Move a request to a new status. opts: { by, text, patch } — text goes into the ticket history. */
  function setStatus(id, status, opts) {
    opts = opts || {};
    return update(function (s) {
      var r = findIn(s, id);
      if (!r) return null;
      r.status = status;
      r.updatedAt = Date.now();
      if (opts.patch) Object.assign(r, opts.patch);
      var text = opts.text || (STATUS[r.dept][status] + (opts.by ? ' — ' + opts.by : ''));
      r.history.push({ at: r.updatedAt, text: text });
      return r;
    });
  }

  /**
   * Like setStatus, but only if the request is still in `expected` status (or one of them) in the
   * latest saved state — so two staff tapping Claim/Accept at once can't both win.
   * Returns the updated request, or null when someone got there first.
   */
  function setStatusIf(id, expected, status, opts) {
    var allowed = [].concat(expected);
    var latest = load();
    var r = findIn(latest, id);
    if (!r || allowed.indexOf(r.status) < 0) { state = latest; emit(); return null; }
    return setStatus(id, status, opts);
  }

  /** Patch fields on a request without changing its status. */
  function patch(id, fields, historyText) {
    return update(function (s) {
      var r = findIn(s, id);
      if (!r) return null;
      Object.assign(r, fields);
      r.updatedAt = Date.now();
      if (historyText) r.history.push({ at: r.updatedAt, text: historyText });
      return r;
    });
  }

  function isOpen(r) { return !CLOSED[r.status]; }
  function statusLabel(r) { return (STATUS[r.dept] && STATUS[r.dept][r.status]) || r.status; }
  function deptLabel(r) { return DEPTS[r.dept] ? DEPTS[r.dept].label : r.dept; }

  /** SLA countdown for an open request: { minsLeft, label, level: 'ok'|'warn'|'err' }, or null once closed. */
  function sla(r, now) {
    if (!isOpen(r)) return null;
    if (r.dept === 'checkout' && r.status === 'approved') return null; // the ball is in the guest's court
    now = now || Date.now();
    now = now || Date.now();
    var left = (r.createdAt + r.slaMin * MIN - now) / MIN;
    if (left < 0) {
      var over = Math.max(1, Math.round(-left));
      return { minsLeft: left, label: 'Overdue ' + over + ' min', level: 'err' };
    }
    var mins = Math.max(1, Math.ceil(left));
    return { minsLeft: left, label: mins + ' min left', level: left <= 5 ? 'warn' : 'ok' };
  }

  /** One-line summary of what was asked for, for tables and cards. */
  function summary(r) {
    if (r.dept === 'dining') return r.items.map(function (i) { return i.qty + '× ' + i.name + (i.note ? ' (' + i.note.toLowerCase() + ')' : ''); }).join(', ');
    if (r.dept === 'checkout') return 'Late checkout → ' + r.to;
    if (r.dept === 'valet') return r.vehicle ? r.vehicle.model + ' — ' + r.vehicle.plate : 'Car to entrance';
    if (r.dept === 'help') return r.kind === 'emergency' ? 'Emergency — help requested' : 'Call-back requested';
    return r.title + (r.detail ? ' — ' + r.detail : '');
  }

  function lateFeeFor(time) { return hourOf(time) > LATE_FEE_AFTER_HOUR ? LATE_FEE : 0; }

  /* ---------------- Autopilot: stand-in staff for solo guest walkthroughs ---------------- */
  // When on, the guest room's open requests advance on their own every few seconds,
  // as if the kitchen / housekeeping / valet / front desk were working them.
  var AUTO_STEP_MS = 6000;
  var autopilotTimer = null;
  function autopilotTick() {
    if (!state.settings.autopilot) return;
    var now = Date.now();
    var room = state.guestRoom;
    state.requests.forEach(function (r) {
      if (r.room !== room || !isOpen(r) || now - r.updatedAt < AUTO_STEP_MS) return;
      var next = null, text = '', by = '', p = null;
      if (r.dept === 'dining') {
        if (r.status === 'incoming')  { next = 'preparing'; by = 'Ahmed R.'; text = 'Started by Ahmed R.'; p = { assignee: by }; }
        else if (r.status === 'preparing') { next = 'ready'; text = 'Marked ready by Ahmed R.'; }
        else if (r.status === 'ready') { next = 'out'; text = 'Claimed by Faisal K.'; p = { claimedBy: 'Faisal K.' }; }
        else if (r.status === 'out')   { next = 'delivered'; text = 'Delivered by Faisal K.'; }
      } else if (r.dept === 'housekeeping') {
        if (r.status === 'received') { next = 'progress'; text = 'Accepted by Noor A.'; p = { assignee: 'Noor A.' }; }
        else if (r.status === 'progress') { next = 'done'; text = 'Marked done by Noor A.'; }
      } else if (r.dept === 'valet') {
        if (r.status === 'received') { next = 'progress'; text = 'Accepted by Omar H.'; p = { assignee: 'Omar H.' }; }
        else if (r.status === 'progress') { next = 'done'; text = 'Car ready at entrance — Omar H.'; }
      } else if (r.dept === 'checkout' && r.status === 'pending') {
        next = 'approved'; text = 'Approved by Fatima S.' + (r.fee ? ' — AED ' + r.fee.toFixed(2) : ' — no fee');
        p = { decidedBy: 'Fatima S.', decidedAt: now };
        if (!r.fee) next = 'confirmed';
      }
      if (next) setStatus(r.id, next, { text: text, patch: p });
      if (next === 'confirmed') update(function (s) { s.rooms[r.room].checkout = r.to; });
    });
  }
  /** Call from exactly one page (the guest tablet) so steps aren't applied twice. */
  function runAutopilot() {
    if (autopilotTimer) return;
    autopilotTimer = setInterval(autopilotTick, 1500);
  }
  function setAutopilot(on) { update(function (s) { s.settings.autopilot = !!on; }); }

  /* ---------------- Formatting ---------------- */

  function round2(n) { return Math.round(n * 100) / 100; }
  function money(n) { return 'AED ' + Number(n).toFixed(2); }
  function moneyShort(n) { return 'AED ' + (Number(n) % 1 ? Number(n).toFixed(2) : Number(n)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /** 9:41 AM */
  function time(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    var hh = d.getHours(), ap = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    return hh + ':' + pad(d.getMinutes()) + ' ' + ap;
  }
  /** 9:41 (24h-free short form used in ticket histories) */
  function clock(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    return (d.getHours() % 12 || 12) + ':' + pad(d.getMinutes());
  }
  /** just now · 3 min ago · 2 h ago */
  function ago(ts) {
    var m = Math.floor((Date.now() - ts) / MIN);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    return Math.floor(m / 60) + ' h ago';
  }
  /** '5:00 PM' -> 17 */
  function hourOf(t) {
    var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(t).trim());
    if (!m) return NaN;
    var h = +m[1] % 12;
    if (m[3].toUpperCase() === 'PM') h += 12;
    return h + (+m[2]) / 60;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- Tiny UI helpers shared by every app ---------------- */

  var toastHost = null;
  /** Transient message, bottom-centre. kind: 'ok' | 'warn' | 'err' | undefined */
  function toast(msg, kind) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'proto-toasts';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    var t = document.createElement('div');
    t.className = 'proto-toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    toastHost.appendChild(t);
    setTimeout(function () { t.classList.add('leaving'); }, 2600);
    setTimeout(function () { t.remove(); }, 3000);
  }

  var inFrame = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();

  /** Small floating link back to the prototype launcher; hidden inside the side-by-side demo. */
  function launcherPill(href) {
    if (inFrame) { document.documentElement.classList.add('in-frame'); return; }
    var a = document.createElement('a');
    a.className = 'proto-pill';
    a.href = href || '../index.html';
    a.innerHTML = '<span aria-hidden="true">‹</span> Prototype';
    a.title = 'Back to the prototype launcher';
    document.body.appendChild(a);
  }

  /** Re-run fn every `ms` (default 15 s) — for SLA countdowns and "3 min ago" labels. */
  function every(fn, ms) { return setInterval(fn, ms || 15000); }

  window.Kira = {
    store: {
      get: function () { return state; },
      subscribe: function (fn) { listeners.push(fn); fn(state); return function () { listeners = listeners.filter(function (l) { return l !== fn; }); }; },
      update: update,
      reset: function () { state = seed(); persist(state); if (channel) channel.postMessage('changed'); emit(); },
      find: find,
      createRequest: createRequest,
      setStatus: setStatus,
      setStatusIf: setStatusIf,
      patch: patch,
      isOpen: isOpen,
      statusLabel: statusLabel,
      deptLabel: deptLabel,
      sla: sla,
      summary: summary,
      lateFeeFor: lateFeeFor,
      runAutopilot: runAutopilot,
      setAutopilot: setAutopilot
    },
    data: { DEPTS: DEPTS, STATUS: STATUS, MENU_CATS: MENU_CATS, STAFF: STAFF, SERVICE_RATE: SERVICE_RATE, LATE_FEE: LATE_FEE },
    fmt: { money: money, moneyShort: moneyShort, time: time, clock: clock, ago: ago, hourOf: hourOf, esc: esc },
    ui: { toast: toast, launcherPill: launcherPill, every: every, inFrame: inFrame }
  };
})();
