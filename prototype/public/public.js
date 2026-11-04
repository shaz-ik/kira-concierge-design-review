/* Kira Concierge — public hall kiosk (working prototype).
   A tablet in the hotel's public halls, for anyone — not tied to a room. Two jobs:
   answer questions about the hotel, and give directions on a 3D map of the building.
   Same components and behaviour as the guest tablet (bento home, morphing panels,
   Kira's voice, top-bar controls); Help sends a staff alert to the front desk. */
(function () {
  'use strict';

  var S = Kira.store, F = Kira.fmt, esc = F.esc, ui$ = Kira.ui, H = window.KiraHotel;
  var KIOSK = H.kiosk(((/[?&]kiosk=(\w+)/.exec(location.search)) || [])[1]);
  var KIOSK_NAME = KIOSK.label + ' kiosk · ' + H.floor(KIOSK.floor).name;
  var IMG = {
    idle: '../assets/kira-photo.jpg', listening: '../assets/kira-photo.jpg', thinking: '../assets/kira-photo.jpg',
    speaking: '../assets/kira-photo.jpg', wake: '../assets/kira-photo.jpg'
  };
  var ICON = '../assets/icons/';
  var IDLE_MS = 60000; // a public screen goes back to its welcome after a minute untouched
  var PHRASES = ['Where is the gym?', 'What time does the pool close?', 'How do I get to the spa?', 'What’s the Wi-Fi password?', 'Is there a prayer room?', 'How far is JBR Beach?'];

  /* ---------------- Local state ---------------- */

  var ui = {
    view: 'home',          // home (welcome) | places | info | directions | voice
    place: null,           // place id being shown on the map
    placeCat: 'popular',   // Find a place filter: popular | G | L1 | L2 | L8
    topic: null,           // Hotel info topic on show
    dirFrom: null,         // where Directions was opened from (Back returns there)
    step: 0,               // step the walking light is on
    answer: null,          // { title, place } — Kira's last answer, for "Show me the way"
    heard: '', reply: '',
    voice: { text: '', typing: '', busy: false },
    voiceFrom: null,
    overlay: null, helpKind: null, helpId: null,
    muted: (function () { try { return localStorage.getItem('kira-kiosk-muted') === '1'; } catch (e) { return false; } })(), volume: 0.8
  };
  var seededAt = S.get().seededAt;

  var tablet = document.getElementById('tablet');
  var body = document.getElementById('body');
  var overlay = document.getElementById('overlay');

  /* ---------------- Helpers ---------------- */

  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  function btn(label, act, opts) {
    opts = opts || {};
    return '<button class="btn ' + (opts.hero ? 'btn-hero' : opts.primary ? 'btn-brass' : 'btn-ghost-dark') + '" data-act="' + act + '"' +
      (opts.arg != null ? ' data-arg="' + esc(opts.arg) + '"' : '') + (opts.disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
  }
  function head(eyebrow, title) {
    return '<div class="task-head">' + (eyebrow ? '<span class="task-eyebrow">' + esc(eyebrow) + '</span>' : '') + '<p class="task-title">' + esc(title) + '</p></div>';
  }
  function banner(kind, text, meta) {
    return '<div class="g-banner g-banner-' + kind + '">' + esc(text) + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</div>';
  }
  function floorShort(id) { return id === 'G' ? 'Ground floor' : H.floor(id).name; }
  function openLine(p, short) {
    var o = H.openStatus(p);
    return o ? '<span class="open-dot' + (o.open ? '' : ' off') + '"></span>' + esc(short ? o.text.replace('Open now · until', 'Open until') : o.text) : '';
  }
  function placeAnswer(p) {
    var where = p.floor === KIOSK.floor ? p.where : 'on ' + (p.floor === 'G' ? 'the ground floor' : H.floor(p.floor).name);
    var o = H.openStatus(p);
    return (p.say || p.name) + (p.plural ? ' are ' : ' is ') + where + (o ? ' — ' + o.text.replace('Open now · ', 'open now, ').replace('Closed · ', 'closed right now, ').replace('Open 24 hours', 'open 24 hours') : '') + '.';
  }

  /* ---------------- Kira: what she shows and says ---------------- */

  var lastLine = '', speakUntil = 0, kiraKey = '', speakTimer = null, speakDelay = null;

  function speak(text) {
    if (ui.muted || ui.volume <= 0 || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text.replace(/[“”"]/g, '').replace(/(\d+) m\b/g, '$1 metres').replace(/\bmin\b/g, 'minute'));
      u.rate = 1.02; u.pitch = 1.05; u.volume = ui.volume;
      var voices = window.speechSynthesis.getVoices();
      var pick = voices.filter(function (v) { return /en(-|_)(GB|US)/i.test(v.lang) && /female|samantha|serena|karen|moira|google uk english female|zira/i.test(v.name); })[0] ||
                 voices.filter(function (v) { return /^en/i.test(v.lang); })[0];
      if (pick) u.voice = pick;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  var MOODS = ['idle', 'listening', 'thinking', 'speaking', 'wake'];
  function setMood(m) { MOODS.forEach(function (x) { body.classList.toggle('state-' + x, x === m); }); }

  function setKira(k, targetId, size) {
    var now = Date.now();
    if (k.line && k.line !== lastLine) {
      lastLine = k.line;
      if (k.mood !== 'listening' && !k.quiet) {
        // Each line is said once; a short delay drops lines skipped straight past.
        var said = k.line, words = k.speech || k.line; // speech: what she says, when it's longer than the subtitle
        clearTimeout(speakDelay);
        speakDelay = setTimeout(function () { if (lastLine === said) speak(words); }, 400);
        speakUntil = now + Math.min(9000, 900 + words.split(/\s+/).length * 330);
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

  var VIEWS = {};
  var MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>';
  var BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  var GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  var LIFEBUOY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24"/></svg>';
  var HELP_MINI = '<button class="nav-btn nav-help nav-icon-only help-mini" data-act="help" aria-label="Help or emergency" title="Help / Emergency">' + LIFEBUOY + '</button>';
  var REPLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  var PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
  var DRAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>';

  function currentRoute() { return ui.place ? H.route(KIOSK.id, ui.place) : null; }

  // Directions: the 3D map on the left (60%), the place and its steps on the right (40%).
  VIEWS.directions = function () {
    var r = currentRoute();
    if (!r) { ui.view = 'home'; return null; }
    var p = r.place, o = H.openStatus(p);
    var steps = r.steps.map(function (s, i) {
      return '<li class="dir-step' + (i === ui.step ? ' on' : '') + '" data-step="' + i + '"><span class="n">' + (i + 1) + '</span><span>' + esc(s) + '</span></li>';
    }).join('');
    return { context: 'Directions · ' + p.name, kira: { mood: 'speaking', line: r.line },
      html: '<div class="status-split fill">' +
        '<section class="status-detail map-card" aria-label="3D map of the hotel with the route to ' + esc(p.name) + '"><div class="map-slot" id="map-slot"></div>' +
          '<div class="map-tools"><div class="nav-seg map-zoom" role="group" aria-label="Zoom">' +
            '<button class="nav-btn" data-act="zoom-in" aria-label="Zoom in">' + PLUS + '</button>' +
            '<button class="nav-btn" data-act="zoom-out" aria-label="Zoom out">' + MINUS + '</button></div>' +
            '<span class="map-hint">' + DRAG + 'Drag to turn · pinch to zoom</span></div>' +
          '<button class="nav-btn map-replay" data-act="replay">' + REPLAY + 'Replay</button></section>' +
        '<aside class="status-actions is-summary dir-side" aria-label="Directions">' +
          '<div class="dir-head"><img src="' + ICON + p.icon + '.png" alt="" width="52" height="52"><div><p class="side-heading">' + esc(p.name) + '</p><p class="dir-floor">' + esc(H.floorLabel(p.floor)) + '</p></div></div>' +
          '<div class="dir-facts"><span><b>' + esc(r.time.charAt(0).toUpperCase() + r.time.slice(1)) + '</b> away</span>' + (o ? '<span>' + openLine(p, true) + '</span>' : '') + '</div>' +
          '<ol class="dir-steps" data-scroll="steps">' + steps + '</ol>' +
          '<div class="side-cta"><div class="status-btns">' + btn('Done', 'home', { hero: true }) + '</div></div>' +
        '</aside></div>' };
  };

  // Find a place: popular places or one floor at a time, as tiles; a floor guide and Talk to Kira beside them.
  var PLACE_CATS = [['popular', 'Popular'], ['G', 'Ground'], ['L1', 'Level 1'], ['L2', 'Level 2'], ['L8', 'Rooftop']];
  function hotelGuideHTML() {
    return [['G', 'Lobby', 'front desk, dining, lounge'], ['1', 'Meetings & events', 'ballroom, prayer room'], ['2', 'Wellness', 'fitness, spa, kids club'],
      ['3–7', 'Guest rooms', ''], ['8', 'Rooftop', 'pool and Sky Bar']].map(function (g) {
      return '<div><span class="floor-badge">' + g[0] + '</span><span><b>' + esc(g[1]) + '</b>' + (g[2] ? ' · ' + esc(g[2]) : '') + '</span></div>';
    }).join('');
  }
  VIEWS.places = function () {
    var cat = ui.placeCat;
    var list = cat === 'popular' ? H.POPULAR.map(function (id) { return H.place(id); }) : H.PLACES.filter(function (p) { return p.floor === cat; });
    var chips = PLACE_CATS.map(function (c) {
      return '<button class="quick-chip' + (c[0] === cat ? ' selected' : '') + '" data-act="place-cat" data-arg="' + c[0] + '" aria-pressed="' + (c[0] === cat) + '">' + esc(c[1]) + '</button>';
    }).join('');
    var tiles = list.map(function (p) {
      return '<button class="place-tile" data-act="go" data-arg="' + p.id + '"><img src="' + ICON + p.icon + '.png" alt="" width="42" height="42">' +
        '<span class="name">' + esc(p.name) + '</span><span class="info">' + esc(cat === 'popular' ? floorShort(p.floor) : p.info) + '</span></button>';
    }).join('');
    return { context: 'Find a place', kira: { mood: 'speaking', line: 'Where would you like to go? Tap a place, or just tell me.' },
      html: '<div class="status-split fill"><section class="status-detail"><div class="place-filter" data-scroll="cats">' + chips + '</div>' +
          '<div class="place-grid" data-scroll="places">' + tiles + '</div></section>' +
        '<aside class="status-actions is-summary" aria-label="Hotel guide"><p class="side-heading">Hotel guide</p><div class="floor-guide">' + hotelGuideHTML() + '</div>' +
        '<div class="side-cta"><div class="status-btns"><button class="btn btn-hero mic-btn" data-act="voice">' + MIC + 'Talk to Kira</button></div></div></aside></div>' };
  };

  // Hotel info: topics on the left; the answer, and the way there, on the right. Kira reads it out.
  VIEWS.info = function () {
    var t = ui.topic && H.topic(ui.topic), place = t && t.place && H.place(t.place);
    var rows = H.TOPICS.map(function (id) {
      var f = H.topic(id), on = t && t.id === id;
      return '<button class="topic-row' + (on ? ' selected' : '') + '" data-act="topic" data-arg="' + id + '" aria-pressed="' + !!on + '"><img src="' + ICON + f.icon + '.png" alt="" width="32" height="32">' +
        '<span class="svc-text"><span class="name">' + esc(f.title) + '</span><span class="info">' + esc(f.short) + '</span></span></button>';
    }).join('');
    var aside = t
      ? '<div class="dir-head"><img src="' + ICON + t.icon + '.png" alt="" width="46" height="46"><div><p class="side-heading">' + esc(t.title) + '</p>' +
          (place ? '<p class="dir-floor">' + esc(place.name + ' · ' + floorShort(place.floor)) + '</p>' : '') + '</div></div>' +
        '<p class="topic-answer">' + esc(t.text) + '</p>' +
        '<div class="side-cta"><div class="status-btns">' + (place ? btn('Show me the way', 'go', { hero: true, arg: place.id })
          : '<button class="btn btn-ghost-dark mic-btn" data-act="voice">' + MIC + 'Ask Kira something else</button>') + '</div></div>'
      : '<p class="side-heading">Choose a topic</p><p class="topic-answer muted">Tap a topic, or ask Kira anything about the hotel and the area around it.</p>' +
        '<div class="side-cta"><div class="status-btns"><button class="btn btn-hero mic-btn" data-act="voice">' + MIC + 'Talk to Kira</button></div></div>';
    return { context: 'Hotel info',
      kira: t ? { mood: 'speaking', line: t.title + ' — ' + t.short.charAt(0).toLowerCase() + t.short.slice(1) + '.', speech: t.text }
              : { mood: 'speaking', line: 'What would you like to know? Pick a topic, or just ask me.' },
      html: '<div class="status-split fill"><section class="status-detail"><div class="topic-list" data-scroll="topics">' + rows + '</div></section>' +
        '<aside class="status-actions is-summary info-side" aria-label="' + (t ? esc(t.title) : 'Answer') + '">' + aside + '</aside></div>' };
  };

  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognizing = false;

  VIEWS.voice = function () {
    var v = ui.voice, a = !v.busy && !v.typing && ui.answer;
    var kira = v.busy === 'thinking' ? { mood: 'thinking', line: '“' + v.typing + '”', caption: 'Thinking…' }
      : v.typing ? { mood: 'listening', line: '“' + v.typing + '”', caption: 'Listening…' }
      : recognizing ? { mood: 'listening', line: 'I’m listening — where would you like to go?', caption: 'Listening…' }
      : ui.reply ? { mood: 'speaking', line: ui.reply }
      : { mood: 'idle', line: Recognition ? 'Ask me anything about the hotel, or where something is.' : 'Type what you’d like to know below, or tap the example.' };
    var place = a && a.place && H.place(a.place);
    var card = place
      ? '<div class="answer-card"><img src="' + ICON + place.icon + '.png" alt="" width="44" height="44"><div><p class="name">' + esc(place.name) + '</p><p class="info">' + esc(floorShort(place.floor)) + (H.openStatus(place) ? ' · ' + esc(H.openStatus(place).text) : '') + '</p></div></div>' +
        btn('Show me the way', 'go', { hero: true, arg: place.id })
      : '';
    var off = v.busy ? ' disabled' : '';
    // one example at a time, in plain text — rotateTry() swaps it every few seconds; tapping it asks it
    var tryLine = '<button class="try-line" id="try-line" data-act="say" data-arg="' + esc(PHRASES[tryIdx]) + '"' + off + '>Try saying <span>“' + esc(PHRASES[tryIdx]) + '”</span></button>';
    return { context: 'Talk to Kira', kira: kira,
      html: '<div class="voice-panel">' + (place ? '<div class="voice-answer">' + card + '</div>' : tryLine) +
        '<div class="voice-compose"><form class="voice-row" data-form="voice"><input class="text-field" id="voice-text" data-model="voice.text" placeholder="Or type your question…" value="' + esc(v.text) + '" aria-label="Ask Kira" autocomplete="off"' + off + '>' +
        '<button class="send-btn" type="submit" aria-label="Send"' + off + '>' + SEND + '</button></form>' +
        (Recognition ? '<button class="btn mic-btn ' + (recognizing ? 'btn-ghost-dark live' : place ? 'btn-ghost-dark' : 'btn-hero') + '" data-act="mic"' + off + '>' + MIC + (recognizing ? 'Stop listening' : 'Talk to Kira') + '</button>' : '') + '</div></div>' };
  };
  var tryIdx = 0;
  function rotateTry() {
    var el = ui.view === 'voice' && document.getElementById('try-line');
    if (!el || el.disabled) return;
    tryIdx = (tryIdx + 1) % PHRASES.length;
    el.classList.add('out');
    setTimeout(function () {
      el.dataset.arg = PHRASES[tryIdx];
      el.querySelector('span').textContent = '“' + PHRASES[tryIdx] + '”';
      el.classList.remove('out');
    }, 320);
  }
  setInterval(rotateTry, 3600);

  /* ---------------- One bento grid, two panels ----------------
     home  → the Kira panel fills the screen: the welcome, the building turning behind it
     voice → the Kira panel stays full width and becomes the conversation
     flows → the other panel grows to full width (find a place, hotel info, directions) */

  var panelKeys = { ai: '' }, lastView = null, lastMode = null;
  function modeOf(view) { return view === 'home' || view === 'voice' ? 'kira' : 'service'; }

  function ensureShell() {
    if (body.dataset.layout === 'bento') return;
    body.dataset.layout = 'bento';
    body.className = 'tablet-body bento-home mode-kira state-idle';
    body.innerHTML = '<section class="bento bento-ai" id="panel-ai" aria-label="Kira"></section><section class="bento bento-services" id="panel-svc" aria-label="Find your way">' + flowShellHTML() + '</section>';
  }

  var animTimers = {};
  function play(el, cls, ms) {
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    clearTimeout(animTimers[el.id + cls]);
    animTimers[el.id + cls] = setTimeout(function () { el.classList.remove(cls); }, ms || 900);
  }

  function shortcut(act, icon, name) {
    return '<button class="shortcut" data-act="' + act + '"><img src="' + ICON + icon + '.png" alt="" width="36" height="36"><span class="name">' + esc(name) + '</span></button>';
  }
  // Welcome backdrop: a Dubai Marina skyline in two layers over the water, drawn once (same towers every time)
  var skyline = null;
  function skylineSVG() {
    if (skyline) return skyline;
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    function layer(base, minH, maxH, minW, maxW, cls) {
      var x = -10, d = '';
      while (x < 940) {
        var w = minW + rnd() * (maxW - minW), h = minH + rnd() * (maxH - minH), top = base - h, kind = rnd();
        if (kind < 0.18) d += 'M' + x + ' ' + base + 'V' + (top + 14) + 'L' + (x + w / 2) + ' ' + top + 'L' + (x + w) + ' ' + (top + 14) + 'V' + base + 'Z';            // pointed top
        else if (kind < 0.32) d += 'M' + x + ' ' + base + 'V' + top + 'H' + (x + w * 0.6) + 'L' + (x + w) + ' ' + (top + 18) + 'V' + base + 'Z';                    // sloped crown
        else if (kind < 0.42) d += 'M' + (x + w / 2 - 1) + ' ' + (top - 22) + 'H' + (x + w / 2 + 1) + 'V' + top + 'H' + (x + w) + 'V' + base + 'H' + x + 'V' + top + 'H' + (x + w / 2 - 1) + 'Z'; // spire
        else d += 'M' + x + ' ' + base + 'V' + top + 'H' + (x + w) + 'V' + base + 'Z';
        x += w + 2 + rnd() * 6;
      }
      return '<path class="' + cls + '" d="' + d + '"/>';
    }
    skyline = '<svg class="skyline" viewBox="0 0 920 260" preserveAspectRatio="xMidYMax slice">' +
      layer(214, 70, 200, 16, 34, 'far') + layer(214, 30, 120, 22, 44, 'near') +
      '<rect class="water" x="0" y="214" width="920" height="46"/>' +
      '<path class="shimmer" d="M60 228h90M240 236h60M420 226h120M640 234h80M780 228h70"/></svg>';
    return skyline;
  }
  var SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/>';
  var SOUND_ON = SPK + '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
  var SOUND_OFF = SPK + '<path d="m22 9-6 6M16 9l6 6"/></svg>';
  function soundBtnHTML() {
    return '<button class="nav-btn nav-icon-only sound-btn" data-act="mute" aria-pressed="' + ui.muted + '" aria-label="' + (ui.muted ? 'Unmute Kira' : 'Mute Kira') + '">' + (ui.muted ? SOUND_OFF : SOUND_ON) + '</button>';
  }
  function themeBtnHTML() {
    var light = document.documentElement.classList.contains('theme-light');
    return '<button class="nav-btn nav-icon-only" id="theme-btn" data-act="theme" aria-label="' + (light ? 'Switch to dark theme' : 'Switch to light theme') + '">' + (light ? MOON : SUN) + '</button>';
  }
  function homeKiraHTML() {
    return '<div class="welcome">' +
        '<div class="welcome-top"><div class="kiosk-status" id="kiosk-status" role="status"></div><div class="welcome-actions">' +
          themeBtnHTML() + soundBtnHTML() +
          '<button class="nav-btn" data-act="lang" aria-haspopup="dialog" aria-label="Language: English">' + GLOBE + 'EN</button>' +
          '<button class="nav-btn nav-help" data-act="help">' + LIFEBUOY + 'Help / Emergency</button></div></div>' +
        '<div class="welcome-bg" aria-hidden="true"><span class="orb o1"></span><span class="orb o2"></span><span class="orb o3"></span>' + skylineSVG() + '</div>' +
        '<div class="welcome-copy">' +
          '<button class="kira-tap" data-act="voice" aria-label="Talk to Kira"><div class="kira-photo-wrap"><img src="' + IMG.idle + '" alt="Kira"></div></button>' +
          '<p class="home-greeting">' + greeting() + '</p>' +
          '<p class="avatar-sub">Welcome to the Grand Marina. I’m Kira — ask me anything about the hotel, or let me show you the way.</p>' +
          '<div class="shortcuts">' + shortcut('places', 'place-all', 'Find a place') +
            '<button class="btn btn-hero talk-btn" data-act="voice">' + MIC + 'Talk to Kira</button>' +
            shortcut('info', 'info', 'Hotel info') + '</div>' +
        '</div>' +
      '</div>';
  }
  function voiceShellHTML() {
    return '<div class="panel-head"><button class="nav-btn back-btn" data-act="back">' + BACK + 'Back</button><p class="panel-title">Talk to Kira</p>' + soundBtnHTML() + HELP_MINI + '</div>' +
      '<div class="voice-center"><div class="kira-stage" id="kira-big"></div><div class="voice-side" id="voice-col"></div></div>';
  }
  function flowShellHTML() {
    return '<div class="panel-head"><button class="nav-btn back-btn" data-act="back">' + BACK + 'Back</button><p class="panel-title" id="flow-title"></p><div class="kira-mini" id="kira-mini"></div>' + soundBtnHTML() + HELP_MINI + '</div>' +
      '<div class="task-col flow-body" id="task-col"></div>';
  }

  /* ---------------- 3D map ----------------
     map3d.js loads as a module after this file; it calls back with 'kira-map-ready'.
     If WebGL or the CDN isn't available, the steps on the right still guide the way. */

  var mapKey = '', mapFailed = false;
  function mountMap() {
    var slot = ui.view === 'directions' && document.getElementById('map-slot');
    if (!slot) return;
    if (mapFailed || !window.KiraMap) {
      slot.innerHTML = '<p class="map-fallback">' + (mapFailed ? 'The 3D map isn’t available on this screen right now — the steps on the right will guide you.' : 'Loading the map…') + '</p>';
      return;
    }
    try {
      KiraMap.attach(slot);
      if (ui.place !== mapKey) { mapKey = ui.place; KiraMap.show(currentRoute()); }
    } catch (e) { mapFailed = true; mountMap(); }
  }
  function markStep(i) {
    ui.step = i;
    body.querySelectorAll('.dir-step').forEach(function (el) { el.classList.toggle('on', +el.dataset.step === i); });
  }
  window.addEventListener('kira-map-ready', function () {
    KiraMap.onStep = markStep;
    KiraMap.setTheme(document.documentElement.classList.contains('theme-light'));
    render();
  });
  setTimeout(function () { if (!window.KiraMap) { mapFailed = true; render(); } }, 12000);

  /* ---------------- Render ---------------- */

  function render() {
    var active = document.activeElement, focusId = active && active.id, selStart = null;
    try { selStart = active && active.selectionStart; } catch (e) {}
    var scrolls = {};
    body.querySelectorAll('[data-scroll]').forEach(function (el) { scrolls[el.dataset.scroll] = [el.scrollTop, el.scrollLeft]; });

    ensureShell();
    var v = ui.view === 'home' ? null : VIEWS[ui.view](); // a view can send us home (returns null)
    var mode = modeOf(ui.view), viewChanged = ui.view !== lastView;
    ['home', 'service', 'kira'].forEach(function (m) { body.classList.toggle('mode-' + m, m === mode); });
    var ai = document.getElementById('panel-ai'), svc = document.getElementById('panel-svc');
    var aiKey = ui.view === 'voice' ? 'voice' : 'home';
    if (panelKeys.ai !== aiKey) { panelKeys.ai = aiKey; ai.innerHTML = aiKey === 'voice' ? voiceShellHTML() : homeKiraHTML(); kiraKey = ''; play(ai, 'swap', 1100); }
    var svcOpened = mode === 'service' && lastMode !== 'service';
    if (svcOpened) { kiraKey = ''; play(svc, 'swap', 1100); }
    lastMode = mode;

    if (ui.view === 'home') {
      setMood('idle'); lastLine = '';
    } else if (ui.view === 'voice') {
      setKira(v.kira, 'kira-big', 'big');
      var vc = document.getElementById('voice-col');
      vc.innerHTML = v.html;
      if (viewChanged) play(vc, 'enter');
    } else {
      document.getElementById('flow-title').textContent = v.context;
      setKira(v.kira, 'kira-mini', 'mini');
      var tc = document.getElementById('task-col');
      tc.innerHTML = v.html;
      if (viewChanged && !svcOpened) play(tc, 'enter');
    }
    lastView = ui.view;
    mountMap();

    body.querySelectorAll('[data-scroll]').forEach(function (el) { var p = scrolls[el.dataset.scroll]; if (p) { el.scrollTop = p[0]; el.scrollLeft = p[1]; } });
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el && el !== document.activeElement) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch (e) {} }
    }
    renderOverlay();
    renderStatus();
  }

  /* ---------------- Where, time & weather (top of the welcome screen) — same weather source as the guest tablet ---------------- */

  var WX = {
    sunny: { file: 'wx-sunny', label: 'Sunny' }, clear: { file: 'wx-clear', label: 'Clear' }, partly: { file: 'wx-partly', label: 'Partly cloudy' },
    cloudy: { file: 'wx-cloudy', label: 'Cloudy' }, rain: { file: 'wx-rain', label: 'Rain' }, storm: { file: 'wx-storm', label: 'Thunderstorm' }
  };
  var weather = { code: null, temp: 24, isDay: null };
  var WX_FORCE = ((/[?&]weather=(\w+)/.exec(location.search) || [])[1] || '').toLowerCase();
  function wxKind() {
    if (WX[WX_FORCE]) return WX_FORCE;
    var day = weather.isDay != null ? weather.isDay : (function (h) { return h >= 6 && h < 18; })(new Date().getHours());
    var c = weather.code;
    if (c == null || c <= 1) return day ? 'sunny' : 'clear';
    if (c >= 95) return 'storm';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
    if (c === 2) return day ? 'partly' : 'cloudy';
    return 'cloudy';
  }
  function loadWeather() {
    if (!window.fetch) return;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=25.08&longitude=55.14&current=temperature_2m,weather_code,is_day')
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d || !d.current) return; weather.code = d.current.weather_code; weather.temp = Math.round(d.current.temperature_2m); weather.isDay = !!d.current.is_day; renderStatus(); })
      .catch(function () {});
  }
  var PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  function renderStatus() {
    var el = document.getElementById('kiosk-status');
    if (!el) return;
    var info = WX[wxKind()], key = info.file + '|' + weather.temp + '|' + F.time();
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.setAttribute('aria-label', KIOSK.label + ', ' + floorShort(KIOSK.floor) + '. ' + F.time() + ', ' + info.label + ', ' + weather.temp + ' degrees');
    el.innerHTML = '<span class="where">' + PIN + esc(KIOSK.label + ' · ' + floorShort(KIOSK.floor)) + '</span><span class="time">' + esc(F.time()) + '</span>' +
      '<span class="wx"><img src="' + ICON + info.file + '.png" alt="" width="26" height="26" title="' + esc(info.label) + '">' + weather.temp + '°C</span>';
  }
  function weatherText() { return 'It’s ' + weather.temp + '°C and ' + WX[wxKind()].label.toLowerCase() + ' in Dubai Marina right now.'; }

  /* ---------------- Help (sends a staff alert to the front desk) ---------------- */

  var overlayKey = '';
  function renderOverlay() {
    var hr = ui.helpId && S.find(ui.helpId);
    var key = (ui.overlay || '') + '|' + (hr ? hr.status : '');
    if (key === overlayKey) return;
    overlayKey = key;
    if (!ui.overlay) { overlay.innerHTML = ''; return; }
    var h = '';
    if (ui.overlay === 'help') {
      h = '<p class="task-title">How can we help?</p><p class="task-note">A member of our team can come to you here, at the ' + esc(KIOSK.label.toLowerCase()) + ' kiosk.</p>' +
        '<button class="btn btn-ghost-dark" data-act="help-assist">Ask a team member to come here</button>' +
        '<button class="btn btn-danger" data-act="help-emergency">Emergency — alert security now</button>' +
        btn('Close', 'overlay-close');
    } else if (ui.overlay === 'help-confirm') {
      h = '<p class="task-title">Alert security and the duty manager?</p><p class="task-note">They’ll come to this kiosk (' + esc(KIOSK_NAME) + ') immediately.</p>' +
        '<div class="btn-row">' + btn('Cancel', 'overlay-close') + '<button class="btn btn-danger" data-act="help-send" data-arg="emergency">Yes, alert them</button></div>';
    } else if (ui.overlay === 'help-sent') {
      var resolved = hr && hr.status === 'resolved';
      h = ui.helpKind === 'emergency'
        ? banner(resolved ? 'good' : 'warn', resolved ? 'The front desk has handled your alert' : 'Help is on the way', resolved ? '' : 'Security and the duty manager are coming to this kiosk. If you are in danger, dial 999.')
        : banner(resolved ? 'good' : 'pending', resolved ? 'A team member has seen your request' : 'A team member is on the way', resolved ? '' : 'Usually within 3 minutes — please stay near this screen.');
      h += '<button class="btn btn-brass" data-act="overlay-close">Close</button>';
    } else if (ui.overlay === 'lang') {
      var langs = [['English', 'EN', true], ['العربية', 'AR'], ['Русский', 'RU'], ['中文', 'ZH'], ['Français', 'FR'], ['Deutsch', 'DE']];
      h = '<p class="task-title">Language</p><p class="task-note">Kira understands visitors in any of these by voice. The on-screen translation isn’t part of this prototype yet.</p><div class="lang-list">' +
        langs.map(function (l) { return '<button class="quick-chip' + (l[2] ? ' selected' : '') + '"' + (l[2] ? ' data-act="overlay-close"' : ' disabled') + '><span>' + l[0] + '</span><span>' + (l[2] ? '✓' : 'Soon') + '</span></button>'; }).join('') +
        '</div>' + btn('Close', 'overlay-close');
    }
    overlay.innerHTML = '<div class="sheet-scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">' + h + '</div></div>';
  }

  /* ---------------- Understand a question ---------------- */

  var WAY = /\bwheres?\b|how (do|can|would) i (get|find|reach)|take me|directions?|way to|find (the|a)\b|go to|get to|show me|looking for|nearest|closest|which floor/;

  function understand(text) {
    var t = ' ' + text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9: -]/g, ' ').replace(/\s+/g, ' ') + ' ';
    if (/emergency|help me|ambulance|\bfire\b|danger|police|security/.test(t)) return { type: 'help' };
    if (/weather|temperature|how hot|raining/.test(t)) return { type: 'answer', title: 'Weather', text: weatherText() };
    if (/what time is it|the time now|time is it/.test(t)) return { type: 'answer', title: 'Time', text: 'It’s ' + F.time() + ' here in Dubai.' };
    var faq = H.FAQ.filter(function (f) { return f.re.test(t); })[0];
    var place = H.PLACES.filter(function (p) { return p.kw.test(t) || (/check ?-?in\b/.test(t) && p.id === 'frontdesk'); })[0];
    if (WAY.test(t) && place) return { type: 'route', place: place.id };
    if (faq) return { type: 'answer', title: faq.title, text: faq.text, place: faq.place };
    if (place) return { type: 'answer', title: place.name, text: placeAnswer(place), place: place.id };
    return { type: 'unknown' };
  }

  function act(intent, heard) {
    ui.heard = heard; ui.reply = ''; ui.answer = null;
    if (intent.type === 'help') { ui.overlay = 'help'; ui.view = 'home'; return; }
    if (intent.type === 'route') { openPlace(intent.place, true); return; }
    if (intent.type === 'answer') { ui.view = 'voice'; ui.reply = intent.text; ui.answer = { title: intent.title, place: intent.place }; return; }
    ui.view = 'voice';
    ui.reply = 'I can show you the way to anywhere in the hotel, or tell you about it — try “Where’s the pool?” or “What’s the Wi-Fi?”';
  }

  // Simulated speech: the words appear under Kira as she listens, she thinks, then answers.
  function hear(text) {
    text = String(text || '').trim();
    if (!text || ui.voice.busy) return;
    ui.view = 'voice'; ui.reply = ''; ui.answer = null; ui.voice.text = ''; ui.voice.busy = 'listening'; ui.voice.typing = '';
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

  var recognizer = null, heardSomething = false;
  function toggleMic() {
    if (!Recognition) return;
    if (recognizing && recognizer) { recognizer.stop(); return; }
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel(); // don't let the mic hear Kira
      heardSomething = false; ui.reply = ''; ui.answer = null;
      recognizer = new Recognition();
      recognizer.lang = 'en-GB'; recognizer.interimResults = true; recognizer.maxAlternatives = 1;
      recognizer.onresult = function (e) {
        var res = e.results[e.results.length - 1], txt = res[0].transcript;
        heardSomething = true; touched();
        if (res.isFinal) { recognizing = false; hear(txt); }
        else { ui.voice.typing = txt; render(); }
      };
      recognizer.onerror = function (e) {
        recognizing = false;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { ui.reply = 'I can’t use the microphone here — type your question below instead.'; heardSomething = true; }
        if (ui.view === 'voice') render();
      };
      recognizer.onend = function () {
        recognizing = false;
        if (ui.view !== 'voice') return;
        if (!heardSomething && !ui.voice.busy) { ui.voice.typing = ''; ui.reply = 'I didn’t catch that — tap “Talk to Kira” to try again.'; }
        render();
      };
      recognizer.start(); recognizing = true; render();
    } catch (e) { recognizing = false; ui.reply = 'The microphone isn’t available here — type your question below instead.'; render(); }
  }
  function stopMic() { if (recognizing && recognizer) { try { recognizer.abort(); } catch (e) {} recognizing = false; } }

  /* ---------------- Tap sounds (WebAudio; silent when muted) ---------------- */

  var audio = null;
  var TICK_ACTS = { say: 1, back: 1, replay: 1, 'zoom-in': 1, 'zoom-out': 1, 'place-cat': 1, topic: 1 };
  function sound(kind) {
    if (ui.muted || ui.volume <= 0) return;
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
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, n[3] * ui.volume * 1.25), t + n[1] + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + n[2]);
        o.connect(g); g.connect(audio.destination);
        o.start(t + n[1]); o.stop(t + n[1] + n[2] + 0.02);
      });
    } catch (e) {}
  }

  /* ---------------- Actions ---------------- */

  function go(view) { if (view !== 'voice') stopMic(); ui.view = view; render(); }
  function openPlace(id, fromVoice) {
    if (!H.place(id)) return;
    stopMic();
    if (!fromVoice) { ui.heard = ''; ui.reply = ''; ui.answer = null; }
    if (ui.place !== id) ui.step = 0;
    ui.place = id; ui.view = 'directions';
    render();
  }

  var HANDLERS = {
    home: function () { ui.heard = ''; ui.reply = ''; ui.answer = null; ui.overlay = null; ui.place = null; ui.dirFrom = null; go('home'); },
    back: function () {
      stopMic();
      if (ui.view === 'voice' && ui.voiceFrom && ui.voiceFrom !== 'home' && ui.voiceFrom !== 'voice' && VIEWS[ui.voiceFrom]) { ui.reply = ''; go(ui.voiceFrom); return; }
      if (ui.view === 'directions' && ui.dirFrom) { var from = ui.dirFrom; ui.dirFrom = null; go(from); return; }
      HANDLERS.home();
    },
    go: function (id) { ui.dirFrom = ui.view === 'places' || ui.view === 'info' ? ui.view : null; openPlace(id, false); },
    places: function () { go('places'); },
    'place-cat': function (c) { ui.placeCat = c; render(); },
    info: function () { ui.topic = null; go('info'); },
    topic: function (id) { ui.topic = id; render(); },
    replay: function () { markStep(0); if (window.KiraMap) KiraMap.replay(); },
    'zoom-in': function () { if (window.KiraMap) KiraMap.zoom(1); },
    'zoom-out': function () { if (window.KiraMap) KiraMap.zoom(-1); },
    voice: function () {
      if (ui.view === 'voice') return;
      ui.voiceFrom = ui.view; ui.reply = ''; ui.answer = null; ui.voice.text = ''; ui.voice.typing = '';
      go('voice');
      if (Recognition) toggleMic();
    },
    say: function (a) { hear(a); },
    mic: toggleMic,
    help: function () { ui.overlay = 'help'; render(); },
    lang: function () { ui.overlay = 'lang'; render(); },
    theme: function () {
      var light = document.documentElement.classList.toggle('theme-light');
      try { localStorage.setItem('kira-kiosk-theme', light ? 'light' : 'dark'); } catch (e) {}
      if (window.KiraMap) KiraMap.setTheme(light);
      var tb = document.getElementById('theme-btn');
      if (tb) tb.outerHTML = themeBtnHTML();
    },
    mute: function () {
      ui.muted = !ui.muted;
      if (ui.muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      try { localStorage.setItem('kira-kiosk-muted', ui.muted ? '1' : '0'); } catch (e) {}
      Array.prototype.forEach.call(tablet.querySelectorAll('.sound-btn'), function (b) { b.outerHTML = soundBtnHTML(); });
      sound('tick');
    },
    'overlay-close': function () { ui.overlay = null; render(); },
    scrim: function () { if (ui.overlay !== 'help-confirm') { ui.overlay = null; render(); } },
    'help-assist': function () { HANDLERS['help-send']('assist'); },
    'help-emergency': function () { ui.overlay = 'help-confirm'; render(); },
    'help-send': function (kind) {
      var r = S.createRequest({ dept: 'help', room: KIOSK.label, kiosk: KIOSK_NAME, kind: kind, channel: 'kiosk',
        title: kind === 'emergency' ? 'Emergency at the ' + KIOSK.label.toLowerCase() + ' kiosk' : 'Staff asked to the ' + KIOSK.label.toLowerCase() + ' kiosk' });
      ui.helpKind = kind; ui.helpId = r.id; ui.overlay = 'help-sent';
      speak(kind === 'emergency' ? 'Help is on the way.' : 'A member of our team is on the way to you.');
      render();
    }
  };

  tablet.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled || !tablet.contains(el)) return;
    if (el.dataset.act === 'scrim' && e.target !== el) return; // clicks inside the sheet
    var fn = HANDLERS[el.dataset.act];
    if (!fn) return;
    if (el.classList.contains('place-tile') || el.classList.contains('shortcut')) sound('select');
    else if (TICK_ACTS[el.dataset.act]) sound('tick');
    e.preventDefault(); fn(el.dataset.arg);
  });
  tablet.addEventListener('wheel', function (e) {
    var row = e.target.closest && e.target.closest('.home-active');
    if (!row || row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    row.scrollLeft += e.deltaY; e.preventDefault();
  }, { passive: false });
  tablet.addEventListener('input', function (e) {
    var path = e.target.dataset && e.target.dataset.model;
    if (!path) return;
    var parts = path.split('.'), obj = ui;
    while (parts.length > 1) obj = obj[parts.shift()];
    obj[parts[0]] = e.target.value;
  });
  tablet.addEventListener('submit', function (e) {
    if (e.target.dataset.form === 'voice') { e.preventDefault(); hear(ui.voice.text); }
  });

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.overlay) { ui.overlay = null; render(); } });

  /* ---------------- A public screen resets itself ----------------
     After a minute untouched it returns to the welcome screen, so the next visitor never
     lands on someone else's directions or question. */

  var lastTouch = Date.now();
  function touched() { lastTouch = Date.now(); }
  ['pointerdown', 'keydown', 'input', 'wheel'].forEach(function (ev) { document.addEventListener(ev, touched, true); });
  setInterval(function () {
    if (Date.now() - lastTouch < IDLE_MS || ui.voice.busy || recognizing) return;
    var helpOpen = ui.overlay === 'help-sent' && ui.helpId && S.find(ui.helpId) && S.find(ui.helpId).status === 'open';
    if (helpOpen) return; // someone is on their way here — keep that on screen
    if (ui.view === 'home' && !ui.overlay) return;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    ui.view = 'home'; ui.place = null; ui.answer = null; ui.reply = ''; ui.heard = ''; ui.overlay = null; ui.dirFrom = null; ui.topic = null; ui.placeCat = 'popular';
    ui.voice = { text: '', typing: '', busy: false };
    render();
  }, 5000);

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

  var placeHash = /^#to=(\w+)/.exec(location.hash);
  if (placeHash && H.place(placeHash[1])) { ui.place = placeHash[1]; ui.view = 'directions'; }

  S.subscribe(function (s) {
    if (s.seededAt !== seededAt) { seededAt = s.seededAt; ui.helpId = null; if (ui.overlay === 'help-sent') ui.overlay = null; }
    renderOverlay();
  });
  render();
  loadWeather();
  setInterval(loadWeather, 15 * 60000);
  ui$.every(renderStatus, 15000);
  ui$.launcherPill('../index.html');
})();
