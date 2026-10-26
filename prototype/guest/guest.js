/* Kira Concierge — guest tablet (working prototype).
   Every screen of the hi-fi guest flows (dining, housekeeping, late checkout,
   valet), driven by the shared live store: requests the guest sends land on the
   staff apps, and staff actions move the guest's trackers in real time. */
(function () {
  'use strict';

  var S = Kira.store, F = Kira.fmt, esc = F.esc, ui$ = Kira.ui;
  var IMG = {
    idle: '../assets/kira-idle.jpg', listening: '../assets/kira-listening.jpg', thinking: '../assets/kira-thinking.jpg',
    speaking: '../assets/kira-speaking.jpg', wake: '../assets/kira-wake.jpg'
  };
  var CHECKOUT_TIMES = ['12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM'];
  var QUICK_TIMES = ['1:00 PM', '3:00 PM', '5:00 PM', '6:00 PM'];
  var HK_CHOICES = [
    { id: 'towels',     label: 'Extra towels',  qty: true, noun: ['extra towel', 'extra towels'], done: 'your towels have been delivered' },
    { id: 'pillows',    label: 'Extra pillows', qty: true, noun: ['extra pillow', 'extra pillows'], done: 'your pillows have been delivered' },
    { id: 'clean',      label: 'Clean room',    title: 'Clean room', ask: 'a room clean', done: 'your room has been cleaned' },
    { id: 'toiletries', label: 'Toiletries',    title: 'Toiletries refill', ask: 'a toiletries refill', done: 'your toiletries have been refilled' },
    { id: 'other',      label: 'Other…',        done: 'housekeeping has finished your request' }
  ];
  var NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, pair: 2 };
  var NUM_SAY = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

  /* ---------------- Local (per-tablet) UI state ---------------- */

  var ui = {
    view: 'home',
    cat: 'mains',
    cart: {},              // menuId -> { qty, note }
    channel: 'tablet',     // 'voice' once the order came from speech
    deliveryNote: '', showNote: false,
    token: null, sending: false, sendFailedOnce: false, menuFailedOnce: false,
    trackId: null,
    hk: { choice: 'towels', qty: 2, other: '' },
    co: { to: '5:00 PM', showAll: false },
    heard: '',             // last thing the guest "said" (shown under Kira)
    reply: '',             // Kira's spoken reply to it
    voice: { text: '', typing: '', busy: false },
    overlay: null, helpKind: null, helpId: null,
    feedback: {},
    muted: false, textScale: 0
  };
  var seededAt = S.get().seededAt;
  var ROOM = S.get().guestRoom;
  var known = {};          // request id -> last status seen (for live notices)

  var tablet = document.getElementById('tablet');
  var body = document.getElementById('body');
  var context = document.getElementById('context');
  var overlay = document.getElementById('overlay');
  var noticeHost = document.getElementById('notice');

  /* ---------------- Helpers ---------------- */

  function st() { return S.get(); }
  function room() { return st().rooms[ROOM]; }
  function menuItem(id) { return st().menu.filter(function (m) { return m.id === id; })[0]; }
  function myRequests() { return st().requests.filter(function (r) { return r.room === ROOM; }); }
  function openOf(dept) {
    return myRequests().filter(function (r) { return r.dept === dept && S.isOpen(r); }).sort(function (a, b) { return b.createdAt - a.createdAt; })[0];
  }
  function cartLines() {
    return Object.keys(ui.cart).map(function (id) {
      var m = menuItem(id);
      return m ? { menuId: id, name: m.name, qty: ui.cart[id].qty, price: m.price, note: ui.cart[id].note || '', allergens: m.allergens } : null;
    }).filter(function (l) { return l && l.qty > 0; });
  }
  function cartCount() { return cartLines().reduce(function (s, l) { return s + l.qty; }, 0); }
  function cartSubtotal() { return cartLines().reduce(function (s, l) { return s + l.qty * l.price; }, 0); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function sayNum(n) { return NUM_SAY[n] || String(n); }
  function itemsText(items) { return items.map(function (i) { return i.qty + '× ' + i.name; }).join(', '); }
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

  function stepper(labels, active, allDone) {
    var out = '<div class="g-stepper">';
    labels.forEach(function (label, i) {
      var dot = i < active || (allDone && i !== active) ? 'done' : i === active ? 'active' : '';
      if (i > 0) out += '<div class="g-line' + (i <= active ? ' done' : '') + '"></div>';
      out += '<div class="g-step"><div class="g-dot ' + dot + '"></div><div class="g-label' + (i === active ? ' active' : '') + '">' + esc(label) + '</div></div>';
    });
    return out + '</div>';
  }
  function banner(kind, text, meta) {
    return '<div class="g-banner g-banner-' + kind + '">' + esc(text) + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</div>';
  }
  function btn(label, act, opts) {
    opts = opts || {};
    return '<button class="btn ' + (opts.primary ? 'btn-brass' : 'btn-ghost-dark') + '" data-act="' + act + '"' +
      (opts.arg != null ? ' data-arg="' + esc(opts.arg) + '"' : '') + (opts.disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }
  function head(eyebrow, title) {
    return '<div class="task-head">' + (eyebrow ? '<span class="task-eyebrow">' + esc(eyebrow) + '</span>' : '') + '<p class="task-title">' + esc(title) + '</p></div>';
  }
  function minsLeft(r, promise) {
    var left = Math.ceil((r.createdAt + promise * 60000 - Date.now()) / 60000);
    return Math.max(2, left);
  }

  /* ---------------- Kira: what she shows and says ---------------- */

  var lastLine = '', speakUntil = 0, kiraKey = '', speakTimer = null;

  function speak(text) {
    if (ui.muted || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace(/[“”"]/g, '').replace(/(\d+)×\s*/g, '$1 ').replace(/AED\s*([\d.]+)/g, '$1 dirhams'));
      u.rate = 1.02; u.pitch = 1.05;
      var voices = window.speechSynthesis.getVoices();
      var pick = voices.filter(function (v) { return /en(-|_)(GB|US)/i.test(v.lang) && /female|samantha|serena|karen|moira|google uk english female|zira/i.test(v.name); })[0] ||
                 voices.filter(function (v) { return /^en/i.test(v.lang); })[0];
      if (pick) u.voice = pick;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function setKira(k) {
    var now = Date.now();
    if (k.line && k.line !== lastLine) {
      lastLine = k.line;
      if (k.mood !== 'listening') {
        speak(k.line);
        speakUntil = now + Math.min(6000, 900 + k.line.split(/\s+/).length * 330);
        clearTimeout(speakTimer);
        speakTimer = setTimeout(render, speakUntil - now + 20);
      }
    }
    var mood = k.mood === 'speaking' && now > speakUntil ? 'idle' : k.mood;
    body.className = 'tablet-body split state-' + mood;
    var key = mood + '|' + k.line + '|' + (k.caption || '') + '|' + (k.small ? 1 : 0);
    if (key === kiraKey) return;
    kiraKey = key;
    var col = document.getElementById('kira-col');
    col.innerHTML =
      '<button class="kira-tap" data-act="voice" aria-label="Talk to Kira"><div class="kira-photo-wrap' + (k.small ? ' small' : '') + '"><img src="' + IMG[mood] + '" alt="Kira"></div></button>' +
      (k.caption ? '<div class="avatar-caption">' + esc(k.caption) + '</div>' : '') +
      (k.line ? '<div class="subtitle-bar">' + esc(k.line) + '</div>' : '');
  }

  /* ---------------- Views ---------------- */
  // Each split view returns { kira: {mood, line, caption, small}, html, context }.

  var VIEWS = {};

  VIEWS['menu-loading'] = function () {
    return { context: 'In-room dining', kira: { mood: 'thinking', line: 'One moment — getting tonight’s menu…' },
      html: head('', 'In-room dining') + '<p class="task-note">Loading the menu…</p>' };
  };

  VIEWS['menu-error'] = function () {
    return { context: 'In-room dining', kira: { mood: 'thinking', line: 'I couldn’t load the menu just now — let me try again.' },
      html: head('', 'Menu unavailable') +
        banner('warn', 'The menu couldn’t be loaded.', 'This is usually brief. You can also order from the room phone.') +
        '<div class="btn-row">' + btn('Back to home', 'home') + btn('Try again', 'retry-menu', { primary: true }) + '</div>' };
  };

  VIEWS.menu = function () {
    var items = st().menu.filter(function (m) { return m.cat === ui.cat && m.status !== 'paused'; });
    var cats = Kira.data.MENU_CATS.map(function (c) {
      return '<button class="quick-chip' + (c.id === ui.cat ? ' selected' : '') + '" data-act="cat" data-arg="' + c.id + '" aria-pressed="' + (c.id === ui.cat) + '">' + esc(c.label) + '</button>';
    }).join('');
    var rows = items.map(function (m) {
      var line = ui.cart[m.id], qty = line ? line.qty : 0;
      if (m.status === 'soldout') {
        return '<div class="menu-item unavailable"><div><div class="menu-item-name">' + esc(m.name) + '</div><div class="menu-item-tag">Sold out for today</div></div>' +
          '<div class="menu-item-end"><span class="menu-item-unavailable-tag">Unavailable</span></div></div>';
      }
      var ctrl = qty > 0
        ? '<span class="qty-ctrl"><button class="add-btn minus" data-act="dec" data-arg="' + m.id + '" aria-label="Remove one ' + esc(m.name) + '">−</button><span class="qty-pill" aria-label="' + qty + ' in order">' + qty + '</span><button class="add-btn" data-act="inc" data-arg="' + m.id + '" aria-label="Add another ' + esc(m.name) + '">+</button></span>'
        : '<button class="add-btn" data-act="inc" data-arg="' + m.id + '" aria-label="Add ' + esc(m.name) + '">+</button>';
      return '<div class="menu-item"><div><div class="menu-item-name">' + esc(m.name) + '</div>' +
        '<div class="menu-item-tag allergen">' + (m.allergens ? 'Contains ' + esc(m.allergens.toLowerCase()) : 'No listed allergens') + '</div>' +
        (line && line.note ? '<div class="menu-item-note">' + esc(line.note) + '</div>' : '') + '</div>' +
        '<div class="menu-item-end"><span class="menu-item-price">' + F.moneyShort(m.price) + '</span>' + ctrl + '</div></div>';
    }).join('') || '<div class="menu-item"><div class="menu-item-tag">Nothing in this section right now.</div></div>';
    var n = cartCount();
    var bar = n
      ? '<div class="cart-bar"><span>Your order · <strong>' + n + ' item' + (n > 1 ? 's' : '') + ' · ' + F.moneyShort(cartSubtotal()) + '</strong></span>' + '<button class="btn btn-brass" data-act="review">Review order</button></div>'
      : '<div class="cart-bar empty"><span>Your order is empty — tap + or just tell Kira</span><button class="btn btn-brass" disabled>Review order</button></div>';
    var kira = ui.reply
      ? { mood: 'speaking', small: true, line: ui.reply }
      : { mood: 'listening', small: true, caption: 'Listening…', line: ui.heard ? '“' + ui.heard + '”' : 'What would you like? Tap + or just tell me.' };
    return { context: 'In-room dining', kira: kira,
      html: '<div class="menu-toolbar"><div class="quick-grid">' + cats + '</div></div><div class="guest-card menu-card" data-scroll="menu">' + rows + '</div>' + bar };
  };

  VIEWS.review = function () {
    var lines = cartLines();
    if (!lines.length) { ui.view = 'menu'; return VIEWS.menu(); }
    var sub = cartSubtotal(), svc = Math.round(sub * Kira.data.SERVICE_RATE * 100) / 100, total = Math.round((sub + svc) * 100) / 100;
    var rows = lines.map(function (l) {
      return '<div class="menu-item"><div><div class="menu-item-name">' + l.qty + '× ' + esc(l.name) + '</div>' + (l.note ? '<div class="menu-item-note">' + esc(l.note) + '</div>' : '') + '</div><div class="menu-item-price">' + F.money(l.qty * l.price) + '</div></div>';
    }).join('');
    var note = ui.showNote || ui.deliveryNote
      ? '<input class="text-field" id="dnote" data-model="deliveryNote" maxlength="120" placeholder="e.g. Please knock softly" value="' + esc(ui.deliveryNote) + '" aria-label="Delivery note">'
      : '<button class="link-btn" data-act="show-note">+ Add a delivery note</button>';
    return { context: 'In-room dining · Review your order',
      kira: ui.sending ? { mood: 'thinking', line: 'Sending it to the kitchen…' } : { mood: 'speaking', line: 'That’s ' + F.money(total) + ' in total — shall I send it to the kitchen?' },
      html: '<p class="task-title">Your order</p><div class="scroll-col" data-scroll="review"><div class="guest-card">' + rows +
        '<div class="sum-row first"><span>Subtotal</span><span>' + F.money(sub) + '</span></div>' +
        '<div class="sum-row"><span>Service charge &amp; VAT</span><span>' + F.money(svc) + '</span></div>' +
        '<div class="order-total-row"><span>Total · charged to Room ' + ROOM + '</span><span>' + F.money(total) + '</span></div></div>' + note + '</div>' +
        '<div class="btn-row">' + btn('Edit order', 'menu', { disabled: ui.sending }) + btn(ui.sending ? 'Sending…' : 'Confirm & send', 'send', { primary: true, disabled: ui.sending }) + '</div>' };
  };

  VIEWS['send-error'] = function () {
    var lines = cartLines(), sub = cartSubtotal(), total = Math.round(sub * (1 + Kira.data.SERVICE_RATE) * 100) / 100;
    return { context: 'In-room dining · Review your order',
      kira: ui.sending ? { mood: 'thinking', line: 'Trying again…' } : { mood: 'speaking', line: 'Sorry, that didn’t go through. Shall I try again?' },
      html: '<p class="task-title">Your order</p>' + banner('warn', 'Couldn’t send your order', 'Nothing has been charged. Retrying sends it once — never twice.') +
        '<div class="guest-card"><div class="menu-item"><div class="menu-item-name">' + esc(itemsText(lines)) + '</div></div><div class="order-total-row"><span>Total</span><span>' + F.money(total) + '</span></div></div>' +
        '<div class="btn-row">' + btn('Edit order', 'menu', { disabled: ui.sending }) + btn(ui.sending ? 'Sending…' : 'Try again', 'send', { primary: true, disabled: ui.sending }) + '</div>' };
  };

  VIEWS['dining-sent'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    return { context: 'In-room dining · Order ' + r.ref,
      kira: { mood: 'speaking', line: 'Sent to the kitchen — I’ll let you know as it’s prepared.' },
      html: head('Order ' + r.ref, 'Sent to the kitchen') + banner('good', 'Order confirmed', itemsText(r.items) + ' · ' + F.money(r.total)) +
        '<p class="task-note">You’ll see live updates here as your order moves through the kitchen.</p>' +
        '<div class="btn-row">' + btn('Back to home', 'home') + btn('Track status', 'track', { primary: true, arg: r.id }) + '</div>' };
  };

  VIEWS.dining = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var labels = ['Accepted', 'Preparing', 'Ready', 'Delivered'];
    var summary = '<p class="task-note">' + esc(itemsText(r.items)) + ' · ' + F.money(r.total) + '</p>';
    var ctx = 'In-room dining · Order ' + r.ref, eyebrow = 'Order ' + r.ref;
    var back = btn('Back to home', 'home');
    if (r.status === 'cancelled') {
      var byGuest = r.cancelledBy === 'guest';
      var why = byGuest ? 'Nothing has been charged.' : (r.history[r.history.length - 1].text.replace(/^Rejected by kitchen — /, '') + ' Nothing has been charged.');
      return { context: ctx, kira: { mood: 'speaking', line: byGuest ? 'I’ve cancelled that order — nothing has been charged.' : 'I’m sorry — the kitchen couldn’t take that order. Nothing has been charged.' },
        html: head(eyebrow, 'Order cancelled') + banner('warn', byGuest ? 'You cancelled this order' : 'The kitchen couldn’t take this order', why) +
          '<div class="btn-row">' + back + btn('Order something else', 'menu', { primary: true }) + '</div>' };
    }
    if (r.status === 'delivered') {
      var fb = ui.feedback[r.id];
      return { context: ctx, kira: { mood: 'wake', line: fb ? (fb === 'good' ? 'Wonderful — thank you!' : 'I’m sorry about that — I’ve let the restaurant manager know.') : 'Enjoy your meal — let me know if you’d like anything else.' },
        html: head(eyebrow, 'Delivered') + '<div class="guest-card">' + stepper(labels, 3, true) + '</div>' +
          (fb ? '<p class="task-note">Thanks for the feedback.</p>' :
            '<p class="task-note">How was it?</p><div class="quick-grid"><button class="quick-chip" data-act="feedback" data-arg="good">🙂 Good</button><button class="quick-chip" data-act="feedback" data-arg="bad">🙁 Not great</button></div>') +
          '<div class="btn-row">' + back + '</div>' };
    }
    var map = {
      incoming:  { i: 0, title: 'Order accepted',      line: 'The kitchen has your order — I’ll tell you when they start on it.', eta: 'Ready in about ' + minsLeft(r, 20) + ' minutes' },
      preparing: { i: 1, title: 'Being prepared',      line: 'Your order is being prepared now.',                 eta: 'Ready in about ' + minsLeft(r, 20) + ' minutes' },
      ready:     { i: 2, title: 'Ready',               line: 'Your order is ready — it’ll be with you in a few minutes.', eta: 'A waiter is collecting it now' },
      out:       { i: 2, title: 'On its way to you',   line: 'Your order is on its way up now.',                  eta: 'Arriving in a few minutes' }
    }[r.status];
    return { context: ctx, kira: { mood: 'speaking', line: map.line },
      html: head(eyebrow, map.title) + summary + '<div class="guest-card">' + stepper(labels, map.i) + '</div>' +
        '<p class="avatar-sub">' + esc(map.eta) + '</p>' +
        '<div class="btn-row">' + btn('Cancel order', 'cancel-order', { arg: r.id, disabled: r.status !== 'incoming' }) + back + '</div>' };
  };

  function hkChoice() { return HK_CHOICES.filter(function (c) { return c.id === ui.hk.choice; })[0]; }
  function hkTitle() {
    var c = hkChoice();
    if (c.qty) return ui.hk.qty + '× ' + cap(c.noun[1]);
    if (c.id === 'other') return ui.hk.other.trim();
    return c.title;
  }
  function hkAsk() {
    var c = hkChoice();
    if (c.qty) return sayNum(ui.hk.qty) + ' ' + c.noun[ui.hk.qty > 1 ? 1 : 0];
    if (c.id === 'other') return ui.hk.other.trim() || 'that';
    return c.ask;
  }

  VIEWS.hk = function () {
    var c = hkChoice();
    var chips = HK_CHOICES.map(function (x) {
      return '<button class="quick-chip' + (x.id === c.id ? ' selected' : '') + '" data-act="hk-choice" data-arg="' + x.id + '" aria-pressed="' + (x.id === c.id) + '">' + esc(x.label) + '</button>';
    }).join('');
    var ask;
    if (c.qty) {
      ask = '<div class="g-field-row hk-qty"><span class="label">You asked for</span><span class="qty-ctrl"><button class="add-btn minus" data-act="hk-dec" aria-label="Fewer">−</button><span class="qty-pill">' + ui.hk.qty + '</span><button class="add-btn" data-act="hk-inc" aria-label="More">+</button><span class="value">' + esc(c.noun[ui.hk.qty > 1 ? 1 : 0]) + '</span></span></div>';
    } else if (c.id === 'other') {
      ask = '<div class="g-field-row"><input class="text-field" id="hk-other" data-model="hk.other" maxlength="80" placeholder="Tell us what you need" value="' + esc(ui.hk.other) + '" aria-label="What do you need?"></div>';
    } else {
      ask = '<div class="g-field-row"><span class="label">You asked for</span><span class="value">' + esc(c.title) + '</span></div>';
    }
    var ready = c.id !== 'other' || ui.hk.other.trim();
    return { context: 'Housekeeping',
      kira: { mood: 'speaking', line: ready ? cap(hkAsk()) + ' — shall I send that to housekeeping?' : 'What can housekeeping bring you?' },
      html: head('', 'What can we bring you?') + '<div class="quick-grid">' + chips + '</div>' +
        '<div class="guest-card">' + ask + '<div class="g-field-row"><span class="label">Delivered to</span><span class="value">Room ' + ROOM + '</span></div></div>' +
        '<div class="btn-row">' + btn('Confirm request', 'hk-send', { primary: true, disabled: !ready }) + '</div>' };
  };

  VIEWS['hk-track'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var labels = ['Received', 'In progress', 'Done'], ctx = 'Housekeeping · Request ' + r.ref, eyebrow = 'Request ' + r.ref;
    var choice = HK_CHOICES.filter(function (c) { return c.id === r.kind; })[0] || HK_CHOICES[4];
    if (r.status === 'done') {
      return { context: ctx, kira: { mood: 'wake', line: 'All done — ' + choice.done + '.' },
        html: head(eyebrow, 'All done') + '<div class="guest-card">' + stepper(labels, 2, true) + '</div>' + banner('good', 'Delivered', r.title + ' · Room ' + ROOM) +
          '<div class="btn-row">' + btn('Another request', 'hk') + btn('Back to home', 'home', { primary: true }) + '</div>' };
    }
    if (r.status === 'cancelled') {
      return { context: ctx, kira: { mood: 'speaking', line: 'Housekeeping couldn’t complete that one — I’m sorry.' },
        html: head(eyebrow, 'Request closed') + banner('warn', 'This request was closed', r.title) + '<div class="btn-row">' + btn('Another request', 'hk') + btn('Back to home', 'home', { primary: true }) + '</div>' };
    }
    if (r.status === 'received') {
      return { context: ctx, kira: { mood: 'idle', line: 'Got it — housekeeping will have this with you within 20 minutes.' },
        html: head(eyebrow, 'Request received') + '<div class="guest-card">' + stepper(labels, 0) + '</div>' +
          '<p class="avatar-sub">' + esc(r.title) + ' · expected within 20 minutes</p><div class="btn-row">' + btn('Back to home', 'home') + '</div>' };
    }
    var m = minsLeft(r, 20);
    return { context: ctx, kira: { mood: 'speaking', line: 'Housekeeping is on it — about ' + m + ' minutes.' },
      html: head(eyebrow, r.title) + '<div class="guest-card">' + stepper(labels, 1) + '</div>' +
        '<p class="avatar-sub">Expected within ' + m + ' minutes</p><div class="btn-row">' + btn('Another request', 'hk') + btn('Back to home', 'home') + '</div>' };
  };

  VIEWS.checkout = function () {
    var cur = room().checkout, to = ui.co.to;
    var chips = QUICK_TIMES.filter(function (t) { return F.hourOf(t) > F.hourOf(cur); }).map(function (t) {
      return '<button class="quick-chip' + (t === to ? ' selected' : '') + '" data-act="co-time" data-arg="' + t + '" aria-pressed="' + (t === to) + '">' + t + '</button>';
    }).join('');
    var all = ui.co.showAll ? '<div class="time-list">' + CHECKOUT_TIMES.filter(function (t) { return F.hourOf(t) > F.hourOf(cur); }).map(function (t) {
      return '<button class="quick-chip' + (t === to ? ' selected' : '') + '" data-act="co-time" data-arg="' + t + '">' + t + '</button>';
    }).join('') + '</div>' : '';
    var valid = F.hourOf(to) > F.hourOf(cur);
    return { context: 'Extend checkout',
      kira: { mood: 'speaking', line: valid ? 'Shall I ask the front desk for a ' + to + ' checkout?' : 'What time would you like to check out?' },
      html: '<p class="task-title">Extend checkout</p><div class="guest-card"><div class="g-field-row"><span class="label">Current checkout</span><span class="value">' + esc(cur) + '</span></div>' +
        '<div class="g-field-row"><span class="label">Requested</span><button class="g-select-chip" data-act="co-all" aria-expanded="' + ui.co.showAll + '">' + (valid ? to : 'Choose') + ' ▾</button></div></div>' +
        (ui.co.showAll ? all : '<div class="quick-grid">' + chips + '</div>') +
        '<p class="task-note">A late checkout fee may apply — you’ll see it and confirm before anything is charged.</p>' +
        '<div class="btn-row">' + btn('Request extension', 'co-send', { primary: true, disabled: !valid }) + '</div>' };
  };

  VIEWS['checkout-track'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var ctx = 'Extend checkout';
    if (r.status === 'pending') {
      return { context: ctx, kira: { mood: 'idle', line: 'I’ve sent that to the front desk.' },
        html: head('Request sent', 'Waiting for the front desk') + banner('pending', 'Waiting for front desk approval', 'Requested: checkout at ' + r.to + ' (currently ' + r.from + ')') +
          '<p class="task-note">You’ll be notified here as soon as they reply — feel free to carry on.</p>' +
          '<div class="btn-row">' + btn('Cancel request', 'co-cancel', { arg: r.id }) + btn('Back to home', 'home') + '</div>' };
    }
    if (r.status === 'approved') {
      return { context: ctx, kira: { mood: 'speaking', line: 'Approved — there’s a late checkout fee of AED ' + r.fee + '. Shall I confirm?' },
        html: banner('good', 'Approved — new checkout: ' + r.to) +
          '<div class="guest-card"><div class="g-field-row"><span class="label">Late checkout fee</span><span class="value">' + F.money(r.fee) + '</span></div><div class="g-field-row"><span class="label">Charged to</span><span class="value">Room ' + ROOM + '</span></div></div>' +
          '<p class="task-note">Declining keeps your original ' + esc(r.from) + ' checkout.</p>' +
          '<div class="btn-row">' + btn('Decline', 'co-decline', { arg: r.id }) + btn('Confirm charge', 'co-confirm', { primary: true, arg: r.id }) + '</div>' };
    }
    if (r.status === 'confirmed' && r.fee) {
      return { context: ctx, kira: { mood: 'wake', line: 'All set — enjoy the extra time.' },
        html: head('', 'Checkout extended') + banner('good', 'New checkout: ' + r.to, F.money(r.fee) + ' charged to Room ' + ROOM) + '<div class="btn-row">' + btn('Back to home', 'home', { primary: true }) + '</div>' };
    }
    if (r.status === 'confirmed') {
      return { context: ctx, kira: { mood: 'wake', line: 'Approved — your checkout is now ' + r.to + ', no charge.' },
        html: head('Request approved', 'Checkout extended') + banner('good', 'Approved — new checkout: ' + r.to, 'No fee — within standard policy') +
          '<p class="task-note">Nothing further to confirm — you’re all set.</p><div class="btn-row">' + btn('Back to home', 'home', { primary: true }) + '</div>' };
    }
    if (r.status === 'denied') {
      return { context: ctx, kira: { mood: 'speaking', line: 'Sorry, the front desk couldn’t approve that one.' },
        html: banner('warn', 'Not approved', (r.reason ? r.reason.replace(/\.?$/, '.') + ' ' : '') + 'Your checkout stays at ' + r.from + '.') +
          '<p class="task-note">You can request a later checkout on another day, or ask about a day-use room.</p>' +
          '<div class="btn-row">' + btn('Day-use options', 'day-use') + btn('Done', 'home', { primary: true }) + '</div>' };
    }
    if (r.status === 'declined') {
      return { context: ctx, kira: { mood: 'speaking', line: 'No problem — your checkout stays at ' + r.from + '.' },
        html: head('', 'Checkout unchanged') + banner('pending', 'You kept your ' + r.from + ' checkout', 'Nothing has been charged.') + '<div class="btn-row">' + btn('Back to home', 'home', { primary: true }) + '</div>' };
    }
    return { context: ctx, kira: { mood: 'speaking', line: 'I’ve withdrawn that request.' },
      html: head('', 'Request cancelled') + banner('pending', 'Your checkout stays at ' + r.from) + '<div class="btn-row">' + btn('Back to home', 'home', { primary: true }) + '</div>' };
  };

  VIEWS.valet = function () {
    var v = room().vehicle;
    var rows = v
      ? '<div class="g-field-row"><span class="label">Your vehicle</span><span class="value">' + esc(v.model) + '</span></div><div class="g-field-row"><span class="label">Plate</span><span class="value">' + esc(v.plate) + '</span></div>'
      : '';
    return { context: 'Valet', kira: { mood: 'speaking', line: 'Shall I call for your car now?' },
      html: head('', 'Bring my car') + '<div class="guest-card">' + rows + '<div class="g-field-row"><span class="label">Pick-up</span><span class="value">Main entrance</span></div></div>' +
        (v ? '' : '<p class="task-note">We don’t have your vehicle on file — the valet team will confirm the details with you at the entrance.</p>') +
        '<div class="btn-row">' + btn('Bring my car', 'valet-send', { primary: true }) + '</div>' };
  };

  VIEWS['valet-track'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var labels = ['Received', 'Bringing car', 'Ready at entrance'], ctx = 'Valet · Request ' + r.ref, eyebrow = 'Valet ' + r.ref;
    var car = r.vehicle ? r.vehicle.model + ' · ' + r.vehicle.plate : 'Your car';
    if (r.status === 'done') {
      return { context: ctx, kira: { mood: 'wake', line: 'Your car is ready at the main entrance.' },
        html: banner('good', 'Your car is ready', car + ' — waiting at the main entrance') + '<div class="guest-card">' + stepper(labels, 2, true) + '</div>' +
          '<div class="btn-row">' + btn('Done', 'home', { primary: true }) + '</div>' };
    }
    if (r.status === 'cancelled') {
      return { context: ctx, kira: { mood: 'speaking', line: 'That valet request was closed — please call the front desk if you still need your car.' },
        html: head(eyebrow, 'Request closed') + '<div class="btn-row">' + btn('Back to home', 'home', { primary: true }) + '</div>' };
    }
    var received = r.status === 'received';
    return { context: ctx, kira: { mood: received ? 'idle' : 'speaking', line: received ? 'I’ve let the valet team know.' : 'Your car is being brought around now.' },
      html: head(eyebrow, received ? 'Calling the valet' : 'Bringing your car') + '<div class="guest-card">' + stepper(labels, received ? 0 : 1) + '</div>' +
        '<p class="avatar-sub">' + esc(car) + '</p><p class="task-note">We’ll let you know here the moment it’s at the main entrance.</p>' +
        '<div class="btn-row">' + btn('Back to home', 'home') + '</div>' };
  };

  var PHRASES = ['Two burgers and a Coke, please — no onion', 'Can I get two extra towels?', 'I’d like a late checkout at 5', 'Bring my car around', 'What time does the pool close?'];
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognizing = false;

  VIEWS.voice = function () {
    var v = ui.voice;
    var kira = v.busy === 'thinking' ? { mood: 'thinking', line: '“' + v.typing + '”', caption: 'Thinking…' }
      : v.typing ? { mood: 'listening', line: '“' + v.typing + '”', caption: 'Listening…' }
      : ui.reply ? { mood: 'speaking', line: ui.reply }
      : { mood: 'listening', line: 'I’m listening — what can I do for you?', caption: 'Listening…' };
    var examples = PHRASES.map(function (p) { return '<button class="quick-chip" data-act="say" data-arg="' + esc(p) + '"' + (v.busy ? ' disabled' : '') + '>“' + esc(p) + '”</button>'; }).join('');
    return { context: 'Talk to Kira', kira: kira,
      html: '<div class="voice-panel">' + head('Voice', 'Just ask') +
        '<p class="task-note">On the real tablet you simply speak. Here, tap a phrase' + (Recognition ? ', use the microphone,' : '') + ' or type what you’d say.</p>' +
        '<div class="voice-examples">' + examples + '</div>' +
        '<form class="voice-row" data-form="voice"><input class="text-field" id="voice-text" data-model="voice.text" placeholder="Type to Kira…" value="' + esc(v.text) + '" aria-label="Say something to Kira" autocomplete="off"' + (v.busy ? ' disabled' : '') + '>' +
        '<button class="btn btn-brass" type="submit"' + (v.busy ? ' disabled' : '') + '>Send</button></form>' +
        '<div class="btn-row">' + (Recognition ? '<button class="btn btn-ghost-dark mic-btn' + (recognizing ? ' live' : '') + '" data-act="mic">' + (recognizing ? '● Listening… tap to stop' : '🎙 Use microphone') + '</button>' : '') + btn('Back to home', 'home') + '</div></div>' };
  };

  /* ---------------- Home (centred, not split) ---------------- */

  function renderHome() {
    if (body.dataset.layout !== 'home') {
      body.dataset.layout = 'home';
      body.className = 'tablet-body state-idle';
      kiraKey = ''; lastLine = '';
      body.innerHTML =
        '<button class="kira-tap" data-act="voice" aria-label="Talk to Kira"><div class="kira-photo-wrap"><img src="' + IMG.idle + '" alt="Kira"></div></button>' +
        '<p class="home-greeting">' + greeting() + '</p><p class="avatar-sub">Say “Hey Kira”, or tap to begin</p>' +
        '<div class="quick-grid home-chips">' +
        '<button class="quick-chip" data-act="menu">In-room dining</button><button class="quick-chip" data-act="hk">Housekeeping</button>' +
        '<button class="quick-chip" data-act="checkout">Late checkout</button><button class="quick-chip" data-act="valet">Valet</button></div>' +
        '<div class="home-active" id="home-active"></div>';
    }
    var open = myRequests().filter(function (r) { return S.isOpen(r) && r.dept !== 'help'; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    document.getElementById('home-active').innerHTML = open.map(function (r) {
      var what = { dining: 'Order ', housekeeping: 'Housekeeping ', valet: 'Valet ', checkout: 'Late checkout ' }[r.dept] || '';
      var label = r.dept === 'checkout' ? (r.status === 'approved' ? 'approved — confirm fee' : 'waiting for front desk') : S.statusLabel(r).toLowerCase();
      return '<button class="track-chip" data-act="track" data-arg="' + r.id + '"><span class="dot"></span>' + what + r.ref + ' · ' + esc(label) + ' — Track</button>';
    }).join('');
  }

  /* ---------------- Render ---------------- */

  function render() {
    // Keep focus, caret and scroll positions across re-renders.
    var active = document.activeElement, focusId = active && active.id, selStart = null;
    try { selStart = active && active.selectionStart; } catch (e) {}
    var scrolls = {};
    body.querySelectorAll('[data-scroll]').forEach(function (el) { scrolls[el.dataset.scroll] = el.scrollTop; });

    if (ui.view === 'home') {
      renderHome();
      context.innerHTML = esc(F.time()) + ' · 24°C, clear';
    } else {
      var v = VIEWS[ui.view]();
      if (body.dataset.layout !== 'split') {
        body.dataset.layout = 'split';
        body.innerHTML = '<div class="kira-col" id="kira-col"></div><div class="task-col" id="task-col"></div>';
        kiraKey = '';
      }
      context.innerHTML = '<button class="crumb" data-act="home">‹ Home</button><span aria-hidden="true">·</span><span>' + esc(v.context) + '</span>';
      setKira(v.kira);
      document.getElementById('task-col').innerHTML = v.html;
    }

    body.querySelectorAll('[data-scroll]').forEach(function (el) { if (scrolls[el.dataset.scroll]) el.scrollTop = scrolls[el.dataset.scroll]; });
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el && el !== document.activeElement) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch (e) {} }
    }
    renderOverlay();
    renderNav();
  }

  function renderNav() {
    var mute = document.getElementById('mute-btn');
    mute.setAttribute('aria-pressed', String(ui.muted));
    mute.classList.toggle('muted', ui.muted);
    mute.setAttribute('aria-label', ui.muted ? 'Unmute Kira' : 'Mute Kira');
    mute.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6H5l3.5-3v10L5 10H2.5Z"/>' +
      (ui.muted ? '<path d="m11 6 4 4M15 6l-4 4"/>' : '<path d="M11 5.5a3.5 3.5 0 0 1 0 5"/>') + '</svg> ' + (ui.muted ? 'Unmute' : 'Mute');
    document.getElementById('room-chip').textContent = 'Room ' + ROOM;
  }

  function renderOverlay() {
    if (!ui.overlay) { overlay.innerHTML = ''; return; }
    var h = '';
    if (ui.overlay === 'help') {
      h = '<p class="task-title">How can we help?</p><p class="task-note">The front desk is staffed around the clock.</p>' +
        '<button class="btn btn-ghost-dark" data-act="help-call">Call me back — front desk</button>' +
        '<button class="btn btn-danger" data-act="help-emergency">Emergency — alert security now</button>' +
        '<button class="link-btn" data-act="overlay-close">Close</button>';
    } else if (ui.overlay === 'help-confirm') {
      h = '<p class="task-title">Alert security and the duty manager?</p><p class="task-note">Someone will come to Room ' + ROOM + ' immediately.</p>' +
        '<div class="btn-row">' + btn('Cancel', 'overlay-close') + '<button class="btn btn-danger" data-act="help-send" data-arg="emergency">Yes, alert them</button></div>';
    } else if (ui.overlay === 'help-sent') {
      var r = S.find(ui.helpId), resolved = r && r.status === 'resolved';
      h = ui.helpKind === 'emergency'
        ? banner(resolved ? 'good' : 'warn', resolved ? 'The front desk has handled your alert' : 'Help is on the way to Room ' + ROOM, resolved ? '' : 'Security and the duty manager have been alerted. If you are in danger, dial 999.')
        : banner(resolved ? 'good' : 'pending', resolved ? 'The front desk has handled your request' : 'The front desk will call your room', resolved ? '' : 'Usually within 2 minutes.');
      h += '<button class="btn btn-brass" data-act="overlay-close">Close</button>';
    } else if (ui.overlay === 'lang') {
      var langs = [['English', 'EN', true], ['العربية', 'AR'], ['Русский', 'RU'], ['中文', 'ZH'], ['Français', 'FR'], ['Deutsch', 'DE']];
      h = '<p class="task-title">Language</p><p class="task-note">Kira understands guests in any of these by voice. The on-screen translation isn’t part of this prototype yet.</p><div class="lang-list">' +
        langs.map(function (l) { return '<button class="quick-chip' + (l[2] ? ' selected' : '') + '"' + (l[2] ? ' data-act="overlay-close"' : ' disabled') + '><span>' + l[0] + '</span><span>' + (l[2] ? '✓' : 'Soon') + '</span></button>'; }).join('') +
        '</div><button class="link-btn" data-act="overlay-close">Close</button>';
    } else if (ui.overlay === 'day-use') {
      h = '<p class="task-title">Day-use options</p><div class="guest-card"><div class="g-field-row"><span class="label">Day-use room until 6:00 PM</span><span class="value">AED 250</span></div><div class="g-field-row"><span class="label">Spa &amp; pool day pass</span><span class="value">AED 120</span></div><div class="g-field-row"><span class="label">Luggage held at the bell desk</span><span class="value">Free</span></div></div>' +
        '<p class="task-note">Ask the front desk to book any of these.</p><button class="btn btn-brass" data-act="overlay-close">Close</button>';
    }
    overlay.innerHTML = '<div class="sheet-scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">' + h + '</div></div>';
  }

  /* ---------------- Live notices (a request moved while the guest was elsewhere) ---------------- */

  var NOTICE = {
    dining: { preparing: 'Your order is being prepared', ready: 'Your order is ready', out: 'Your order is on its way up', delivered: 'Your order has arrived', cancelled: 'The kitchen couldn’t take your order' },
    housekeeping: { progress: 'Housekeeping is on it', done: 'Housekeeping request done', cancelled: 'Housekeeping closed your request' },
    valet: { progress: 'The valet is bringing your car', done: 'Your car is ready at the main entrance' },
    checkout: { approved: 'Late checkout approved — please confirm the fee', confirmed: 'Late checkout approved', denied: 'Late checkout not approved' },
    help: { resolved: 'The front desk has handled your help request' }
  };
  var TRACK_VIEW = { dining: 'dining', housekeeping: 'hk-track', valet: 'valet-track', checkout: 'checkout-track' };
  var noticeTimer = null;

  function watchChanges() {
    myRequests().forEach(function (r) {
      var prev = known[r.id];
      known[r.id] = r.status;
      if (!prev || prev === r.status) return;
      if (r.dept === 'checkout' && r.status === 'confirmed' && prev === 'approved') return; // guest's own confirm
      if (r.status === 'cancelled' && r.cancelledBy === 'guest') return;
      var text = NOTICE[r.dept] && NOTICE[r.dept][r.status];
      if (!text) return;
      var viewing = ui.trackId === r.id && ui.view === TRACK_VIEW[r.dept];
      if (viewing) return; // the screen itself updates and Kira says it
      if (r.dept === 'help' && ui.overlay === 'help-sent') return;
      showNotice(r, text);
    });
  }
  function showNotice(r, text) {
    clearTimeout(noticeTimer);
    var view = TRACK_VIEW[r.dept];
    noticeHost.innerHTML = '<div class="kira-notice" role="status"><img src="' + IMG.wake + '" alt=""><div class="txt"><strong>' + esc(r.ref) + '</strong>' + esc(text) + '</div>' +
      (view ? '<button class="btn btn-brass" data-act="track" data-arg="' + r.id + '">View</button>' : '') + '</div>';
    speak(text);
    noticeTimer = setTimeout(function () { noticeHost.innerHTML = ''; }, 7000);
  }

  /* ---------------- Voice: understand a sentence ---------------- */

  var DISH_WORDS = [
    [/burgers?/, 'm5'], [/shawarma/, 'm6'], [/hammour|fish/, 'm7'], [/breakfast/, 'm8'], [/fattoush/, 'm1'], [/hummus/, 'm2'],
    [/lentil|soup/, 'm3'], [/garden salad|salad/, 'm4'], [/cokes?|cola/, 'm9'], [/orange juice|orange|juice/, 'm10'], [/lemon mint|lemonade/, 'm11'],
    [/coffee/, 'm12'], [/umm ali/, 'm13'], [/kunafa|knafeh/, 'm14'], [/dates/, 'm15']
  ];
  var KB_FALLBACK = [
    [/pool/, 'The rooftop pool on level 8 is open until 10pm tonight. Towels are waiting poolside.'],
    [/wi-?fi|internet|password/, 'The Wi-Fi network is “GrandMarina-Guest” — no password needed, just accept the terms.'],
    [/gym|fitness/, 'The gym on level 2 is open 24 hours with your room key.'],
    [/spa|massage/, 'The spa is open 10am to 10pm. I can ask the concierge to book a treatment for you.'],
    [/breakfast/, 'Breakfast is served at Marina Kitchen from 6:30 to 10:30am — or I can bring it to your room.']
  ];

  function kbAnswer(t) {
    var kb = st().admin && st().admin.kb;
    if (Array.isArray(kb)) {
      for (var i = 0; i < kb.length; i++) {
        var a = kb[i], title = String(a.title || '').toLowerCase();
        var words = title.split(/[^a-z]+/).filter(function (w) { return w.length > 2 && ['and', 'the', 'info', 'hours', 'policies'].indexOf(w) < 0; });
        if (words.some(function (w) { return t.indexOf(w.replace(/s$/, '')) >= 0; })) {
          var body = a.en || a.contentEn || a.content || a.body || '';
          if (body) return String(body);
        }
      }
    }
    for (var j = 0; j < KB_FALLBACK.length; j++) if (KB_FALLBACK[j][0].test(t)) return KB_FALLBACK[j][1];
    return null;
  }

  function qtyBefore(words, idx) {
    for (var k = idx - 1; k >= Math.max(0, idx - 3); k--) {
      var w = words[k];
      if (/^\d+$/.test(w)) return +w;
      if (NUM_WORDS[w]) return NUM_WORDS[w];
    }
    return 1;
  }

  function understand(text) {
    var t = ' ' + text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9: -]/g, ' ').replace(/\s+/g, ' ') + ' ';
    if (/emergency|help me|doctor|ambulance/.test(t)) return { type: 'help' };
    // Dining
    var found = [];
    DISH_WORDS.forEach(function (d) {
      var m = d[0].exec(t);
      if (m && !found.some(function (f) { return f.id === d[1]; })) {
        var words = t.slice(0, m.index).trim().split(' ');
        found.push({ id: d[1], qty: qtyBefore(words, words.length), at: m.index });
      }
    });
    if (found.length && !/towel|pillow|checkout|check out/.test(t)) {
      var note = /no onions?/.test(t) ? 'No onion' : '';
      return { type: 'dining', items: found, note: note };
    }
    if (/towel|pillow|clean|tidy|make up|toiletr|shampoo|soap/.test(t)) {
      var choice = /towel/.test(t) ? 'towels' : /pillow/.test(t) ? 'pillows' : /toiletr|shampoo|soap/.test(t) ? 'toiletries' : 'clean';
      var m2 = /(\d+|a|an|one|two|three|four|five|six|couple|pair)( of)? (more |extra )?(towel|pillow)/.exec(t);
      return { type: 'hk', choice: choice, qty: m2 ? (+m2[1] || NUM_WORDS[m2[1]] || 1) : 2 };
    }
    if (/late checkout|check out|checkout|extend|stay longer|leave later/.test(t)) {
      var tm = /(?:at|until|till|to|for)? ?(\d{1,2})(?::(\d{2}))? ?(am|pm|oclock|o clock)?/.exec(t.replace(/checkout|check out/g, ''));
      var to = null;
      if (tm) {
        var h = +tm[1];
        if (tm[3] !== 'am' && h < 12) h += 12;
        if (h >= 12 && h <= 20) to = ((h % 12) || 12) + ':00 PM';
      }
      return { type: 'checkout', to: to };
    }
    if (/\bcar\b|valet|vehicle/.test(t)) return { type: 'valet' };
    var ans = kbAnswer(t);
    if (ans) return { type: 'answer', text: ans };
    if (/menu|hungry|food|eat|order|dinner|lunch/.test(t)) return { type: 'dining', items: [] };
    return { type: 'unknown' };
  }

  function act(intent, heard) {
    ui.heard = heard; ui.reply = '';
    if (intent.type === 'help') { ui.overlay = 'help'; ui.view = 'home'; return; }
    if (intent.type === 'dining') {
      var added = [], soldOut = [];
      intent.items.forEach(function (f) {
        var m = menuItem(f.id);
        if (!m || m.status === 'paused') return;
        if (m.status === 'soldout') { soldOut.push(m.name); return; }
        var line = ui.cart[f.id] || (ui.cart[f.id] = { qty: 0, note: '' });
        line.qty += f.qty;
        if (intent.note && f.id === 'm5') line.note = intent.note;
        if (!added.length) ui.cat = m.cat;
        added.push(f.qty + '× ' + m.name);
      });
      ui.channel = 'voice';
      ui.reply = added.length ? 'Added ' + added.join(' and ') + (soldOut.length ? ' — sorry, the ' + soldOut[0].toLowerCase() + ' is sold out today' : '') + '. Anything else?'
        : soldOut.length ? 'Sorry, the ' + soldOut[0].toLowerCase() + ' is sold out today. Can I get you something else?' : 'Here’s tonight’s menu — what would you like?';
      openMenu(true);
      return;
    }
    if (intent.type === 'hk') { ui.hk.choice = intent.choice; ui.hk.qty = Math.min(6, Math.max(1, intent.qty)); ui.view = 'hk'; return; }
    if (intent.type === 'checkout') {
      var open = openOf('checkout');
      if (open) { ui.trackId = open.id; ui.view = 'checkout-track'; return; }
      if (intent.to) ui.co.to = intent.to;
      ui.view = 'checkout'; return;
    }
    if (intent.type === 'valet') { var ov = openOf('valet'); if (ov) { ui.trackId = ov.id; ui.view = 'valet-track'; } else ui.view = 'valet'; return; }
    if (intent.type === 'answer') { ui.view = 'voice'; ui.reply = intent.text; return; }
    ui.view = 'voice';
    ui.reply = 'I can help with dining, housekeeping, a late checkout or your car — what would you like?';
  }

  // Simulate speech: the words appear under Kira as she listens, she thinks, then acts.
  function hear(text) {
    text = String(text || '').trim();
    if (!text || ui.voice.busy) return;
    ui.view = 'voice'; ui.reply = ''; ui.voice.text = ''; ui.voice.busy = 'listening'; ui.voice.typing = '';
    var words = text.split(/\s+/), i = 0;
    (function next() {
      if (ui.view !== 'voice') { ui.voice.busy = false; return; }
      ui.voice.typing = words.slice(0, ++i).join(' ');
      render();
      if (i < words.length) return setTimeout(next, 140);
      ui.voice.busy = 'thinking'; render();
      setTimeout(function () {
        ui.voice.busy = false; ui.voice.typing = '';
        if (ui.view !== 'voice') return;
        act(understand(text), text);
        render();
      }, 650);
    })();
  }

  var recognizer = null;
  function toggleMic() {
    if (!Recognition) return;
    if (recognizing && recognizer) { recognizer.stop(); return; }
    try {
      recognizer = new Recognition();
      recognizer.lang = 'en-GB'; recognizer.interimResults = true; recognizer.maxAlternatives = 1;
      recognizer.onresult = function (e) {
        var res = e.results[e.results.length - 1], txt = res[0].transcript;
        if (res.isFinal) { recognizing = false; hear(txt); }
        else { ui.voice.typing = txt; render(); }
      };
      recognizer.onerror = function (e) { recognizing = false; ui$.toast(e.error === 'not-allowed' ? 'Microphone access was blocked' : 'Didn’t catch that — try again', 'warn'); render(); };
      recognizer.onend = function () { recognizing = false; render(); };
      recognizer.start(); recognizing = true; render();
    } catch (e) { recognizing = false; ui$.toast('Microphone isn’t available here', 'warn'); }
  }

  /* ---------------- Actions ---------------- */

  function go(view) { ui.view = view; if (view !== 'voice') { ui.reply = ui.reply && view === 'menu' ? ui.reply : ''; } render(); }

  function openMenu(fromVoice) {
    if (!fromVoice) { ui.heard = ''; ui.reply = ''; }
    var failures = st().settings.failures;
    ui.view = 'menu-loading'; render();
    setTimeout(function () {
      if (ui.view !== 'menu-loading') return;
      if (failures && !ui.menuFailedOnce) { ui.menuFailedOnce = true; ui.view = 'menu-error'; }
      else ui.view = 'menu';
      render();
    }, fromVoice ? 350 : 700);
  }

  function sendOrder() {
    if (ui.sending) return;
    if (!ui.token) ui.token = 'ct_' + Math.random().toString(36).slice(2, 10);
    // Idempotency: a retry with the same confirmation token never creates a second order.
    var existing = myRequests().filter(function (r) { return r.confirmationToken === ui.token; })[0];
    ui.sending = true; render();
    setTimeout(function () {
      ui.sending = false;
      if (!existing && st().settings.failures && !ui.sendFailedOnce) { ui.sendFailedOnce = true; ui.view = 'send-error'; render(); return; }
      var r = existing || S.createRequest({ dept: 'dining', room: ROOM, items: cartLines(), deliveryNote: ui.deliveryNote.trim(), channel: ui.channel, confirmationToken: ui.token, guestAllergies: [] });
      known[r.id] = r.status;
      ui.cart = {}; ui.deliveryNote = ''; ui.showNote = false; ui.token = null; ui.channel = 'tablet'; ui.sendFailedOnce = false; ui.heard = ''; ui.reply = '';
      ui.trackId = r.id; ui.view = 'dining-sent';
      render();
    }, 900);
  }

  function track(id) {
    var r = S.find(id);
    if (!r || !TRACK_VIEW[r.dept]) return;
    ui.trackId = id; ui.view = TRACK_VIEW[r.dept]; noticeHost.innerHTML = '';
    render();
  }

  var HANDLERS = {
    home: function () { ui.heard = ''; ui.reply = ''; ui.overlay = null; go('home'); },
    menu: function () { if (ui.view === 'review' || ui.view === 'send-error' || ui.view === 'menu-error') { ui.view = 'menu'; render(); } else openMenu(false); },
    'retry-menu': function () { openMenu(false); },
    cat: function (a) { ui.cat = a; ui.reply = ''; render(); },
    inc: function (a) { var l = ui.cart[a] || (ui.cart[a] = { qty: 0, note: '' }); l.qty = Math.min(9, l.qty + 1); ui.reply = ''; render(); },
    dec: function (a) { var l = ui.cart[a]; if (l) { l.qty--; if (l.qty <= 0) delete ui.cart[a]; } ui.reply = ''; render(); },
    review: function () { if (!ui.token) ui.token = 'ct_' + Math.random().toString(36).slice(2, 10); go('review'); },
    'show-note': function () { ui.showNote = true; render(); var el = document.getElementById('dnote'); if (el) el.focus(); },
    send: sendOrder,
    track: track,
    'cancel-order': function (id) { S.setStatus(id, 'cancelled', { text: 'Cancelled by guest before preparation', patch: { cancelledBy: 'guest' } }); },
    feedback: function (a) { ui.feedback[ui.trackId] = a; S.patch(ui.trackId, { feedback: a }, a === 'good' ? 'Guest feedback: good' : 'Guest feedback: not great'); },
    hk: function () { ui.hk.other = ''; ui.trackId = null; go('hk'); },
    'hk-choice': function (a) { ui.hk.choice = a; render(); if (a === 'other') { var el = document.getElementById('hk-other'); if (el) el.focus(); } },
    'hk-inc': function () { ui.hk.qty = Math.min(6, ui.hk.qty + 1); render(); },
    'hk-dec': function () { ui.hk.qty = Math.max(1, ui.hk.qty - 1); render(); },
    'hk-send': function () {
      var title = hkTitle();
      if (!title) return;
      var r = S.createRequest({ dept: 'housekeeping', room: ROOM, title: title, kind: ui.hk.choice, channel: ui.heard ? 'voice' : 'tablet' });
      known[r.id] = r.status; ui.heard = ''; ui.trackId = r.id; go('hk-track');
    },
    checkout: function () {
      var open = openOf('checkout');
      if (open) { track(open.id); return; }
      var cur = F.hourOf(room().checkout);
      if (!(F.hourOf(ui.co.to) > cur)) ui.co.to = CHECKOUT_TIMES.filter(function (t) { return F.hourOf(t) > cur; })[0] || '';
      ui.co.showAll = false; go('checkout');
    },
    'co-time': function (a) { ui.co.to = a; ui.co.showAll = false; render(); },
    'co-all': function () { ui.co.showAll = !ui.co.showAll; render(); },
    'co-send': function () {
      var r = S.createRequest({ dept: 'checkout', room: ROOM, from: room().checkout, to: ui.co.to, fee: S.lateFeeFor(ui.co.to), channel: ui.heard ? 'voice' : 'tablet' });
      known[r.id] = r.status; ui.heard = ''; ui.trackId = r.id; go('checkout-track');
    },
    'co-cancel': function (id) { S.setStatus(id, 'cancelled', { text: 'Cancelled by guest', patch: { cancelledBy: 'guest' } }); },
    'co-decline': function (id) { S.setStatus(id, 'declined', { text: 'Guest declined the fee — checkout unchanged' }); },
    'co-confirm': function (id) {
      var r = S.find(id);
      S.setStatus(id, 'confirmed', { text: 'Fee confirmed by guest — ' + F.money(r.fee) + ' charged to room' });
      S.update(function (s) { s.rooms[r.room].checkout = r.to; });
    },
    'day-use': function () { ui.overlay = 'day-use'; render(); },
    valet: function () { var ov = openOf('valet'); if (ov) track(ov.id); else go('valet'); },
    'valet-send': function () {
      var r = S.createRequest({ dept: 'valet', room: ROOM, vehicle: room().vehicle, title: 'Car to entrance', channel: ui.heard ? 'voice' : 'tablet' });
      known[r.id] = r.status; ui.heard = ''; ui.trackId = r.id; go('valet-track');
    },
    voice: function () { if (ui.view !== 'voice') { ui.reply = ''; ui.voice.text = ''; go('voice'); setTimeout(function () { var el = document.getElementById('voice-text'); if (el && !('ontouchstart' in window)) el.focus(); }, 50); } },
    say: function (a) { hear(a); },
    mic: toggleMic,
    'overlay-close': function () { ui.overlay = null; render(); },
    scrim: function () { if (ui.overlay !== 'help-confirm') { ui.overlay = null; render(); } },
    'help-call': function () { HANDLERS['help-send']('call'); },
    'help-emergency': function () { ui.overlay = 'help-confirm'; render(); },
    'help-send': function (kind) {
      var r = S.createRequest({ dept: 'help', room: ROOM, kind: kind, title: kind === 'emergency' ? 'Emergency' : 'Call-back requested' });
      known[r.id] = r.status; ui.helpKind = kind; ui.helpId = r.id; ui.overlay = 'help-sent';
      speak(kind === 'emergency' ? 'Help is on the way.' : 'The front desk will call your room in a moment.');
      render();
    }
  };

  tablet.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled || !tablet.contains(el)) return;
    if (el.dataset.act === 'scrim' && e.target !== el) return; // clicks inside the sheet
    var fn = HANDLERS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset.arg); }
  });
  tablet.addEventListener('input', function (e) {
    var path = e.target.dataset && e.target.dataset.model;
    if (!path) return;
    var parts = path.split('.'), obj = ui;
    while (parts.length > 1) obj = obj[parts.shift()];
    obj[parts[0]] = e.target.value;
    if (path === 'hk.other') render();
  });
  tablet.addEventListener('submit', function (e) {
    if (e.target.dataset.form === 'voice') { e.preventDefault(); hear(ui.voice.text); }
  });

  document.getElementById('mute-btn').addEventListener('click', function () {
    ui.muted = !ui.muted;
    if (ui.muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    try { localStorage.setItem('kira-guest-muted', ui.muted ? '1' : '0'); } catch (e) {}
    renderNav();
  });
  document.getElementById('text-up').addEventListener('click', function () { setTextScale(ui.textScale + 1); });
  document.getElementById('text-down').addEventListener('click', function () { setTextScale(ui.textScale - 1); });
  document.getElementById('lang-btn').addEventListener('click', function () { ui.overlay = 'lang'; render(); });
  document.getElementById('help-btn').addEventListener('click', function () { ui.overlay = 'help'; render(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.overlay) { ui.overlay = null; render(); } });

  function setTextScale(n) {
    ui.textScale = Math.max(-1, Math.min(2, n));
    document.documentElement.style.fontSize = (16 * (1 + ui.textScale * 0.08)) + 'px';
  }

  /* ---------------- Fit the 960×600 tablet to the window ---------------- */

  var stage = document.getElementById('stage');
  function fit() {
    var pad = ui$.inFrame ? 0 : (window.innerWidth < 600 ? 12 : 40);
    var s = Math.min((window.innerWidth - pad) / 960, (window.innerHeight - pad) / 600);
    tablet.style.transform = 'scale(' + s + ')';
    stage.style.width = (960 * s) + 'px';
    stage.style.height = (600 * s) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------------- Boot ---------------- */

  try { ui.muted = localStorage.getItem('kira-guest-muted') === '1'; } catch (e) {}
  myRequests().forEach(function (r) { known[r.id] = r.status; });
  if (location.hash === '#menu') openMenu(false);

  var failuresWere = !!S.get().settings.failures;
  S.subscribe(function (s) {
    if (!!s.settings.failures !== failuresWere) { failuresWere = !!s.settings.failures; ui.menuFailedOnce = false; ui.sendFailedOnce = false; }
    if (s.seededAt !== seededAt) { // demo was reset from another tab
      seededAt = s.seededAt; known = {}; myRequests().forEach(function (r) { known[r.id] = r.status; });
      ui.view = 'home'; ui.cart = {}; ui.trackId = null; ui.overlay = null; ui.heard = ''; ui.reply = '';
    }
    watchChanges();
    if (ui.trackId && !S.find(ui.trackId) && ui.view !== 'home') ui.view = 'home';
    render();
  });
  S.runAutopilot();
  ui$.every(function () { if (!ui.voice.busy) render(); }, 15000);
  ui$.launcherPill('../index.html');
})();
