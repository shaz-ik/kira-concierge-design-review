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
  // Housekeeping: guests pick as many of these as they like in one request (touch or voice).
  // max 1 = an on/off item; otherwise a quantity stepper.
  var HK_ITEMS = [
    { id: 'towels',     name: 'Extra towels',         info: 'Bath and hand towels',               max: 6, def: 2, re: /towels?/ },
    { id: 'pillows',    name: 'Extra pillows',        info: 'Soft or firm — tell Kira if you have a preference', max: 4, def: 2, re: /pillows?/ },
    { id: 'blanket',    name: 'Extra blanket',        info: 'Warm wool throw',                    max: 3, def: 1, re: /blankets?|duvet|throw/ },
    { id: 'toiletries', name: 'Toiletries refill',    info: 'Shampoo, soap, dental kit',          max: 1, def: 1, re: /toiletr|shampoo|soap|toothbrush|dental/ },
    { id: 'robes',      name: 'Bathrobe & slippers',  info: 'One set per guest',                  max: 4, def: 1, re: /robes?|bathrobes?|slippers/ },
    { id: 'iron',       name: 'Iron & ironing board', info: 'Brought up and collected later',     max: 1, def: 1, re: /\biron/ },
    { id: 'clean',      name: 'Clean my room',        info: 'A full clean, now or while you’re out', max: 1, def: 1, re: /clean (my |the )?room|room clean|tidy|make up (the |my )?room|clean up/ }
  ];
  var ICONS = {
    dining: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
    housekeeping: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>',
    checkout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
    valet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>'
  };
  var TILES = [
    { act: 'menu',     icon: 'dining',       name: 'In-room dining', info: 'Order food and drinks, brought to your room' },
    { act: 'hk',       icon: 'housekeeping', name: 'Housekeeping',   info: 'Towels, pillows, toiletries or a room clean' },
    { act: 'checkout', icon: 'checkout',     name: 'Late checkout',  info: 'Ask the front desk to stay a little longer' },
    { act: 'valet',    icon: 'valet',        name: 'Valet',          info: 'Have your car brought round to the entrance' }
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
    hk: { basket: {}, other: '', voiceAck: '' },
    voiceFrom: null,
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
    return '<button class="btn ' + (opts.hero ? 'btn-hero' : opts.primary ? 'btn-brass' : 'btn-ghost-dark') + '" data-act="' + act + '"' +
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

  var lastLine = '', speakUntil = 0, kiraKey = '', speakTimer = null, speakDelay = null;

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

  var MOODS = ['idle', 'listening', 'thinking', 'speaking', 'wake'];
  function setMood(m) {
    MOODS.forEach(function (x) { body.classList.toggle('state-' + x, x === m); });
  }

  // size: 'mini' (avatar + line in a flow's header) or 'big' (the Talk to Kira stage)
  function setKira(k, targetId, size) {
    var now = Date.now();
    if (k.line && k.line !== lastLine) {
      lastLine = k.line;
      if (k.mood !== 'listening' && !k.quiet) {
        // Each line is said once; a short delay drops lines the guest skips straight past.
        var said = k.line;
        clearTimeout(speakDelay);
        speakDelay = setTimeout(function () { if (lastLine === said) speak(said); }, 400);
        speakUntil = now + Math.min(6000, 900 + k.line.split(/\s+/).length * 330);
        clearTimeout(speakTimer);
        speakTimer = setTimeout(render, speakUntil - now + 20);
      }
    }
    var mood = k.mood === 'speaking' && now > speakUntil ? 'idle' : k.mood;
    setMood(mood);
    var col = document.getElementById(targetId);
    if (!col) return;
    var key = targetId + '|' + mood + '|' + k.line + '|' + (k.caption || '');
    if (key === kiraKey) return;
    kiraKey = key;
    if (size === 'mini') {
      col.innerHTML = '<button class="kira-tap" data-act="voice" aria-label="Talk to Kira"><div class="kira-photo-wrap tiny"><img src="' + IMG[mood] + '" alt="Kira"></div></button>' +
        (k.line ? '<div class="subtitle-bar">' + esc(k.line) + '</div>' : '');
    } else {
      col.innerHTML = '<div class="kira-photo-wrap"><img src="' + IMG[mood] + '" alt="Kira"></div>' +
        (k.caption ? '<div class="avatar-caption">' + esc(k.caption) + '</div>' : '') +
        (k.line ? '<div class="subtitle-bar">' + esc(k.line) + '</div>' : '');
    }
  }

  /* ---------------- Views ---------------- */
  // Each split view returns { kira: {mood, line, caption, small}, html, context }.

  var VIEWS = {};

  // Every flow screen follows the home's 60 / 40 rule: the content on the left (60%), the
  // actions on the right (40%) — buttons at the top, main one first, then any summary or hint.
  // opts: { hint, below (html under the buttons), fill (left panel fills the height, top-aligned) }
  function splitLayout(detail, actions, opts) {
    opts = opts || {};
    return '<div class="status-split' + (opts.fill ? ' fill' : '') + '"><section class="status-detail">' + detail + '</section>' +
      '<aside class="status-actions" aria-label="Actions"><div class="status-btns">' + actions.join('') + '</div>' +
      (opts.hint ? '<p class="status-hint">' + esc(opts.hint) + '</p>' : '') + (opts.below || '') + '</aside></div>';
  }
  function statusLayout(detail, actions, hint) { return splitLayout(detail, actions, { hint: hint }); }

  // "2× Wagyu smash burger   AED 136.00" lines for the right-hand summaries
  function summaryList(label, lines, empty) {
    return '<div class="side-summary"><p class="status-actions-label">' + esc(label) + '</p>' +
      (lines.length ? '<div class="side-lines">' + lines.map(function (l) {
        return '<div class="side-line"><span>' + esc(l[0]) + '</span>' + (l[1] ? '<span class="side-amt">' + esc(l[1]) + '</span>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="status-hint">' + esc(empty) + '</p>') + '</div>';
  }

  VIEWS['menu-loading'] = function () {
    return { context: 'In-room dining', kira: { mood: 'thinking', line: 'One moment — getting tonight’s menu…' },
      html: splitLayout(head('', 'In-room dining') + '<p class="task-note">Loading the menu…</p>', [btn('Review order', 'review', { primary: true, disabled: true })]) };
  };

  VIEWS['menu-error'] = function () {
    return { context: 'In-room dining', kira: { mood: 'thinking', line: 'I couldn’t load the menu just now — let me try again.' },
      html: splitLayout(
        head('', 'Menu unavailable') + banner('warn', 'The menu couldn’t be loaded.', 'This is usually brief. You can also order from the room phone.'),
        [btn('Try again', 'retry-menu', { primary: true }), btn('Back to home', 'home')]) };
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
        ? '<span class="qty-ctrl"><button class="add-btn minus" data-act="dec" data-arg="' + m.id + '" aria-label="Remove one ' + esc(m.name) + '">−</button><span class="qty-pill' + (ui.bump === m.id ? ' bump' : '') + '" aria-label="' + qty + ' in order">' + qty + '</span><button class="add-btn" data-act="inc" data-arg="' + m.id + '" aria-label="Add another ' + esc(m.name) + '">+</button></span>'
        : '<button class="add-btn" data-act="inc" data-arg="' + m.id + '" aria-label="Add ' + esc(m.name) + '">+</button>';
      return '<div class="menu-item"><div><div class="menu-item-name">' + esc(m.name) + '</div>' +
        '<div class="menu-item-tag allergen">' + (m.allergens ? 'Contains ' + esc(m.allergens.toLowerCase()) : 'No listed allergens') + '</div>' +
        (line && line.note ? '<div class="menu-item-note">' + esc(line.note) + '</div>' : '') + '</div>' +
        '<div class="menu-item-end"><span class="menu-item-price">' + F.moneyShort(m.price) + '</span>' + ctrl + '</div></div>';
    }).join('') || '<div class="menu-item"><div class="menu-item-tag">Nothing in this section right now.</div></div>';
    var lines = cartLines(), n = cartCount();
    var summary = summaryList('Your order' + (n ? ' · ' + n + ' item' + (n > 1 ? 's' : '') : ''),
      lines.map(function (l) { return [l.qty + '× ' + l.name, F.moneyShort(l.qty * l.price)]; }), 'Nothing yet — tap + or just tell Kira.') +
      (n ? '<div class="side-total"><span>Subtotal</span><span>' + F.money(cartSubtotal()) + '</span></div>' : '');
    var kira = ui.reply
      ? { mood: 'speaking', small: true, line: ui.reply }
      : { mood: 'listening', small: true, caption: 'Listening…', line: ui.heard ? '“' + ui.heard + '”' : 'What would you like? Tap + or just tell me.' };
    return { context: 'In-room dining', kira: kira,
      html: splitLayout(
        '<div class="menu-toolbar"><div class="quick-grid">' + cats + '</div></div><div class="guest-card menu-card" data-scroll="menu">' + rows + '</div>',
        [btn('Review order', 'review', { primary: true, disabled: !n })],
        { fill: true, below: summary }) };
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
      html: splitLayout(
        '<p class="task-title">Your order</p><div class="scroll-col" data-scroll="review"><div class="guest-card">' + rows +
          '<div class="sum-row first"><span>Subtotal</span><span>' + F.money(sub) + '</span></div>' +
          '<div class="sum-row"><span>Service charge &amp; VAT</span><span>' + F.money(svc) + '</span></div>' +
          '<div class="order-total-row"><span>Total · charged to Room ' + ROOM + '</span><span>' + F.money(total) + '</span></div></div>' + note + '</div>',
        [btn(ui.sending ? 'Sending…' : 'Confirm & send', 'send', { hero: true, disabled: ui.sending }), btn('Edit order', 'menu', { disabled: ui.sending })],
        { fill: true, hint: 'Nothing is charged until you confirm. ' + F.money(total) + ' goes to Room ' + ROOM + '.' }) };
  };

  VIEWS['send-error'] = function () {
    var lines = cartLines(), sub = cartSubtotal(), total = Math.round(sub * (1 + Kira.data.SERVICE_RATE) * 100) / 100;
    return { context: 'In-room dining · Review your order',
      kira: ui.sending ? { mood: 'thinking', line: 'Trying again…' } : { mood: 'speaking', line: 'Sorry, that didn’t go through. Shall I try again?' },
      html: splitLayout(
        '<p class="task-title">Your order</p>' + banner('warn', 'Couldn’t send your order', 'Nothing has been charged. Retrying sends it once — never twice.') +
          '<div class="guest-card"><div class="menu-item"><div class="menu-item-name">' + esc(itemsText(lines)) + '</div></div><div class="order-total-row"><span>Total</span><span>' + F.money(total) + '</span></div></div>',
        [btn(ui.sending ? 'Sending…' : 'Try again', 'send', { hero: true, disabled: ui.sending }), btn('Edit order', 'menu', { disabled: ui.sending })]) };
  };

  VIEWS['dining-sent'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    return { context: 'In-room dining · Order ' + r.ref,
      kira: { mood: 'speaking', line: 'Sent to the kitchen — I’ll let you know as it’s prepared.' },
      html: statusLayout(
        head('Order ' + r.ref, 'Sent to the kitchen') + banner('good', 'Order confirmed', itemsText(r.items) + ' · ' + F.money(r.total)) +
          '<p class="task-note">You’ll see live updates here as your order moves through the kitchen.</p>',
        [btn('Track status', 'track', { primary: true, arg: r.id }), btn('Back to home', 'home')]) };
  };

  VIEWS.dining = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var labels = ['Accepted', 'Preparing', 'Ready', 'Delivered'];
    var summary = '<p class="task-note">' + esc(itemsText(r.items)) + ' · ' + F.money(r.total) + '</p>';
    var ctx = 'In-room dining · Order ' + r.ref, eyebrow = 'Order ' + r.ref;
    if (r.status === 'cancelled') {
      var byGuest = r.cancelledBy === 'guest';
      var why = byGuest ? 'Nothing has been charged.' : (r.history[r.history.length - 1].text.replace(/^Rejected by kitchen — /, '') + ' Nothing has been charged.');
      return { context: ctx, kira: { mood: 'speaking', line: byGuest ? 'I’ve cancelled that order — nothing has been charged.' : 'I’m sorry — the kitchen couldn’t take that order. Nothing has been charged.' },
        html: statusLayout(
          head(eyebrow, 'Order cancelled') + summary + banner('warn', byGuest ? 'You cancelled this order' : 'The kitchen couldn’t take this order', why),
          [btn('Order something else', 'menu', { primary: true }), btn('Back to home', 'home')]) };
    }
    if (r.status === 'delivered') {
      var fb = ui.feedback[r.id];
      var rate = fb ? '<p class="status-hint">Thanks for the feedback.</p>'
        : '<p class="status-actions-label">How was it?</p><div class="status-rate"><button class="quick-chip" data-act="feedback" data-arg="good">🙂 Good</button><button class="quick-chip" data-act="feedback" data-arg="bad">🙁 Not great</button></div>';
      return { context: ctx, kira: { mood: 'wake', line: fb ? (fb === 'good' ? 'Wonderful — thank you!' : 'I’m sorry about that — I’ve let the restaurant manager know.') : 'Enjoy your meal — let me know if you’d like anything else.' },
        html: statusLayout(
          head(eyebrow, 'Delivered') + summary + '<div class="guest-card">' + stepper(labels, 3, true) + '</div>',
          [btn('Back to home', 'home', { primary: true }), btn('Order something else', 'menu'), rate]) };
    }
    var map = {
      incoming:  { i: 0, title: 'Order accepted',    line: 'The kitchen has your order — I’ll tell you when they start on it.', eta: 'Ready in about ' + minsLeft(r, 20) + ' minutes' },
      preparing: { i: 1, title: 'Being prepared',    line: 'Your order is being prepared now.',                 eta: 'Ready in about ' + minsLeft(r, 20) + ' minutes' },
      ready:     { i: 2, title: 'Ready',             line: 'Your order is ready — it’ll be with you in a few minutes.', eta: 'A waiter is collecting it now' },
      out:       { i: 2, title: 'On its way to you', line: 'Your order is on its way up now.',                  eta: 'Arriving in a few minutes' }
    }[r.status];
    var canCancel = r.status === 'incoming';
    return { context: ctx, kira: { mood: 'speaking', line: map.line },
      html: statusLayout(
        head(eyebrow, map.title) + summary + '<div class="guest-card">' + stepper(labels, map.i) + '</div>' + '<p class="avatar-sub">' + esc(map.eta) + '</p>',
        [btn('Back to home', 'home', { primary: true }), btn('Cancel order', 'cancel-order', { arg: r.id, disabled: !canCancel })],
        canCancel ? 'You can cancel until the kitchen starts preparing it.' : 'The kitchen has started, so this order can no longer be cancelled.') };
  };

  function hkItem(id) { return HK_ITEMS.filter(function (x) { return x.id === id; })[0]; }
  function hkLines() {
    return HK_ITEMS.filter(function (x) { return ui.hk.basket[x.id] > 0; }).map(function (x) { return { id: x.id, name: x.name, qty: ui.hk.basket[x.id] }; });
  }
  function hkCount() { return hkLines().length + (ui.hk.other.trim() ? 1 : 0); }
  // "2× Extra towels, 2× Extra pillows, Clean my room, Other: hairdryer"
  function hkTitle() {
    var parts = hkLines().map(function (l) { return hkItem(l.id).max > 1 ? l.qty + '× ' + l.name : l.name; });
    if (ui.hk.other.trim()) parts.push(ui.hk.other.trim());
    return parts.join(', ');
  }

  VIEWS.hk = function () {
    var rows = HK_ITEMS.map(function (x) {
      var q = ui.hk.basket[x.id] || 0, ctrl;
      if (x.max === 1) {
        ctrl = q ? '<button class="add-btn on' + (ui.bump === x.id ? ' bump' : '') + '" data-act="hk-set" data-arg="' + x.id + ':0" aria-label="Remove ' + esc(x.name) + '" aria-pressed="true">✓</button>'
                 : '<button class="add-btn" data-act="hk-set" data-arg="' + x.id + ':1" aria-label="Add ' + esc(x.name) + '" aria-pressed="false">+</button>';
      } else if (q) {
        ctrl = '<span class="qty-ctrl"><button class="add-btn minus" data-act="hk-set" data-arg="' + x.id + ':' + (q - 1) + '" aria-label="Fewer ' + esc(x.name.toLowerCase()) + '">−</button>' +
          '<span class="qty-pill' + (ui.bump === x.id ? ' bump' : '') + '" aria-label="' + q + ' requested">' + q + '</span>' +
          '<button class="add-btn" data-act="hk-set" data-arg="' + x.id + ':' + Math.min(x.max, q + 1) + '" aria-label="More ' + esc(x.name.toLowerCase()) + '"' + (q >= x.max ? ' disabled' : '') + '>+</button></span>';
      } else {
        ctrl = '<button class="add-btn" data-act="hk-set" data-arg="' + x.id + ':' + x.def + '" aria-label="Add ' + esc(x.name) + '">+</button>';
      }
      return '<div class="hk-row' + (q ? ' selected' : '') + '"><div><div class="menu-item-name">' + esc(x.name) + '</div><div class="menu-item-tag">' + esc(x.info) + '</div></div>' + ctrl + '</div>';
    }).join('') +
      '<div class="hk-row"><input class="text-field" id="hk-other" data-model="hk.other" maxlength="80" placeholder="Something else? Type it here" value="' + esc(ui.hk.other) + '" aria-label="Something else"></div>';
    var n = hkCount();
    var picked = hkLines().map(function (l) { return [hkItem(l.id).max > 1 ? l.qty + '× ' + l.name : l.name]; });
    if (ui.hk.other.trim()) picked.push([ui.hk.other.trim()]);
    // Kira speaks once when the screen opens (or once to acknowledge something said by voice) —
    // she doesn't re-read the list on every tap; the summary on the right shows it.
    var kira = ui.hk.voiceAck
      ? { mood: 'speaking', line: ui.hk.voiceAck }
      : { mood: 'speaking', line: 'What can housekeeping bring you? Choose as many as you like.' };
    return { context: 'Housekeeping', kira: kira,
      html: splitLayout(
        head('', 'What can we bring you?') + '<div class="guest-card hk-list" data-scroll="hk">' + rows + '</div>',
        [btn('Send request', 'hk-send', { hero: true, disabled: !n })],
        { fill: true, below: summaryList('Your request' + (n ? ' · ' + n + ' item' + (n > 1 ? 's' : '') : ''), picked, 'Choose as many as you like — or just tell Kira.') +
          '<p class="status-hint">Delivered to Room ' + ROOM + ', usually within 20 minutes.</p>' }) };
  };

  VIEWS['hk-track'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var labels = ['Received', 'In progress', 'Done'], ctx = 'Housekeeping · Request ' + r.ref, eyebrow = 'Request ' + r.ref;
    var what = '<p class="task-note">' + esc(r.title) + ' · Room ' + ROOM + '</p>';
    var onlyClean = r.items && r.items.length === 1 && r.items[0].id === 'clean' && !r.other;
    if (r.status === 'done') {
      return { context: ctx, kira: { mood: 'wake', line: onlyClean ? 'All done — your room has been cleaned.' : 'All done — everything you asked for has been delivered.' },
        html: statusLayout(
          head(eyebrow, 'All done') + what + '<div class="guest-card">' + stepper(labels, 2, true) + '</div>' + banner('good', onlyClean ? 'Room cleaned' : 'Delivered', r.title),
          [btn('Back to home', 'home', { primary: true }), btn('Another request', 'hk')]) };
    }
    if (r.status === 'cancelled') {
      return { context: ctx, kira: { mood: 'speaking', line: 'Housekeeping couldn’t complete that one — I’m sorry.' },
        html: statusLayout(
          head(eyebrow, 'Request closed') + banner('warn', 'This request was closed', r.title),
          [btn('Another request', 'hk', { primary: true }), btn('Back to home', 'home')]) };
    }
    if (r.status === 'received') {
      return { context: ctx, kira: { mood: 'idle', line: 'Got it — housekeeping will have this with you within 20 minutes.' },
        html: statusLayout(
          head(eyebrow, 'Request received') + what + '<div class="guest-card">' + stepper(labels, 0) + '</div>' + '<p class="avatar-sub">Expected within 20 minutes</p>',
          [btn('Back to home', 'home', { primary: true }), btn('Another request', 'hk')]) };
    }
    var m = minsLeft(r, 20);
    return { context: ctx, kira: { mood: 'speaking', line: 'Housekeeping is on it — about ' + m + ' minutes.' },
      html: statusLayout(
        head(eyebrow, 'On its way') + what + '<div class="guest-card">' + stepper(labels, 1) + '</div>' + '<p class="avatar-sub">Expected within ' + m + ' minutes</p>',
        [btn('Back to home', 'home', { primary: true }), btn('Another request', 'hk')]) };
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
      kira: { mood: 'speaking', line: ui.co.voiceTo ? 'Shall I ask the front desk for a ' + ui.co.voiceTo + ' checkout?' : 'What time would you like to check out? Pick a time and I’ll ask the front desk.', quiet: ui.co.quiet },
      html: splitLayout(
        '<p class="task-title">Extend checkout</p><div class="guest-card"><div class="g-field-row"><span class="label">Current checkout</span><span class="value">' + esc(cur) + '</span></div>' +
          '<div class="g-field-row"><span class="label">Requested</span><button class="g-select-chip" data-act="co-all" aria-expanded="' + ui.co.showAll + '">' + (valid ? to : 'Choose') + ' ▾</button></div></div>' +
          (ui.co.showAll ? all : '<div class="quick-grid">' + chips + '</div>'),
        [btn('Request extension', 'co-send', { hero: true, disabled: !valid })],
        { below: summaryList('Your request', valid ? [['Checkout at ' + to, ''], ['Currently ' + cur, '']] : [], 'Pick a time on the left.') +
          '<p class="status-hint">A late checkout fee may apply — you’ll see it and confirm before anything is charged.</p>' }) };
  };

  VIEWS['checkout-track'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var ctx = 'Extend checkout';
    if (r.status === 'pending') {
      return { context: ctx, kira: { mood: 'idle', line: 'I’ve sent that to the front desk.' },
        html: statusLayout(
          head('Request sent', 'Waiting for the front desk') + banner('pending', 'Waiting for front desk approval', 'Requested: checkout at ' + r.to + ' (currently ' + r.from + ')') +
            '<p class="task-note">You’ll be notified here as soon as they reply — feel free to carry on.</p>',
          [btn('Back to home', 'home', { primary: true }), btn('Cancel request', 'co-cancel', { arg: r.id })],
          'Cancelling keeps your ' + r.from + ' checkout.') };
    }
    if (r.status === 'approved') {
      return { context: ctx, kira: { mood: 'speaking', line: 'Approved — there’s a late checkout fee of AED ' + r.fee + '. Shall I confirm?' },
        html: statusLayout(
          head('Front desk replied', 'Approved') + banner('good', 'Approved — new checkout: ' + r.to) +
            '<div class="guest-card"><div class="g-field-row"><span class="label">Late checkout fee</span><span class="value">' + F.money(r.fee) + '</span></div><div class="g-field-row"><span class="label">Charged to</span><span class="value">Room ' + ROOM + '</span></div></div>',
          [btn('Confirm charge', 'co-confirm', { hero: true, arg: r.id }), btn('Decline', 'co-decline', { arg: r.id })],
          'Declining keeps your original ' + r.from + ' checkout.') };
    }
    if (r.status === 'confirmed' && r.fee) {
      return { context: ctx, kira: { mood: 'wake', line: 'All set — enjoy the extra time.' },
        html: statusLayout(
          head('All set', 'Checkout extended') + banner('good', 'New checkout: ' + r.to, F.money(r.fee) + ' charged to Room ' + ROOM),
          [btn('Back to home', 'home', { primary: true })]) };
    }
    if (r.status === 'confirmed') {
      return { context: ctx, kira: { mood: 'wake', line: 'Approved — your checkout is now ' + r.to + ', no charge.' },
        html: statusLayout(
          head('Request approved', 'Checkout extended') + banner('good', 'Approved — new checkout: ' + r.to, 'No fee — within standard policy') +
            '<p class="task-note">Nothing further to confirm — you’re all set.</p>',
          [btn('Back to home', 'home', { primary: true })]) };
    }
    if (r.status === 'denied') {
      return { context: ctx, kira: { mood: 'speaking', line: 'Sorry, the front desk couldn’t approve that one.' },
        html: statusLayout(
          head('Front desk replied', 'Not approved') + banner('warn', 'Your checkout stays at ' + r.from, r.reason ? r.reason.replace(/\.?$/, '.') : '') +
            '<p class="task-note">You can request a later checkout on another day, or ask about a day-use room.</p>',
          [btn('Done', 'home', { primary: true }), btn('Day-use options', 'day-use')]) };
    }
    if (r.status === 'declined') {
      return { context: ctx, kira: { mood: 'speaking', line: 'No problem — your checkout stays at ' + r.from + '.' },
        html: statusLayout(
          head('', 'Checkout unchanged') + banner('pending', 'You kept your ' + r.from + ' checkout', 'Nothing has been charged.'),
          [btn('Back to home', 'home', { primary: true })]) };
    }
    return { context: ctx, kira: { mood: 'speaking', line: 'I’ve withdrawn that request.' },
      html: statusLayout(
        head('', 'Request cancelled') + banner('pending', 'Your checkout stays at ' + r.from),
        [btn('Back to home', 'home', { primary: true })]) };
  };

  VIEWS.valet = function () {
    var v = room().vehicle;
    var rows = v
      ? '<div class="g-field-row"><span class="label">Your vehicle</span><span class="value">' + esc(v.model) + '</span></div><div class="g-field-row"><span class="label">Plate</span><span class="value">' + esc(v.plate) + '</span></div>'
      : '';
    return { context: 'Valet', kira: { mood: 'speaking', line: 'Shall I call for your car now?' },
      html: splitLayout(
        head('', 'Bring my car') + '<div class="guest-card">' + rows + '<div class="g-field-row"><span class="label">Pick-up</span><span class="value">Main entrance</span></div></div>' +
          (v ? '' : '<p class="task-note">We don’t have your vehicle on file — the valet team will confirm the details with you at the entrance.</p>'),
        [btn('Bring my car', 'valet-send', { hero: true })],
        { hint: 'The valet team usually has it at the main entrance within 10 minutes. We’ll tell you here when it’s ready.' }) };
  };

  VIEWS['valet-track'] = function () {
    var r = S.find(ui.trackId);
    if (!r) return VIEWS.home();
    var labels = ['Received', 'Bringing car', 'Ready at entrance'], ctx = 'Valet · Request ' + r.ref, eyebrow = 'Valet ' + r.ref;
    var car = r.vehicle ? r.vehicle.model + ' · ' + r.vehicle.plate : 'Your car';
    if (r.status === 'done') {
      return { context: ctx, kira: { mood: 'wake', line: 'Your car is ready at the main entrance.' },
        html: statusLayout(
          head(eyebrow, 'Your car is ready') + banner('good', 'Waiting at the main entrance', car) + '<div class="guest-card">' + stepper(labels, 2, true) + '</div>',
          [btn('Done', 'home', { primary: true })]) };
    }
    if (r.status === 'cancelled') {
      return { context: ctx, kira: { mood: 'speaking', line: 'That valet request was closed — please call the front desk if you still need your car.' },
        html: statusLayout(
          head(eyebrow, 'Request closed') + '<p class="task-note">Please call the front desk if you still need your car.</p>',
          [btn('Back to home', 'home', { primary: true })]) };
    }
    var received = r.status === 'received';
    return { context: ctx, kira: { mood: received ? 'idle' : 'speaking', line: received ? 'I’ve let the valet team know.' : 'Your car is being brought around now.' },
      html: statusLayout(
        head(eyebrow, received ? 'Calling the valet' : 'Bringing your car') + '<p class="task-note">' + esc(car) + ' · Main entrance</p>' +
          '<div class="guest-card">' + stepper(labels, received ? 0 : 1) + '</div>' +
          '<p class="avatar-sub">We’ll let you know here the moment it’s at the main entrance.</p>',
        [btn('Back to home', 'home', { primary: true })]) };
  };

  var PHRASES = ['Two burgers and a Coke, please — no onion', 'Two extra towels and two pillows, please', 'I’d like a late checkout at 5', 'Bring my car around', 'What time does the pool close?'];
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
      html: '<div class="voice-panel">' + head('', 'Just ask') +
        '<p class="task-note">On the real tablet you simply speak. Here, tap a phrase' + (Recognition ? ', use the microphone,' : '') + ' or type what you’d say.</p>' +
        '<div class="voice-examples">' + examples + '</div>' +
        '<form class="voice-row" data-form="voice"><input class="text-field" id="voice-text" data-model="voice.text" placeholder="Type to Kira…" value="' + esc(v.text) + '" aria-label="Say something to Kira" autocomplete="off"' + (v.busy ? ' disabled' : '') + '>' +
        '<button class="btn btn-brass" type="submit"' + (v.busy ? ' disabled' : '') + '>Send</button></form>' +
        (Recognition ? '<button class="btn btn-ghost-dark mic-btn' + (recognizing ? ' live' : '') + '" data-act="mic">' + MIC + (recognizing ? 'Listening… tap to stop' : 'Use microphone') + '</button>' : '') + '</div>' };
  };

  /* ---------------- One bento grid, three modes ----------------
     home    → Kira 60% | services 40%
     service → the services panel grows to full width and becomes the flow screen
     kira    → the Kira panel grows to full width for talking
     Both panels stay in the DOM so the grid can animate between modes. */

  var MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>';
  var BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var panelKeys = { ai: '', svc: '' }, lastView = null;

  function modeOf(view) { return view === 'home' ? 'home' : view === 'voice' ? 'kira' : 'service'; }

  function ensureShell() {
    if (body.dataset.layout === 'bento') return;
    body.dataset.layout = 'bento';
    body.className = 'tablet-body bento-home mode-home state-idle';
    body.innerHTML = '<section class="bento bento-ai" id="panel-ai" aria-label="Kira"></section><section class="bento bento-services" id="panel-svc" aria-label="Services"></section>';
  }

  // Restart a one-shot entrance animation, then drop the class so later re-renders don't replay it.
  var animTimers = {};
  function play(el, cls, ms) {
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    clearTimeout(animTimers[el.id + cls]);
    animTimers[el.id + cls] = setTimeout(function () { el.classList.remove(cls); }, ms || 900);
  }

  function homeKiraHTML() {
    return '<p class="bento-meta" id="home-time"></p>' +
      '<div class="ai-home">' +
        '<button class="kira-tap" data-act="voice" aria-label="Talk to Kira"><div class="kira-photo-wrap"><img src="' + IMG.idle + '" alt="Kira"></div></button>' +
        '<p class="home-greeting">' + greeting() + '</p><p class="avatar-sub">Say “Hey Kira”, or tap to begin</p>' +
        '<button class="btn btn-ghost-dark talk-btn" data-act="voice">' + MIC + 'Talk to Kira</button>' +
        '<div class="home-active" id="home-active"></div>' +
      '</div>';
  }
  function voiceShellHTML() {
    return '<div class="panel-head"><button class="nav-btn back-btn" data-act="back">' + BACK + 'Back</button><p class="panel-title">Talk to Kira</p></div>' +
      '<div class="voice-grid"><div class="kira-stage" id="kira-big"></div><div class="voice-side" id="voice-col"></div></div>';
  }
  function serviceListHTML() {
    return '<p class="bento-label">Or choose a service</p>' +
      '<div class="svc-list">' + TILES.map(function (t) {
        return '<button class="svc-row" data-act="' + t.act + '"><img src="../assets/icons/' + t.icon + '.png" alt="" width="44" height="44">' +
          '<span class="svc-text"><span class="name">' + esc(t.name) + '</span><span class="info">' + esc(t.info) + '</span></span></button>';
      }).join('') + '</div>';
  }
  function flowShellHTML() {
    return '<div class="panel-head"><button class="nav-btn back-btn" data-act="back">' + BACK + 'Back</button><p class="panel-title" id="flow-title"></p><div class="kira-mini" id="kira-mini"></div></div>' +
      '<div class="task-col flow-body" id="task-col"></div>';
  }

  function renderHomeActive() {
    var el = document.getElementById('home-active');
    if (!el) return;
    var open = myRequests().filter(function (r) { return S.isOpen(r) && r.dept !== 'help'; }).sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 3);
    el.innerHTML = open.map(function (r) {
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

    ensureShell();
    var mode = modeOf(ui.view), viewChanged = ui.view !== lastView;
    ['home', 'service', 'kira'].forEach(function (m) { body.classList.toggle('mode-' + m, m === mode); });
    var ai = document.getElementById('panel-ai'), svc = document.getElementById('panel-svc');
    var aiKey = mode === 'kira' ? 'voice' : 'home', svcKey = mode === 'service' ? 'flow' : 'list';
    if (panelKeys.ai !== aiKey) { panelKeys.ai = aiKey; ai.innerHTML = aiKey === 'voice' ? voiceShellHTML() : homeKiraHTML(); kiraKey = ''; play(ai, 'swap', 1100); }
    var svcSwapped = panelKeys.svc !== svcKey;
    if (svcSwapped) { panelKeys.svc = svcKey; svc.innerHTML = svcKey === 'flow' ? flowShellHTML() : serviceListHTML(); kiraKey = ''; play(svc, 'swap', 1100); }

    if (mode === 'home') {
      setMood('idle'); lastLine = '';
      document.getElementById('home-time').innerHTML = esc(F.time()) + ' · 24°C, clear';
      renderHomeActive();
    } else {
      var v = VIEWS[ui.view]();
      if (mode === 'kira') {
        setKira(v.kira, 'kira-big', 'big');
        var vc = document.getElementById('voice-col');
        vc.innerHTML = v.html;
        if (viewChanged) play(vc, 'enter');
      } else {
        document.getElementById('flow-title').textContent = v.context;
        setKira(v.kira, 'kira-mini', 'mini');
        var tc = document.getElementById('task-col');
        tc.innerHTML = v.html;
        if (viewChanged && !svcSwapped) play(tc, 'enter');
      }
    }
    lastView = ui.view;
    ui.bump = null;

    body.querySelectorAll('[data-scroll]').forEach(function (el) { if (scrolls[el.dataset.scroll]) el.scrollTop = scrolls[el.dataset.scroll]; });
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el && el !== document.activeElement) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch (e) {} }
    }
    renderOverlay();
    renderNav();
  }

  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  function renderNav() {
    var light = document.documentElement.classList.contains('theme-light');
    var tb = document.getElementById('theme-btn');
    tb.innerHTML = light ? MOON : SUN;
    tb.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    tb.title = tb.getAttribute('aria-label');
    var mute = document.getElementById('mute-btn');
    mute.setAttribute('aria-pressed', String(ui.muted));
    mute.classList.toggle('muted', ui.muted);
    mute.setAttribute('aria-label', ui.muted ? 'Unmute Kira' : 'Mute Kira');
    mute.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/>' +
      (ui.muted ? '<path d="m22 9-6 6M16 9l6 6"/>' : '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>') + '</svg>' + (ui.muted ? 'Unmute' : 'Mute');
    document.getElementById('room-chip').textContent = 'Room ' + ROOM;
  }

  var overlayKey = '';
  function renderOverlay() {
    var hr = ui.helpId && S.find(ui.helpId);
    var key = (ui.overlay || '') + '|' + (hr ? hr.status : '');
    if (key === overlayKey) return;
    overlayKey = key;
    if (!ui.overlay) { overlay.innerHTML = ''; return; }
    var h = '';
    if (ui.overlay === 'help') {
      h = '<p class="task-title">How can we help?</p><p class="task-note">The front desk is staffed around the clock.</p>' +
        '<button class="btn btn-ghost-dark" data-act="help-call">Call me back — front desk</button>' +
        '<button class="btn btn-danger" data-act="help-emergency">Emergency — alert security now</button>' +
        btn('Close', 'overlay-close');
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
        '</div>' + btn('Close', 'overlay-close');
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
    // Housekeeping: every item mentioned, each with its own quantity ("two towels and a blanket").
    var hkFound = [];
    HK_ITEMS.forEach(function (x) {
      var m = x.re.exec(t);
      if (!m) return;
      var words = t.slice(0, m.index).trim().split(' '), q = null;
      for (var k = words.length - 1; k >= Math.max(0, words.length - 3) && q == null; k--) {
        if (/^\d+$/.test(words[k])) q = +words[k]; else if (NUM_WORDS[words[k]]) q = NUM_WORDS[words[k]];
      }
      hkFound.push({ id: x.id, qty: Math.min(x.max, Math.max(1, q || x.def)) });
    });
    if (hkFound.length) return { type: 'hk', items: hkFound };
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
    if (intent.type === 'hk') {
      // Spoken from the housekeeping screen: add to what's there. From anywhere else: start fresh.
      if (ui.voiceFrom !== 'hk') { ui.hk.basket = {}; ui.hk.other = ''; }
      intent.items.forEach(function (f) { ui.hk.basket[f.id] = f.qty; });
      ui.hk.voiceAck = 'Got it — anything else?'; // one short acknowledgement; the list shows what was added
      ui.view = 'hk'; return;
    }
    if (intent.type === 'checkout') {
      var open = openOf('checkout');
      if (open) { ui.trackId = open.id; ui.view = 'checkout-track'; return; }
      ui.co.voiceTo = intent.to || null; ui.co.quiet = false;
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

  /* ---------------- Tap sounds ----------------
     'select' — a soft two-note pop when a service is chosen; 'tick' — a light tap for in-flow
     choices (+/−, chips, times, Back). Synthesised with WebAudio, so no audio files; silent when muted. */
  var audio = null;
  var TICK_ACTS = { inc: 1, dec: 1, 'hk-set': 1, cat: 1, 'co-time': 1, 'co-all': 1, feedback: 1, say: 1, back: 1 };
  function sound(kind) {
    if (ui.muted) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      var t = audio.currentTime + 0.005;
      var notes = kind === 'select' ? [[660, 0, 0.11, 0.08], [990, 0.06, 0.14, 0.06]] : [[1320, 0, 0.05, 0.035]];
      notes.forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(n[0], t + n[1]);
        o.frequency.exponentialRampToValueAtTime(n[0] * 0.85, t + n[1] + n[2]);
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(n[3], t + n[1] + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + n[2]);
        o.connect(g); g.connect(audio.destination);
        o.start(t + n[1]); o.stop(t + n[1] + n[2] + 0.02);
      });
    } catch (e) {}
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
    back: function () {
      if (ui.view === 'voice' && ui.voiceFrom && ui.voiceFrom !== 'home' && ui.voiceFrom !== 'voice' && VIEWS[ui.voiceFrom]) { ui.reply = ''; go(ui.voiceFrom); return; }
      var prev = { review: 'menu', 'send-error': 'review' }[ui.view];
      if (prev) { ui.view = prev; render(); return; }
      HANDLERS.home();
    },
    menu: function () { if (ui.view === 'review' || ui.view === 'send-error' || ui.view === 'menu-error') { ui.view = 'menu'; render(); } else openMenu(false); },
    'retry-menu': function () { openMenu(false); },
    cat: function (a) { ui.cat = a; ui.reply = ''; render(); },
    inc: function (a) { var l = ui.cart[a] || (ui.cart[a] = { qty: 0, note: '' }); l.qty = Math.min(9, l.qty + 1); ui.reply = ''; ui.bump = a; render(); },
    dec: function (a) { var l = ui.cart[a]; if (l) { l.qty--; if (l.qty <= 0) delete ui.cart[a]; } ui.reply = ''; ui.bump = a; render(); },
    review: function () { if (!ui.token) ui.token = 'ct_' + Math.random().toString(36).slice(2, 10); go('review'); },
    'show-note': function () { ui.showNote = true; render(); var el = document.getElementById('dnote'); if (el) el.focus(); },
    send: sendOrder,
    track: track,
    'cancel-order': function (id) { S.setStatus(id, 'cancelled', { text: 'Cancelled by guest before preparation', patch: { cancelledBy: 'guest' } }); },
    feedback: function (a) { ui.feedback[ui.trackId] = a; S.patch(ui.trackId, { feedback: a }, a === 'good' ? 'Guest feedback: good' : 'Guest feedback: not great'); },
    hk: function () { ui.hk = { basket: {}, other: '', voiceAck: '' }; ui.trackId = null; go('hk'); },
    'hk-set': function (a) {
      var p = a.split(':'), q = +p[1];
      if (q > 0) ui.hk.basket[p[0]] = q; else delete ui.hk.basket[p[0]];
      ui.bump = p[0];
      render();
    },
    'hk-send': function () {
      var title = hkTitle();
      if (!title) return;
      var r = S.createRequest({ dept: 'housekeeping', room: ROOM, title: title, items: hkLines(), other: ui.hk.other.trim(), channel: ui.heard ? 'voice' : 'tablet' });
      known[r.id] = r.status; ui.heard = ''; ui.trackId = r.id;
      ui.hk = { basket: {}, other: '', voiceAck: '' };
      go('hk-track');
    },
    checkout: function () {
      var open = openOf('checkout');
      if (open) { track(open.id); return; }
      var cur = F.hourOf(room().checkout);
      if (!(F.hourOf(ui.co.to) > cur)) ui.co.to = CHECKOUT_TIMES.filter(function (t) { return F.hourOf(t) > cur; })[0] || '';
      ui.co.showAll = false; ui.co.voiceTo = null; ui.co.quiet = false; go('checkout');
    },
    'co-time': function (a) { ui.co.to = a; ui.co.showAll = false; if (ui.co.voiceTo) { ui.co.voiceTo = null; ui.co.quiet = true; } render(); },
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
    voice: function () { if (ui.view !== 'voice') { ui.voiceFrom = ui.view; ui.reply = ''; ui.voice.text = ''; go('voice'); setTimeout(function () { var el = document.getElementById('voice-text'); if (el && !('ontouchstart' in window)) el.focus(); }, 50); } },
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
    if (!fn) return;
    if (el.classList.contains('svc-row')) sound('select');
    else if (TICK_ACTS[el.dataset.act]) sound('tick');
    e.preventDefault(); fn(el.dataset.arg);
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
  document.getElementById('theme-btn').addEventListener('click', function () {
    var light = document.documentElement.classList.toggle('theme-light');
    try { localStorage.setItem('kira-guest-theme', light ? 'light' : 'dark'); } catch (e) {}
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
