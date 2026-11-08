(function () {
  'use strict';
  // ---------- data ----------
  // row: [sheetRow, artist, title, year, genre, minutes, songs, english, edition(-1 removed, 1 added), rating, date]
  const A = ALBUMS.map(r => ({ id: r[0], artist: r[1], title: r[2], year: r[3], genre: r[4], mins: r[5], songs: r[6],
    english: !!r[7], edition: r[8], baseRating: r[9], baseDate: r[10] }));
  A.forEach(a => {
    const t = TAGS[a.id] || [[], [], '', [], ''];
    a.style = t[0]; a.inst = t[1]; a.region = t[2]; a.mood = t[3]; a.desc = t[4];
  });
  const byId = new Map(A.map(a => [a.id, a]));
  const CURRENT = A.filter(a => a.edition !== -1).length;

  const MOODS = [
    { k: 'mellow', label: 'Mellow & reflective', sub: 'folk, jazz, country, blues', g: ['Folk', 'Jazz', 'Country', 'Blues', 'Soul'] },
    { k: 'loud', label: 'Loud & driving', sub: 'rock, punk, metal', g: ['Rock', 'Punk', 'Metal'] },
    { k: 'groove', label: 'Something to move to', sub: 'soul, funk, R&B, hip hop', g: ['Soul', 'Funk', 'RnB', 'Hip Hop', 'Afrobeat', 'Reggae', 'Ska', 'Cuban', 'Dance'] },
    { k: 'electric', label: 'Electronic & hypnotic', sub: 'electronic, dance', g: ['Electronic', 'Dance'] },
    { k: 'pop', label: 'Big hooks', sub: 'pop', g: ['Pop'] },
    { k: 'far', label: 'Somewhere unfamiliar', sub: 'non-English & world', far: true },
    { k: 'any', label: 'Surprise me', sub: 'anything goes' }
  ];
  const ERAS = [['any', 'Any era']].concat([1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020].map(d => [String(d), "'" + String(d).slice(2) + 's']));
  const TIMES = [['short', 'Under 40 min'], ['mid', '40–60 min'], ['long', 'Over an hour'], ['any', 'Any length']];
  const FAR_GENRES = ['African', 'Afrobeat', 'Cuban', 'Indian', 'Reggae', 'Ska'];
  const HUES = { Rock: '#d9483b', Pop: '#e889b5', 'Hip Hop': '#e0a526', Punk: '#9bd13b', Folk: '#b98a52', Electronic: '#36b5c9', Jazz: '#3e6fd8',
    Country: '#c9733a', Soul: '#a05bd1', Metal: '#8a8f99', RnB: '#d4567a', Dance: '#21b892', Funk: '#f07f2d', Blues: '#2d5fa8',
    Reggae: '#3f9d4a', Indian: '#e3622c', African: '#c08a1e', Afrobeat: '#d29a1f', Ska: '#6a6f7a', Cuban: '#c4433a' };

  // ---------- environment ----------
  // Three places the same code runs:
  //  - Android app: a native bridge does HTTP for us (no CORS limits) and offers voice dictation.
  //  - Claude artifact: the frame blocks requests to other sites, so ratings go to the sheet through "Write to sheet" links.
  //  - Normal website (GitHub Pages / your domain): talks to the Apps Script web app directly with fetch().
  const native = window.SpinNextAndroid || null;
  const inArtifact = !native && (
    !!(window.claude && typeof window.claude.use === 'function') ||
    /(^|\.)(claude\.ai|claudeusercontent\.com|anthropic\.com)$/.test(location.hostname));
  const ENV = native ? 'android' : inArtifact ? 'artifact' : 'web';

  // ---------- state + storage ----------
  let S = { now: null, nowSince: null, ratings: {}, skipped: [], history: [], settings: { url: '', token: '' }, prefs: { mood: 'any', era: 'any', time: 'any', incRemoved: false } };
  const LS_KEY = 'spinnext.v1';
  let dbRef = null, saveTimer = null;

  function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } }
  function lsSet(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) {} }
  function merge(saved) {
    if (!saved || typeof saved !== 'object') return;
    // Data read back from the store is frozen; work on a plain copy so ratings can be added.
    try { saved = JSON.parse(JSON.stringify(saved)); } catch (e) { return; }
    S = Object.assign(S, saved);
    S.ratings = saved.ratings || {}; S.skipped = saved.skipped || []; S.history = saved.history || [];
    S.settings = Object.assign({ url: '', token: '' }, saved.settings || {});
    S.prefs = Object.assign({ mood: 'any', era: 'any', time: 'any', incRemoved: false }, saved.prefs || {});
  }
  function unwrap(snap) {
    if (!snap) return null;
    if (typeof snap.data === 'function') return snap.data();
    if (snap.data && typeof snap.data === 'object') return snap.data;
    return snap;
  }
  async function connectDb() {
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      dbRef = db.collection('data/users/' + uid).doc('spinnext');
      const saved = unwrap(await dbRef.get());
      if (saved && saved.ratings) { merge(saved); lsSet(S); render(); }
      else { await dbRef.set(JSON.parse(JSON.stringify(S))); }
    } catch (e) { dbRef = null; }
  }
  function persist() {
    lsSet(S);
    if (!dbRef) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { dbRef.set(JSON.parse(JSON.stringify(S))).catch(() => {}); }, 400);
  }

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fmtMins = m => m == null ? 'length n/a' : (m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min');
  const fmtR = r => (r % 1 ? Math.floor(r) + '½' : String(r));
  const cat = id => 'No. ' + String(id - 1).padStart(4, '0');
  const spotify = a => 'https://open.spotify.com/search/' + encodeURIComponent(a.artist + ' ' + a.title);
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

  function ratingOf(a) {
    const r = S.ratings[a.id];
    if (r) return r;
    if (a.baseRating != null) return { r: a.baseRating, d: a.baseDate, s: 1 };
    return null;
  }
  const isRated = a => !!ratingOf(a);
  const pending = () => Object.keys(S.ratings).map(Number).filter(id => S.ratings[id] && !S.ratings[id].s);
  const configured = () => !!(S.settings.url && S.settings.token);

  function rateUrl(a, r, page) {
    const u = new URL(S.settings.url);
    u.searchParams.set('action', 'rate'); u.searchParams.set('token', S.settings.token);
    u.searchParams.set('artist', a.artist); u.searchParams.set('title', a.title);
    u.searchParams.set('rating', r.r); u.searchParams.set('date', r.d || today());
    const nt = notesText(r); if (nt) u.searchParams.set('notes', nt.slice(0, 1500));
    if (page) u.searchParams.set('page', '1');
    return u.toString();
  }

  // ---------- network (Android bridge or fetch) ----------
  let seq = 0; const waiting = {};
  window.__spinNextReply = function (id, ok, text) {
    const w = waiting[id]; if (!w) return; delete waiting[id];
    ok ? w.res(text) : w.rej(new Error(text || 'Network error'));
  };
  function http(method, url, body) {
    if (native) return new Promise((res, rej) => {
      const id = String(++seq); waiting[id] = { res, rej };
      setTimeout(() => { if (waiting[id]) { delete waiting[id]; rej(new Error('The sheet did not answer within 30 seconds.')); } }, 30000);
      native.request(id, method, url, body || '');
    });
    // text/plain keeps this a "simple" CORS request, which Apps Script web apps accept without a preflight.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    return fetch(url, { method, body, headers: body ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined, redirect: 'follow', signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .catch(e => { throw new Error(e.name === 'AbortError' ? 'The sheet did not answer within 20 seconds.' : (e.message || 'Network error')); })
      .finally(() => clearTimeout(timer));
  }
  const canFetch = () => !inArtifact; // the Claude artifact frame blocks requests to other sites

  async function pushRating(id) {
    const a = byId.get(id), r = S.ratings[id];
    if (!a || !r || !configured() || !canFetch()) return false;
    const txt = await http('POST', S.settings.url, JSON.stringify({ action: 'rate', token: S.settings.token, artist: a.artist, title: a.title, rating: r.r, date: r.d, notes: notesText(r) }));
    const res = JSON.parse(txt);
    if (!res.ok) throw new Error(res.error || 'The sheet refused the rating.');
    r.s = 1; persist(); return true;
  }
  async function pullFromSheet() {
    const u = new URL(S.settings.url); u.searchParams.set('token', S.settings.token);
    const res = JSON.parse(await http('GET', u.toString()));
    if (!res.ok) throw new Error(res.error || 'The sheet refused the request.');
    const idx = new Map(A.map(a => [norm(a.artist) + '|' + norm(a.title), a]));
    let n = 0;
    res.ratings.forEach(x => {
      const a = idx.get(norm(x.artist) + '|' + norm(x.title)); if (!a) return;
      const cur = S.ratings[a.id];
      if (cur && !cur.s) return; // local change still waiting to upload
      if (!cur || cur.r !== x.rating) n++;
      const keep = cur && (cur.t || cur.n) && notesText(cur) === (x.notes || '');
      S.ratings[a.id] = { r: x.rating, d: x.date || '', s: 1, t: keep ? cur.t : '', n: keep ? cur.n : (x.notes || '') };
    });
    persist(); return n;
  }
  async function syncAll() {
    if (!configured()) throw new Error('Add the web app URL and secret word first.');
    let up = 0;
    for (const id of pending()) { if (await pushRating(id)) up++; }
    const down = await pullFromSheet();
    return { up, down };
  }

  // ---------- picking ----------
  function pool() {
    const p = S.prefs, mood = MOODS.find(m => m.k === p.mood) || MOODS[MOODS.length - 1];
    const skipped = new Set(S.skipped);
    return A.filter(a => {
      if (isRated(a) || skipped.has(a.id) || a.id === S.now) return false;
      if (a.edition === -1 && !p.incRemoved) return false;
      if (mood.g && !mood.g.includes(a.genre)) return false;
      if (mood.far && a.english && !FAR_GENRES.includes(a.genre)) return false;
      if (p.era !== 'any' && Math.floor(a.year / 10) * 10 !== Number(p.era)) return false;
      if (p.time !== 'any' && a.mins != null) {
        if (p.time === 'short' && a.mins >= 40) return false;
        if (p.time === 'mid' && (a.mins < 40 || a.mins > 60)) return false;
        if (p.time === 'long' && a.mins <= 60) return false;
      }
      return true;
    });
  }
  let seen = new Set(), current = null;
  function pick() {
    if (justSaved) { justSaved = null; $('now').hidden = true; $('now').innerHTML = ''; }
    let p = pool();
    let fresh = p.filter(a => !seen.has(a.id));
    if (!fresh.length) { seen = new Set(); fresh = p; }
    current = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null;
    if (current) { seen.add(current.id); remember(current.id); }
    renderPick(p.length);
    renderRecent();
  }

  function remember(id) {
    S.history = [{ id: id, d: today() }].concat((S.history || []).filter(h => h.id !== id)).slice(0, 60);
    persist();
  }
  function suggestedUnrated() {
    return (S.history || []).map(h => ({ a: byId.get(h.id), d: h.d })).filter(x => x.a && !isRated(x.a) && x.a.id !== S.now && !S.skipped.includes(x.a.id));
  }
  function renderRecent() {
    const el = $('recent');
    const items = suggestedUnrated().filter(x => !current || x.a.id !== current.id);
    if (!items.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h3 class="sub">Suggested earlier, not rated yet</h3><div class="list" style="border-top:0">' +
      items.slice(0, 4).map(x => itemHtml(x.a, 'suggested ' + x.d)).join('') + '</div>' +
      (items.length > 4 ? '<button class="linkbtn" id="seeAllRecent" style="justify-self:start;margin-top:6px">See all ' + items.length + ' in Log</button>' : '');
    const b = $('seeAllRecent'); if (b) b.onclick = () => show('log');
  }

  // ---------- rendering ----------
  function discHtml(a, spin) { return '<div class="disc' + (spin ? ' spin' : '') + '" style="--hue:' + (HUES[a.genre] || 'var(--label)') + '" aria-hidden="true"></div>'; }
  function flagHtml(a) { return a.edition === 1 ? '<span class="flag added">New in 2026</span>' : a.edition === -1 ? '<span class="flag removed">Dropped in 2026</span>' : ''; }
  function recordTop(a, spin) {
    return '<div class="record-top">' + discHtml(a, spin) + '<div class="record-meta">' +
      '<span class="eyebrow mono">' + cat(a.id) + ' · ' + esc(a.genre) + '</span>' +
      '<h3>' + esc(a.title) + '</h3><div class="artist">' + esc(a.artist) + '</div>' +
      '<div class="facts"><span>' + a.year + '</span><span>' + fmtMins(a.mins) + '</span>' + (a.songs ? '<span>' + a.songs + ' tracks</span>' : '') + '</div>' +
      (flagHtml(a) ? '<div>' + flagHtml(a) + '</div>' : '') + '</div></div>';
  }
  function traitsHtml(a) {
    if (!a.desc && !a.style.length) return '';
    const tags = list => list.map(x => '<span class="tag">' + esc(x) + '</span>').join('');
    return '<div class="traits">' + (a.desc ? '<p>' + esc(a.desc) + '</p>' : '') +
      '<div class="trait-row"><span>Style</span>' + tags(a.style) + '</div>' +
      '<div class="trait-row"><span>Sound</span>' + tags(a.inst) + '</div>' +
      '<div class="trait-row"><span>From</span>' + tags([a.region]) + '</div>' +
      '<div class="trait-row"><span>Feel</span>' + tags(a.mood) + '</div></div>';
  }

  function renderHeader() {
    const rated = A.filter(isRated).length;
    $('count').innerHTML = '<b>' + rated.toLocaleString() + '</b> / ' + CURRENT.toLocaleString() + ' rated';
    $('bar').style.width = Math.min(100, rated / CURRENT * 100) + '%';
    const n = inArtifact && configured() ? pending().length : (configured() ? pending().length : 0);
    $('pendingDot').hidden = !n; $('pendingDot').textContent = n;
  }

  function chipGroup(el, items, key) {
    el.innerHTML = items.map(([k, label, sub]) => '<button class="chip" type="button" data-k="' + k + '" aria-pressed="' + (S.prefs[key] === k) + '">' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>').join('');
    el.onclick = e => { const b = e.target.closest('.chip'); if (!b) return; S.prefs[key] = b.dataset.k; persist(); chipGroup(el, items, key); };
  }

  function renderAsk() {
    chipGroup($('q-mood'), MOODS.map(m => [m.k, m.label, m.sub]), 'mood');
    chipGroup($('q-era'), ERAS, 'era');
    chipGroup($('q-time'), TIMES, 'time');
    $('incRemoved').checked = !!S.prefs.incRemoved;
  }

  function renderPick(poolSize) {
    const el = $('pick');
    $('ask').hidden = true; el.hidden = false;
    if (!current) {
      el.innerHTML = '<div class="record"><h3 style="font-size:22px">Nothing left in that corner</h3><p class="muted" style="margin:0">You have rated or skipped every album that matches. Loosen the era or length and try again.</p><button class="btn" id="backAsk">Change answers</button></div>';
      $('backAsk').onclick = showAsk; return;
    }
    const a = current;
    el.innerHTML = '<div class="record">' +
      '<div class="now-label"><span class="eyebrow">Your next record</span><span class="eyebrow mono">' + poolSize + ' match' + (poolSize === 1 ? '' : 'es') + '</span></div>' +
      recordTop(a, false) + traitsHtml(a) +
      '<a class="btn" href="' + spotify(a) + '" target="_blank" rel="noopener">Find it on Spotify ↗</a>' +
      '<div class="row"><button class="btn primary" id="startBtn">I’m listening to this</button><button class="btn" id="againBtn">Pick another</button></div>' +
      '<button class="linkbtn" id="backAsk" style="justify-self:start">Change answers</button></div>';
    $('startBtn').onclick = () => startListening(a.id, true);
    $('againBtn').onclick = pick;
    $('backAsk').onclick = showAsk;
  }

  function showAsk() { $('pick').hidden = true; $('ask').hidden = !!S.now; current = null; }

  function startListening(id, openSpotify) {
    justSaved = null; S.now = id; S.nowSince = today(); remember(id); persist();
    $('pick').hidden = true;
    renderNow(); renderHeader(); renderRecent();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  let chosen = null, justSaved = null, draft = null;
  function ensureDraft(a) {
    if (!draft || draft.id !== a.id) {
      const r = ratingOf(a) || {};
      draft = (S.draft && S.draft.id === a.id) ? Object.assign({}, S.draft) : { id: a.id, t: r.t || '', n: r.n || '' };
    }
    return draft;
  }
  function saveDraft() { S.draft = Object.assign({}, draft); clearTimeout(saveDraft.t); saveDraft.t = setTimeout(persist, 600); }
  window.__spinNextDictation = function (text) {
    if (!draft || !text) return;
    draft.n = (draft.n ? draft.n.replace(/\s+$/, '') + ' ' : '') + text;
    const ta = $('nNotes'); if (ta) ta.value = draft.n;
    saveDraft();
  };
  function notesText(r) {
    const parts = [];
    if (r.t) parts.push('Standout tracks: ' + r.t);
    if (r.n) parts.push(r.n);
    return parts.join('\n');
  }
  function renderNow() {
    const el = $('now');
    if (!S.now && justSaved) { renderSaved(el); return; }
    if (!S.now) { el.hidden = true; el.innerHTML = ''; $('ask').hidden = false; return; }
    const a = byId.get(S.now);
    $('ask').hidden = true; el.hidden = false;
    const existing = ratingOf(a);
    if (chosen == null && existing) chosen = existing.r;
    const steps = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    el.innerHTML = '<div class="record">' +
      '<div class="now-label"><span class="pill">Now spinning</span><span class="eyebrow mono">since ' + esc(S.nowSince || today()) + '</span></div>' +
      recordTop(a, true) + traitsHtml(a) +
      '<a class="btn" href="' + spotify(a) + '" target="_blank" rel="noopener">Open in Spotify ↗</a>' +
      '<div class="rate"><h4>Finished? Rate it</h4>' +
      '<div class="scale" role="group" aria-label="Rating from 1 to 5">' + steps.map(s => '<button type="button" class="' + (s % 1 ? 'half' : '') + '" data-r="' + s + '" aria-pressed="' + (chosen === s) + '" aria-label="' + s + ' out of 5">' + fmtR(s) + '</button>').join('') + '</div>' +
      '<div class="scale-ends"><span>not for me</span><span>all-timer</span></div>' +
      '<div class="notes-in">' +
        '<div class="field"><label for="nTracks">Standout tracks</label><input id="nTracks" type="text" autocomplete="off" placeholder="Songs that grabbed you"></div>' +
        '<div class="field"><label for="nNotes">What did you like or dislike?</label><textarea id="nNotes" rows="4" placeholder="The sound, the songs, the moments that stuck with you…"></textarea>' +
        (native && native.dictate ? '<button class="btn" type="button" id="dictateBtn">Dictate a voice note</button>' : '<span class="note">To dictate, tap the microphone on your phone’s keyboard (on a Mac, press the dictation key).</span>') +
        '</div></div>' +
      '<button class="btn primary big" id="saveRating"' + (chosen == null ? ' disabled' : '') + '>Save ' + (chosen == null ? 'rating' : fmtR(chosen) + ' / 5') + '</button>' +
      '<div class="row"><button class="btn" id="skipBtn">Didn’t finish – skip it</button><button class="btn" id="dropBtn">Put it back</button></div>' +
      '</div></div>';
    const d = ensureDraft(a);
    $('nTracks').value = d.t; $('nNotes').value = d.n;
    $('nTracks').oninput = e => { draft.t = e.target.value; saveDraft(); };
    $('nNotes').oninput = e => { draft.n = e.target.value; saveDraft(); };
    const db = $('dictateBtn'); if (db) db.onclick = () => native.dictate();
    el.querySelector('.scale').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      chosen = Number(b.dataset.r);
      el.querySelectorAll('.scale button').forEach(x => x.setAttribute('aria-pressed', String(Number(x.dataset.r) === chosen)));
      const sv = $('saveRating'); sv.disabled = false; sv.textContent = 'Save ' + fmtR(chosen) + ' / 5';
    };
    $('saveRating').onclick = () => saveRating(a.id, chosen);
    $('skipBtn').onclick = () => { S.skipped.push(a.id); S.now = null; chosen = null; persist(); renderNow(); renderHeader(); flash('Skipped ' + a.title + '. It won’t be suggested again.'); };
    $('dropBtn').onclick = () => { S.now = null; chosen = null; persist(); renderNow(); };
  }

  async function saveRating(id, r) {
    if (r == null) return;
    try {
      const d = draft && draft.id === id ? draft : { t: '', n: '' };
      S.ratings[id] = { r, d: today(), s: 0, t: (d.t || '').trim(), n: (d.n || '').trim() };
      draft = null; S.draft = null;
      S.now = null; chosen = null; persist();
      justSaved = { id, sync: configured() ? (inArtifact ? 'link' : 'sending') : 'none', msg: '' };
      const old = $('flash'); if (old) old.remove();
      renderNow(); renderHeader(); renderLog(); renderRecent();
      $('now').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (justSaved.sync === 'sending') {
        try { await pushRating(id); if (justSaved && justSaved.id === id) justSaved.sync = 'done'; }
        catch (e) { if (justSaved && justSaved.id === id) { justSaved.sync = 'failed'; justSaved.msg = e.message; } }
        if (justSaved && justSaved.id === id) renderNow();
        renderHeader(); renderLog();
      }
    } catch (e) {
      flash('Could not save the rating: ' + e.message, 'warn');
    }
  }

  function renderSaved(el) {
    const a = byId.get(justSaved.id), r = S.ratings[a.id];
    $('ask').hidden = true; el.hidden = false;
    let sync = '';
    if (justSaved.sync === 'none') sync = '<div class="status warn">Saved in the app only. Add your sheet link in Settings to record it in the spreadsheet. <button class="linkbtn" id="goSettings">Open Settings</button></div>';
    else if (justSaved.sync === 'link') sync = r.s
      ? '<div class="status ok">Sent to your sheet. The tab that opened confirms the row it was written to.</div>'
      : '<a class="btn primary big" href="' + esc(rateUrl(a, r, true)) + '" target="_blank" rel="noopener" data-sync="' + a.id + '">Write to sheet ↗</a><p class="note" style="margin:0">Opens a tab that records ' + fmtR(r.r) + '/5 and today’s date in your spreadsheet.</p>';
    else if (justSaved.sync === 'sending') sync = '<div class="status">Writing to your sheet…</div>';
    else if (justSaved.sync === 'done') sync = '<div class="status ok">Written to your sheet.</div>';
    else sync = '<div class="status warn">Saved in the app, but the sheet didn’t accept it: ' + esc(justSaved.msg) + ' It will retry on the next sync.</div>';
    el.innerHTML = '<div class="record">' +
      '<div class="now-label"><span class="pill saved">Rating saved</span><span class="eyebrow mono">' + esc(r.d) + '</span></div>' +
      recordTop(a, false) +
      '<div class="saved-score"><span class="mono">' + fmtR(r.r) + '</span><span class="muted">/ 5</span></div>' +
      (notesText(r) ? '<p class="notes-out">' + esc(notesText(r)) + '</p>' : '') +
      sync +
      '<button class="btn big" id="nextBtn">Pick my next album</button></div>';
    $('nextBtn').onclick = () => { justSaved = null; renderNow(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const gs = $('goSettings'); if (gs) gs.onclick = () => show('settings');
  }

  function flash(msg, kind, withSettings) {
    const box = document.createElement('div');
    box.className = 'status' + (kind ? ' ' + kind : ''); box.id = 'flash';
    box.innerHTML = esc(msg) + (withSettings ? ' <button class="linkbtn" id="goSettings">Open Settings</button>' : '');
    const old = $('flash'); if (old) old.remove();
    $('view-spin').prepend(box);
    if (withSettings) $('goSettings').onclick = () => show('settings');
  }
  document.addEventListener('click', e => {
    const l = e.target.closest('a[data-sync]'); if (!l) return;
    const id = Number(l.dataset.sync); if (S.ratings[id]) { S.ratings[id].s = 1; persist(); }
    setTimeout(() => { renderHeader(); renderLog(); if (justSaved && justSaved.id === id) renderNow(); }, 50);
  });

  // ---------- log ----------
  function renderStats() {
    const decs = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
    $('decadeStats').innerHTML = decs.map(d => {
      const all = A.filter(a => a.edition !== -1 && Math.floor(a.year / 10) * 10 === d);
      const done = all.filter(isRated).length;
      const pct = all.length ? done / all.length * 100 : 0;
      return '<div class="stat" title="' + done + ' of ' + all.length + '"><div class="meter"><i style="height:' + Math.max(pct, done ? 4 : 0) + '%"></i></div><span>\'' + String(d).slice(2) + 's ' + done + '/' + all.length + '</span></div>';
    }).join('');
  }
  function itemHtml(a, note) {
    const r = ratingOf(a);
    const acts = [];
    if (!r) acts.push('<button class="linkbtn" data-listen="' + a.id + '">' + (note ? 'Rate or listen now' : 'Listen to this') + '</button>');
    else acts.push('<button class="linkbtn" data-listen="' + a.id + '">Re-rate</button>');
    acts.push('<a href="' + spotify(a) + '" target="_blank" rel="noopener">Spotify ↗</a>');
    if (r && !r.s && configured() && inArtifact) acts.push('<a href="' + esc(rateUrl(a, r, true)) + '" target="_blank" rel="noopener" data-sync="' + a.id + '">Write to sheet ↗</a>');
    return '<div class="item"><div class="t"><b>' + esc(a.title) + '</b><span>' + esc(a.artist) + ' · ' + a.year + ' · ' + esc(a.genre) + (a.edition === 1 ? ' · new in 2026' : a.edition === -1 ? ' · dropped in 2026' : '') + (note ? ' · ' + esc(note) : '') + '</span>' + (r && notesText(r) ? '<em>' + esc(notesText(r).slice(0, 220)) + (notesText(r).length > 220 ? '…' : '') + '</em>' : '') + '</div>' +
      '<div class="r">' + (r ? fmtR(r.r) + '<span class="muted">/5</span>' + (r.s ? '' : '<div class="eyebrow" style="color:var(--warn)">not in sheet</div>') : '<span class="muted">—</span>') + '</div>' +
      '<div class="acts">' + acts.join('') + '</div></div>';
  }
  function renderLog() {
    renderStats();
    const q = norm($('search').value || '');
    let rows;
    if (q) rows = A.filter(a => norm(a.artist + a.title).includes(q)).slice(0, 60);
    else rows = A.filter(isRated).sort((x, y) => String(ratingOf(y).d || '').localeCompare(String(ratingOf(x).d || '')) || y.id - x.id);
    const p = pending();
    $('pendingBox').innerHTML = p.length && configured()
      ? '<div class="status warn">' + p.length + ' rating' + (p.length === 1 ? ' is' : 's are') + ' not in your sheet yet. ' + (inArtifact ? 'Use “Write to sheet” on each one below.' : 'Go to Settings › Sync now.') + '</div>' : '';
    if (q) {
      $('list').innerHTML = rows.length ? rows.map(a => itemHtml(a)).join('') : '<p class="muted">No album matches “' + esc($('search').value) + '”.</p>';
    } else {
      const sug = suggestedUnrated();
      $('list').innerHTML =
        (sug.length ? '<h3 class="sub">Suggested, not rated yet</h3>' + sug.map(x => itemHtml(x.a, 'suggested ' + x.d)).join('') : '') +
        '<h3 class="sub">Rated</h3>' +
        (rows.length ? rows.map(a => itemHtml(a)).join('') : '<p class="muted">Nothing rated yet. Your first rating will show up here.</p>');
    }
  }
  $('list').addEventListener('click', e => {
    const b = e.target.closest('[data-listen]'); if (!b) return;
    chosen = null; startListening(Number(b.dataset.listen)); show('spin');
  });
  $('search').addEventListener('input', renderLog);
  $('recent').addEventListener('click', e => {
    const b = e.target.closest('[data-listen]'); if (!b) return;
    chosen = null; startListening(Number(b.dataset.listen));
  });

  // ---------- stats ----------
  // Mirrors the spreadsheet's summary tabs: RatingCounts, AverageRatingPerDecade, Artist Stats and the genre pivots.
  const TARGET = { 1: 0.20, 2: 0.25, 3: 0.30, 4: 0.15, 5: 0.10 };   // "Ideal %" from the RatingCounts tab
  const avgOf = list => list.length ? list.reduce((t, x) => t + x, 0) / list.length : 0;
  const fmtAvg = v => v ? v.toFixed(2) : '–';
  const hours = m => Math.round(m / 60).toLocaleString();
  function hbar(label, value, max, right, target) {
    const w = max ? Math.max(value / max * 100, value ? 2 : 0) : 0;
    return '<div class="hbar"><span class="lab">' + label + '</span><span class="track"><span class="fill" style="width:' + w.toFixed(1) + '%"></span>' +
      (target != null ? '<span class="target" style="left:' + Math.min(target, 100).toFixed(1) + '%" title="Target"></span>' : '') +
      '</span><span class="val">' + right + '</span></div>';
  }
  function albumLine(x) {
    return '<li><span class="r mono">' + fmtR(x.r.r) + '</span><span class="t"><b>' + esc(x.a.title) + '</b><span>' + esc(x.a.artist) + ' · ' + x.a.year + '</span></span></li>';
  }
  function renderInsights() {
    const el = $('insights');
    const rated = A.filter(isRated).map(a => ({ a, r: ratingOf(a) }));
    const current = A.filter(a => a.edition !== -1);
    const ratedCurrent = current.filter(isRated).length;
    if (!rated.length) {
      el.innerHTML = '<div class="record"><h3 style="font-size:22px">No stats yet</h3><p class="muted" style="margin:0">Rate your first album and this page fills in: your average, rating spread, decades, genres and artists.</p></div>';
      return;
    }
    const scores = rated.map(x => x.r.r);
    const avg = avgOf(scores);
    const listened = rated.reduce((t, x) => t + (x.a.mins || 0), 0);
    const leftMins = current.filter(a => !isRated(a)).reduce((t, a) => t + (a.mins || 0), 0);
    const pct = ratedCurrent / CURRENT * 100;

    // rating spread, whole stars like the sheet (3½ counts towards 3)
    const buckets = [1, 2, 3, 4, 5].map(b => ({ b, n: rated.filter(x => Math.min(5, Math.floor(x.r.r)) === b).length }));
    const maxB = Math.max(...buckets.map(x => x.n), 1);
    const spread = buckets.map(x => {
      const share = x.n / rated.length * 100;
      return hbar(x.b + (x.b === 5 ? '' : '–' + x.b + '½'), share, 100, x.n + ' · ' + Math.round(share) + '%', TARGET[x.b] * 100);
    }).join('');

    // decades
    const decades = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020].map(d => {
      const all = current.filter(a => Math.floor(a.year / 10) * 10 === d);
      const r = rated.filter(x => Math.floor(x.a.year / 10) * 10 === d);
      return { d, total: all.length, done: all.filter(isRated).length, avg: avgOf(r.map(x => x.r.r)) };
    });
    const decadeRows = decades.map(x => hbar("'" + String(x.d).slice(2) + 's', x.done, x.total, x.done + '/' + x.total + ' · avg ' + fmtAvg(x.avg))).join('');

    // genres
    const gMap = {};
    rated.forEach(x => { (gMap[x.a.genre] = gMap[x.a.genre] || []).push(x.r.r); });
    const genres = Object.keys(gMap).map(g => ({ g, n: gMap[g].length, avg: avgOf(gMap[g]) })).sort((p, q) => q.n - p.n || q.avg - p.avg);
    const maxG = Math.max(...genres.map(x => x.n), 1);
    const genreRows = genres.slice(0, 8).map(x => hbar(esc(x.g), x.n, maxG, x.n + ' · avg ' + fmtAvg(x.avg))).join('');
    const loved = genres.filter(x => x.n >= 2).sort((p, q) => q.avg - p.avg)[0];

    // artists with the most albums on the list (the sheet's Artist Stats tab)
    const aMap = {};
    current.forEach(a => { const k = a.artist; (aMap[k] = aMap[k] || { artist: k, total: 0, done: 0 }); aMap[k].total++; if (isRated(a)) aMap[k].done++; });
    const artists = Object.values(aMap).filter(x => x.total >= 3).sort((p, q) => q.total - p.total || p.artist.localeCompare(q.artist)).slice(0, 10);
    const artistRows = artists.map(x => hbar(esc(x.artist), x.done, x.total, x.done + '/' + x.total)).join('');

    // best and worst
    const byScore = rated.slice().sort((p, q) => q.r.r - p.r.r || String(q.r.d).localeCompare(String(p.r.d)));
    const top = byScore.slice(0, 5), bottom = byScore.slice(-5).reverse().filter(x => !top.includes(x));

    // activity over the last 12 months
    const now = new Date(), months = [];
    for (let k = 11; k >= 0; k--) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      months.push({ key, label: d.toLocaleString('en', { month: 'short' }).slice(0, 1), full: d.toLocaleString('en', { month: 'long', year: 'numeric' }), n: rated.filter(x => String(x.r.d || '').slice(0, 7) === key).length });
    }
    const maxM = Math.max(...months.map(m => m.n), 1);
    const monthCols = months.map(m => '<div class="col" title="' + m.full + ': ' + m.n + '"><span class="n mono">' + (m.n || '') + '</span><span class="barwrap"><i style="height:' + (m.n / maxM * 100).toFixed(1) + '%"></i></span><span class="m">' + m.label + '</span></div>').join('');

    const nonEnglish = rated.filter(x => !x.a.english).length;
    const added = A.filter(a => a.edition === 1), addedDone = added.filter(isRated).length;

    el.innerHTML =
      '<div class="tiles">' +
        '<div class="tile"><b>' + ratedCurrent.toLocaleString() + '</b><span>of ' + CURRENT.toLocaleString() + ' rated · ' + pct.toFixed(1) + '%</span></div>' +
        '<div class="tile"><b>' + avg.toFixed(2) + '</b><span>average rating out of 5</span></div>' +
        '<div class="tile"><b>' + hours(listened) + ' h</b><span>of music listened to</span></div>' +
        '<div class="tile"><b>' + (CURRENT - ratedCurrent).toLocaleString() + '</b><span>to go · about ' + hours(leftMins) + ' hours</span></div>' +
      '</div>' +
      '<div class="panel"><h3>How you rate</h3>' + '<div class="hbars">' + spread + '</div>' +
        '<p class="legend">Bars show your share of ratings. The tick marks your target spread from the RatingCounts tab: 20 / 25 / 30 / 15 / 10%.</p></div>' +
      '<div class="panel"><h3>Ratings by month</h3><div class="months">' + monthCols + '</div></div>' +
      '<div class="panel"><h3>Decades</h3><div class="hbars">' + decadeRows + '</div></div>' +
      '<div class="panel"><h3>Genres you’ve rated</h3><div class="hbars">' + genreRows + '</div>' +
        (loved ? '<p class="legend">Highest average so far: <b>' + esc(loved.g) + '</b> at ' + loved.avg.toFixed(2) + ' across ' + loved.n + ' albums.</p>' : '') + '</div>' +
      '<div class="panel"><h3>Artists with the most albums on the list</h3><div class="hbars">' + artistRows + '</div></div>' +
      '<div class="panel two"><div><h3>Your top rated</h3><ol class="ranked">' + top.map(albumLine).join('') + '</ol></div>' +
        (bottom.length ? '<div><h3>Not for you</h3><ol class="ranked">' + bottom.map(albumLine).join('') + '</ol></div>' : '') + '</div>' +
      '<div class="panel"><h3>Odds and ends</h3><ul class="facts-list">' +
        '<li><b>' + nonEnglish + '</b> of your rated albums aren’t in English.</li>' +
        '<li><b>' + addedDone + ' of ' + added.length + '</b> albums new to the 2026 edition rated.</li>' +
        '<li><b>' + Object.keys(gMap).length + '</b> genres and <b>' + new Set(rated.map(x => x.a.artist)).size + '</b> artists so far.</li>' +
      '</ul></div>';
  }

  // ---------- settings ----------
  function renderSettings() {
    $('sUrl').value = S.settings.url || ''; $('sToken').value = S.settings.token || '';
    $('syncNow').hidden = inArtifact;
    $('envNote').textContent = inArtifact
      ? 'In this Claude artifact each rating is written through a “Write to sheet” link that opens in a new tab, because the artifact cannot contact other sites directly. The Android app syncs in the background and also pulls ratings you made elsewhere.'
      : 'Each rating is written to your sheet as you save it. Ratings already in the sheet are pulled in when you open the app or tap Sync now. Your web app URL and secret word are stored only on this device.';
  }
  function setStatus(msg, kind) { $('settingsStatus').innerHTML = msg ? '<div class="status ' + (kind || '') + '">' + esc(msg) + '</div>' : ''; }
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const url = $('sUrl').value.trim(), token = $('sToken').value.trim();
    if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { setStatus('That doesn’t look like an Apps Script web app URL. It starts with https://script.google.com/macros/s/', 'warn'); return; }
    S.settings = { url, token }; persist(); renderHeader(); renderLog();
    if (!url || !token) { setStatus('Saved. Add both the URL and the secret word to turn on syncing.', 'warn'); return; }
    if (inArtifact) { setStatus('Saved. After each rating, tap “Write to sheet” to record it.', 'ok'); return; }
    await doSync();
  });
  async function doSync() {
    setStatus('Syncing with your sheet…');
    try { const r = await syncAll(); setStatus('Synced. Sent ' + r.up + ', received ' + r.down + ' rating' + (r.down === 1 ? '' : 's') + ' from the sheet.', 'ok'); render(); }
    catch (e) { setStatus('Sync failed: ' + e.message, 'warn'); }
  }
  $('syncNow').addEventListener('click', doSync);

  // ---------- tabs ----------
  function show(view) {
    ['spin', 'log', 'stats', 'settings'].forEach(v => { $('view-' + v).hidden = v !== view; $('tab-' + v).setAttribute('aria-selected', String(v === view)); });
    if (view === 'log') renderLog();
    if (view === 'stats') renderInsights();
    if (view === 'settings') renderSettings();
  }
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view); });

  $('goPick').onclick = () => { S.prefs.incRemoved = $('incRemoved').checked; persist(); seen = new Set(); pick(); };
  $('incRemoved').onchange = () => { S.prefs.incRemoved = $('incRemoved').checked; persist(); };

  // Android: open outside links in the Spotify app / browser
  if (native) document.addEventListener('click', e => {
    const l = e.target.closest('a[target="_blank"]'); if (!l) return;
    e.preventDefault(); native.openExternal(l.href);
  });

  function render() { renderHeader(); renderAsk(); renderNow(); renderLog(); renderRecent(); if (!S.now && $('pick').hidden) $('ask').hidden = false; }

  // ---------- boot ----------
  merge(lsGet());
  render();
  if (inArtifact && window.claude && typeof window.claude.use === 'function') connectDb();
  else if (configured()) syncAll().then(render).catch(() => {});

  if (ENV !== 'artifact') {
    let lastPull = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !configured() || Date.now() - lastPull < 60000) return;
      lastPull = Date.now();
      syncAll().then(render).catch(() => {});
    });
  }
  if (ENV === 'web' && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
