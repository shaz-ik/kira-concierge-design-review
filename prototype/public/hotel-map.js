/* Kira Concierge — the Grand Marina's floor plan, for the public hall kiosk.
   One source for the 3D map (map3d.js) and the kiosk screens (public.js):
   floors, the areas drawn on each floor, the walking graph, the places a
   visitor can be guided to, and the questions Kira answers at the kiosk.
   Units are metres. x runs left → right as seen from the main entrance,
   z runs back (−) → front (+); the entrance is at the front of the ground floor. */
(function () {
  'use strict';

  var GAP = 7; // vertical spacing between stacked floors on the map

  var FLOORS = [
    { id: 'G',  level: 0, stack: 0, name: 'Ground floor', short: 'G', theme: 'Lobby' },
    { id: 'L1', level: 1, stack: 1, name: 'Level 1',      short: '1', theme: 'Meetings & events' },
    { id: 'L2', level: 2, stack: 2, name: 'Level 2',      short: '2', theme: 'Wellness' },
    { id: 'L8', level: 8, stack: 4, name: 'Level 8',      short: '8', theme: 'Rooftop' }
  ];
  var GUEST_FLOORS = { stack: 3, label: 'Levels 3 – 7 · Guest rooms' };
  var FOOTPRINT = [-32, -20, 32, 20];
  var LIFT_CORE = [-6, -19, 6, -10];

  // What's drawn on each floor. rect: [x0, z0, x1, z1]. kind: room | water | core | outdoor
  var AREAS = [
    { floor: 'G',  place: 'frontdesk',  label: 'Front desk',        rect: [-30, 0, -16, 11],   kind: 'room' },
    { floor: 'G',  place: 'concierge',  label: 'Concierge',         rect: [-30, 13, -16, 19],  kind: 'room' },
    { floor: 'G',  place: 'lounge',     label: 'Lobby Lounge',      rect: [14, 2, 30, 19],     kind: 'room' },
    { floor: 'G',  place: 'restaurant', label: 'Marina Kitchen',    rect: [14, -19, 30, -1],   kind: 'room' },
    { floor: 'G',  place: 'restrooms',  label: 'Restrooms',         rect: [-18, -19, -8, -10], kind: 'room' },
    { floor: 'G',  place: 'entrance',   label: 'Main entrance',     rect: [-10, 20, 10, 27],   kind: 'outdoor' },
    { floor: 'L1', place: 'meeting',    label: 'Meeting rooms',     rect: [-30, 2, -9, 19],    kind: 'room' },
    { floor: 'L1', place: 'ballroom',   label: 'Al Bahar Ballroom', rect: [8, -19, 30, 19],    kind: 'room' },
    { floor: 'L1', place: 'prayer',     label: 'Prayer room',       rect: [-30, -19, -16, -9], kind: 'room' },
    { floor: 'L2', place: 'gym',        label: 'Fitness centre',    rect: [-30, -3, -9, 19],   kind: 'room' },
    { floor: 'L2', place: 'spa',        label: 'Marina Spa',        rect: [9, -3, 30, 19],     kind: 'room' },
    { floor: 'L2', place: 'kids',       label: 'Kids club',         rect: [9, -19, 30, -9],    kind: 'room' },
    { floor: 'L8', place: 'pool',       label: 'Rooftop pool',      rect: [-24, 2, 14, 17],    kind: 'water' },
    { floor: 'L8', place: 'poolbar',    label: 'Sky Bar',           rect: [18, -19, 30, -7],   kind: 'room' },
    { floor: 'L8', place: null,         label: 'Cabanas',           rect: [18, 3, 30, 17],     kind: 'room' }
  ];

  // Walking graph: nodes sit in corridors and at doors; lifts join the floors.
  var NODES = {
    kioskG:  ['G', 6, 6],    gHub: ['G', 0, 6],     gDesk: ['G', -15, 6],  gFront: ['G', 0, 16],  gBell: ['G', -15, 16],
    gEntrance: ['G', 0, 23], gLounge: ['G', 13, 6], gBack: ['G', 0, -5],   gLift: ['G', 0, -9],
    gWCx: ['G', -13, -5],    gWC: ['G', -13, -9],   gRest: ['G', 13, -5],
    l1Lift: ['L1', 0, -9],   l1Back: ['L1', 0, -5], l1Hub: ['L1', 0, 4],   l1Ball: ['L1', 7, 4],  l1Mid: ['L1', 0, 9],
    l1Meet: ['L1', -8, 9],   l1West: ['L1', -23, -5], l1Prayer: ['L1', -23, -8],
    l2Lift: ['L2', 0, -9],   l2Back: ['L2', 0, -5], l2Hub: ['L2', 0, 6],   l2Gym: ['L2', -8, 6],  l2Spa: ['L2', 8, 6],
    l2KidsX: ['L2', 16, -5], l2Kids: ['L2', 16, -8], kioskL2: ['L2', -5, -5],
    l8Lift: ['L8', 0, -9],   l8Back: ['L8', 0, -5], l8Pool: ['L8', 0, 1],  l8Bar: ['L8', 17, -5]
  };
  var EDGES = [
    ['kioskG', 'gHub'], ['gHub', 'gDesk'], ['gHub', 'gFront'], ['gFront', 'gBell'], ['gFront', 'gEntrance'], ['kioskG', 'gLounge'],
    ['gHub', 'gBack'], ['gBack', 'gLift'], ['gBack', 'gWCx'], ['gWCx', 'gWC'], ['gBack', 'gRest'],
    ['l1Lift', 'l1Back'], ['l1Back', 'l1Hub'], ['l1Hub', 'l1Ball'], ['l1Hub', 'l1Mid'], ['l1Mid', 'l1Meet'], ['l1Back', 'l1West'], ['l1West', 'l1Prayer'],
    ['l2Lift', 'l2Back'], ['l2Back', 'l2Hub'], ['l2Hub', 'l2Gym'], ['l2Hub', 'l2Spa'], ['l2Back', 'l2KidsX'], ['l2KidsX', 'l2Kids'], ['kioskL2', 'l2Back'],
    ['l8Lift', 'l8Back'], ['l8Back', 'l8Pool'], ['l8Back', 'l8Bar']
  ];
  var LIFTS = ['gLift', 'l1Lift', 'l2Lift', 'l8Lift'];

  // Where a kiosk can stand (?kiosk=lobby | wellness)
  var KIOSKS = {
    lobby:    { id: 'lobby',    node: 'kioskG',  floor: 'G',  label: 'Lobby' },
    wellness: { id: 'wellness', node: 'kioskL2', floor: 'L2', label: 'Wellness floor' }
  };

  // Places a visitor can be guided to.
  //   where    — said when the place is on the kiosk's own floor
  //   fromLift — said after the lift ride, facing out of the lift doors
  //   open     — [opens, closes] in hours, for "Open now · until 10 PM"
  var PLACES = [
    { id: 'frontdesk',  name: 'Front desk', say: 'The front desk',            icon: 'place-frontdesk', floor: 'G',  node: 'gDesk',     info: 'Check-in, keys and help', hours: 'Open 24 hours',
      where: 'across the lobby, opposite the lounge', fromLift: 'walk into the lobby — the front desk is on your right',
      kw: /front desk|reception|lobby desk|room keys?|key card/ },
    { id: 'concierge',  name: 'Concierge & bell desk', say: 'The concierge', icon: 'place-concierge', floor: 'G',  node: 'gBell',     info: 'Tours, taxis and luggage storage', hours: '7 AM – 11 PM', open: [7, 23],
      where: 'by the main doors, next to the front desk', fromLift: 'walk through the lobby towards the main doors — the concierge is on your right',
      kw: /concierge|bell ?desk|luggage|bags?\b|suitcases?|tours?\b/ },
    { id: 'restaurant', name: 'Marina Kitchen',        icon: 'dining',          floor: 'G',  node: 'gRest',     info: 'All-day dining and breakfast', hours: '6:30 AM – 11 PM', open: [6.5, 23],
      where: 'at the back of the lobby, beside the lifts', fromLift: 'turn left — Marina Kitchen is at the end of the corridor',
      kw: /restaurant|marina kitchen|breakfast|dinner|lunch|buffet|somewhere to eat|food/ },
    { id: 'lounge',     name: 'Lobby Lounge', say: 'The Lobby Lounge',          icon: 'place-lounge',    floor: 'G',  node: 'gLounge',   info: 'Coffee, tea and light bites', hours: '7 AM – midnight', open: [7, 24],
      where: 'on the window side of the lobby, opposite the front desk', fromLift: 'walk into the lobby — the Lobby Lounge is on your left',
      kw: /lounge|coffee|caf[eé]|\btea\b|cake/ },
    { id: 'restrooms',  name: 'Restrooms', say: 'The restrooms', plural: true,             icon: 'place-restrooms', floor: 'G',  node: 'gWC',       info: 'Accessible restrooms and baby change', hours: '',
      where: 'along the back corridor, behind the lobby', fromLift: 'turn right along the back corridor — the restrooms are on your right',
      kw: /restrooms?|toilets?|bathrooms?|washrooms?|\bwc\b|\bloo\b|ladies|gents|baby chang/ },
    { id: 'entrance',   name: 'Main entrance & taxis', say: 'The main entrance', icon: 'place-entrance',  floor: 'G',  node: 'gEntrance', info: 'Taxis, valet and the Marina', hours: '',
      where: 'straight ahead at the front of the lobby', fromLift: 'walk straight through the lobby and out of the main doors',
      kw: /entrance|exit|taxis?\b|\bcabs?\b|valet|uber|careem|way out|outside|parking/ },
    { id: 'lifts',      name: 'Lifts', say: 'The lifts', plural: true,                 icon: 'place-lifts',     floor: 'G',  node: 'gLift',     info: 'To every floor', hours: '',
      where: 'at the back of the lobby', fromLift: 'you’re there',
      kw: /\blifts?\b|elevators?/ },
    { id: 'meeting',    name: 'Meeting rooms', say: 'The meeting rooms', plural: true,         icon: 'place-meeting',   floor: 'L1', node: 'l1Meet',    info: 'Meeting rooms 1 – 3 and business centre', hours: '7 AM – 10 PM', open: [7, 22],
      where: 'across the hall from the ballroom', fromLift: 'walk ahead and keep right — the meeting rooms are on your right',
      kw: /meeting|conference room|business cent|boardroom|printer|printing/ },
    { id: 'ballroom',   name: 'Al Bahar Ballroom', say: 'The Al Bahar Ballroom',     icon: 'place-ballroom',  floor: 'L1', node: 'l1Ball',    info: 'Weddings, galas and events', hours: '',
      where: 'across the hall from the meeting rooms', fromLift: 'walk ahead — the ballroom doors are on your left',
      kw: /ballroom|al bahar|wedding|gala|conference hall|tonight.s event/ },
    { id: 'prayer',     name: 'Prayer room', say: 'The prayer room',           icon: 'place-prayer',    floor: 'L1', node: 'l1Prayer',  info: 'Quiet room with an ablution area', hours: 'Open 24 hours',
      where: 'at the end of the back corridor', fromLift: 'turn right along the corridor — the prayer room is at the end, on your right',
      kw: /pray|prayer|mosque|masjid|qibla|wudu|ablution/ },
    { id: 'gym',        name: 'Fitness centre', say: 'The fitness centre',        icon: 'place-gym',       floor: 'L2', node: 'l2Gym',     info: 'Cardio, weights and classes', hours: 'Open 24 hours',
      where: 'across the hall from the spa', fromLift: 'walk ahead — the fitness centre is on your right',
      kw: /\bgym\b|fitness|work ?out|exercise|weights|treadmill/ },
    { id: 'spa',        name: 'Marina Spa',            icon: 'place-spa',       floor: 'L2', node: 'l2Spa',     info: 'Massages, sauna and steam', hours: '10 AM – 10 PM', open: [10, 22],
      where: 'across the hall from the fitness centre', fromLift: 'walk ahead — the spa is on your left',
      kw: /\bspa\b|massage|sauna|steam|treatments?|facial|hammam/ },
    { id: 'kids',       name: 'Kids club', say: 'The kids club',             icon: 'place-kids',      floor: 'L2', node: 'l2Kids',    info: 'Ages 4 – 12, with our team', hours: '9 AM – 7 PM', open: [9, 19],
      where: 'at the end of the back corridor, behind the spa', fromLift: 'turn left along the corridor — the kids club is on your left',
      kw: /\bkids?\b|children|\bchild\b|play ?room|creche|nursery/ },
    { id: 'pool',       name: 'Rooftop pool', say: 'The rooftop pool',          icon: 'place-pool',      floor: 'L8', node: 'l8Pool',    info: 'Infinity pool and sun deck', hours: '7 AM – 10 PM', open: [7, 22],
      where: 'in the middle of the roof deck', fromLift: 'walk straight ahead onto the pool deck',
      kw: /\bpool\b|swim|rooftop|sun ?deck|sunbathe/ },
    { id: 'poolbar',    name: 'Sky Bar',               icon: 'place-poolbar',   floor: 'L8', node: 'l8Bar',     info: 'Drinks and bites by the pool', hours: '11 AM – 11 PM', open: [11, 23],
      where: 'beside the pool deck', fromLift: 'turn left — the Sky Bar is at the end of the deck',
      kw: /sky ?bar|\bbar\b|drinks?|cocktails?|mocktails?|juice/ }
  ];
  var POPULAR = ['frontdesk', 'restaurant', 'pool', 'gym', 'spa', 'restrooms'];

  // Questions Kira answers at the kiosk. Public answers only — nothing about any guest or room.
  // place: offers "Show me the way". Answers are short because Kira says them out loud.
  var FAQ = [
    { re: /wi-?fi|internet|password|network/, title: 'Wi-Fi', place: null,
      text: 'Join “GrandMarina-Guest” — there’s no password, just accept the terms on the welcome page. It’s free everywhere in the hotel.' },
    { re: /breakfast/, title: 'Breakfast', place: 'restaurant',
      text: 'Breakfast is served at Marina Kitchen on the ground floor, 6:30 to 10:30 AM every day.' },
    { re: /check ?-?in time|when.*check ?in|check ?in (at|from|time)|check ?-?out time|when.*check ?out|check ?out (at|by|time)|late check ?out/, title: 'Check-in & check-out', place: 'frontdesk',
      text: 'Check-in is from 3 PM and check-out is by 12 noon. For a late check-out, use the tablet in your room or ask the front desk.' },
    { re: /pool.*(open|close|hours|time)|(open|close|hours|time).*pool/, title: 'Rooftop pool', place: 'pool',
      text: 'The rooftop pool on Level 8 is open 7 AM to 10 PM. Towels are waiting by the pool.' },
    { re: /gym.*(open|close|hours|time)|(open|close|hours|time).*gym/, title: 'Fitness centre', place: 'gym',
      text: 'The fitness centre on Level 2 is open 24 hours — just tap your room key at the door.' },
    { re: /spa|massage|sauna/, title: 'Marina Spa', place: 'spa',
      text: 'Marina Spa on Level 2 is open 10 AM to 10 PM. You can book a treatment at the spa reception or at the front desk.' },
    { re: /airport|dxb|dwc|transfer/, title: 'Airport', place: 'entrance',
      text: 'Dubai International is about 35 minutes by taxi. Taxis wait at the main entrance, or the concierge can book a private transfer.' },
    { re: /metro|tram|public transport/, title: 'Metro & tram', place: 'entrance',
      text: 'The Dubai Marina tram stop is a 4-minute walk from the main entrance, and DMCC Metro station is about 10 minutes.' },
    { re: /beach|jbr/, title: 'JBR Beach', place: 'entrance',
      text: 'JBR Beach is about a 10-minute walk along the Marina, or 3 minutes by taxi. Beach towels are at the concierge.' },
    { re: /mall|shopping|shops?\b/, title: 'Shopping', place: 'entrance',
      text: 'Dubai Marina Mall is a 5-minute walk from the main entrance. Mall of the Emirates is about 15 minutes by taxi.' },
    { re: /pharmacy|chemist|doctor|clinic|medicine|sick|unwell/, title: 'Health', place: 'frontdesk',
      text: 'There’s a pharmacy in Marina Mall, 5 minutes away. If you need a doctor, the front desk can arrange one at any hour.' },
    { re: /atm|cash|currency|exchange|money/, title: 'Money', place: 'frontdesk',
      text: 'There’s an ATM in the lobby beside the lounge, and the front desk can change currency for hotel guests.' },
    { re: /what.s on|whats on|tonight|event|entertainment|music|live/, title: 'What’s on today', place: 'lounge',
      text: 'Tonight there’s live oud music in the Lobby Lounge from 8 PM, and sunset mocktails at the Sky Bar from 5 PM.' },
    { re: /luggage|bags|store my|left luggage/, title: 'Luggage', place: 'concierge',
      text: 'The bell desk by the main doors will hold your luggage for free — before check-in or after check-out.' },
    { re: /kids|children|child/, title: 'Kids club', place: 'kids',
      text: 'The kids club on Level 2 welcomes ages 4 to 12, 9 AM to 7 PM, with our team looking after them.' },
    { re: /room service|order food|my room|housekeeping|towels/, title: 'In your room', place: null,
      text: 'For anything to your room — food, towels or a late check-out — use the Kira tablet in your room, or call the front desk.' },
    { re: /smok/, title: 'Smoking', place: 'entrance',
      text: 'The hotel is non-smoking inside. There’s a smoking area outside, to the right of the main entrance.' },
    { re: /dress code|what to wear/, title: 'Dress code', place: null,
      text: 'Smart casual in Marina Kitchen and the Sky Bar after 6 PM. Swimwear is welcome on the pool deck only.' }
  ];

  /* ---------------- Lookups ---------------- */

  function floor(id) { return FLOORS.filter(function (f) { return f.id === id; })[0]; }
  function floorY(id) { return floor(id).stack * GAP; }
  function place(id) { return PLACES.filter(function (p) { return p.id === id; })[0]; }
  function kiosk(id) { return KIOSKS[id] || KIOSKS.lobby; }
  function floorLabel(id) { var f = floor(id); return f.id === 'G' ? 'Ground floor' : f.name + ' · ' + f.theme; }

  // "Open now · until 10 PM" / "Closed · opens 7 AM" from place.open
  function hourText(h) {
    h = h % 24;
    var mins = Math.round((h % 1) * 60), hr = Math.floor(h);
    if (hr === 0 && !mins) return 'midnight';
    if (hr === 12 && !mins) return 'noon';
    return ((hr % 12) || 12) + (mins ? ':' + (mins < 10 ? '0' : '') + mins : '') + ' ' + (hr < 12 ? 'AM' : 'PM');
  }
  function openStatus(p, now) {
    if (!p.open) return p.hours ? { open: true, text: p.hours } : null;
    var d = now || new Date(), h = d.getHours() + d.getMinutes() / 60;
    var isOpen = h >= p.open[0] && h < p.open[1];
    return isOpen ? { open: true, text: 'Open now · until ' + hourText(p.open[1]) } : { open: false, text: 'Closed · opens ' + hourText(p.open[0]) };
  }

  /* ---------------- Routing ---------------- */

  var adj = {};
  function link(a, b, cost) { (adj[a] = adj[a] || []).push({ to: b, cost: cost }); (adj[b] = adj[b] || []).push({ to: a, cost: cost }); }
  function dist2d(a, b) { var A = NODES[a], B = NODES[b]; return Math.sqrt(Math.pow(A[1] - B[1], 2) + Math.pow(A[2] - B[2], 2)); }
  EDGES.forEach(function (e) { link(e[0], e[1], dist2d(e[0], e[1])); });
  for (var i = 1; i < LIFTS.length; i++) {
    var lv = Math.abs(floor(NODES[LIFTS[i]][0]).level - floor(NODES[LIFTS[i - 1]][0]).level);
    link(LIFTS[i - 1], LIFTS[i], 10 + lv * 3);
  }

  function shortestPath(from, to) {
    var best = {}, prev = {}, done = {};
    best[from] = 0;
    for (;;) {
      var u = null;
      Object.keys(best).forEach(function (n) { if (!done[n] && (u === null || best[n] < best[u])) u = n; });
      if (u === null) return null;
      if (u === to) break;
      done[u] = true;
      (adj[u] || []).forEach(function (e) {
        var c = best[u] + e.cost;
        if (best[e.to] === undefined || c < best[e.to]) { best[e.to] = c; prev[e.to] = u; }
      });
    }
    var path = [to];
    while (path[0] !== from) path.unshift(prev[path[0]]);
    return path;
  }

  function lower(s) { return /^The /.test(s) ? 't' + s.slice(1) : s; }
  function metres(m) { return m < 8 ? 'a few metres' : 'about ' + Math.max(5, Math.round(m / 5) * 5) + ' m'; }
  function timeText(sec) { return sec < 50 ? 'under a minute' : 'about ' + Math.max(1, Math.round(sec / 60)) + ' min'; }

  /**
   * Route from a kiosk to a place. Returns
   *   { place, from, to, legs: [{ type: 'walk' | 'lift', floor, toFloor, nodes, dist }], steps: [text per leg],
   *     floors: [floor ids on the route], walk (m), secs, time, line (what Kira says) }
   */
  function route(kioskId, placeId) {
    var k = kiosk(kioskId), p = place(placeId);
    if (!p) return null;
    var subject = p.say || p.name, verb = p.plural ? 'are' : 'is';
    var path = shortestPath(k.node, p.node);
    if (!path) return null;
    var legs = [], cur = null;
    path.forEach(function (n, idx) {
      var f = NODES[n][0];
      if (cur && cur.type === 'walk' && cur.floor === f) { cur.nodes.push(n); return; }
      if (cur && cur.floor !== f) legs.push({ type: 'lift', floor: cur.floor, toFloor: f, nodes: [path[idx - 1], n], dist: 0 });
      cur = { type: 'walk', floor: f, nodes: [n], dist: 0 };
      legs.push(cur);
    });
    // a lift ride through several floors is one leg
    legs = legs.reduce(function (out, l) {
      var last = out[out.length - 1];
      if (l.type === 'walk' && l.nodes.length === 1 && last && last.type === 'lift') return out; // the lift lobby we just pass through
      if (l.type === 'lift' && last && last.type === 'lift') { last.toFloor = l.toFloor; last.nodes.push(l.nodes[1]); return out; }
      out.push(l);
      return out;
    }, []);
    var walk = 0;
    legs.forEach(function (l) {
      if (l.type !== 'walk') return;
      for (var j = 1; j < l.nodes.length; j++) l.dist += dist2d(l.nodes[j - 1], l.nodes[j]);
      walk += l.dist;
    });
    var lifts = legs.filter(function (l) { return l.type === 'lift'; });
    var secs = walk / 1.2 + lifts.reduce(function (s, l) { return s + 30 + 4 * Math.abs(floor(l.toFloor).level - floor(l.floor).level); }, 0);
    var steps = legs.map(function (l, idx) {
      if (l.type === 'lift') {
        var up = floor(l.toFloor).level > floor(l.floor).level;
        return 'Take a lift ' + (up ? 'up' : 'down') + ' to ' + (l.toFloor === 'G' ? 'the ground floor' : floorLabel(l.toFloor));
      }
      var last = idx === legs.length - 1;
      if (!last) return (idx === 0 ? 'Walk ' : 'Then walk ') + metres(l.dist) + ' to the lifts' + (l.floor === 'G' ? ' at the back of the lobby' : '');
      if (p.id === 'lifts' && idx === 0) return 'Walk ' + metres(l.dist) + ' — the lifts are ' + p.where;
      if (legs.length === 1) return 'Walk ' + metres(l.dist) + ' — ' + lower(subject) + ' ' + verb + ' ' + p.where;
      return 'Out of the lift, ' + p.fromLift + ' (' + metres(l.dist).replace('about ', '') + ')';
    });
    var floorsOn = [];
    legs.forEach(function (l) { [l.floor, l.toFloor].forEach(function (f) { if (f && floorsOn.indexOf(f) < 0) floorsOn.push(f); }); });
    var time = timeText(secs);
    // what Kira says — the walking time is already on screen
    var line = legs.length === 1
      ? subject + ' ' + verb + ' ' + p.where + '. Just follow the purple line.'
      : subject + ' ' + verb + ' on ' + (p.floor === 'G' ? 'the ground floor' : floor(p.floor).name) + ' — take a lift ' + (floor(p.floor).level > floor(k.floor).level ? 'up' : 'down') + ' and follow the purple line.';
    return { place: p, from: k, legs: legs, steps: steps, floors: floorsOn, walk: walk, secs: secs, time: time, line: line };
  }

  window.KiraHotel = {
    GAP: GAP, FLOORS: FLOORS, GUEST_FLOORS: GUEST_FLOORS, FOOTPRINT: FOOTPRINT, LIFT_CORE: LIFT_CORE,
    AREAS: AREAS, NODES: NODES, PLACES: PLACES, POPULAR: POPULAR, FAQ: FAQ, KIOSKS: KIOSKS,
    floor: floor, floorY: floorY, floorLabel: floorLabel, place: place, kiosk: kiosk, openStatus: openStatus, route: route
  };
})();
