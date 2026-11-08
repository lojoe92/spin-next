/**
 * 1001 Albums – sync endpoint for the Spin Next app.
 *
 * Paste this into Extensions > Apps Script of the Google Sheets version of
 * "1001 Albums", then:
 *   1. Change TOKEN below to your own secret word.
 *   2. Run setup2026 once (adds the 13 new albums and the "2026 Edition" column).
 *   3. Deploy > New deployment > Web app
 *        Execute as: Me    Who has access: Anyone
 *      Copy the Web app URL into the app's Settings, together with TOKEN.
 */

const TOKEN = 'change-me';
const SHEET = 'Ratings Chart';
const COL = { artist: 1, title: 2, year: 3, rating: 4, reviewDate: 5, edition: 12, notes: 13 };

// ---------- HTTP endpoints ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return reply_({ ok: false, error: 'Wrong or missing token. Check Settings in the app.' }, p);
  if (p.action === 'rate') {
    const res = rate_(p.artist, p.title, p.rating, p.date, p.notes);
    return reply_(res, p);
  }
  return reply_(list_(), p);
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (body.token !== TOKEN) return json_({ ok: false, error: 'Wrong or missing token. Check Settings in the app.' });
  if (body.action === 'rate') return json_(rate_(body.artist, body.title, body.rating, body.date, body.notes));
  return json_(list_());
}

// ---------- Data ----------

function list_() {
  const sh = sheet_();
  const n = lastAlbumRow_(sh) - 1;
  const vals = sh.getRange(2, 1, n, COL.notes).getValues();
  const tz = Session.getScriptTimeZone();
  const ratings = [];
  vals.forEach(function (r) {
    if (r[COL.rating - 1] === '' || r[COL.rating - 1] === null) return;
    const d = r[COL.reviewDate - 1];
    ratings.push({
      artist: String(r[0]), title: String(r[1]),
      rating: Number(r[COL.rating - 1]),
      date: d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '',
      notes: String(r[COL.notes - 1] || '')
    });
  });
  return { ok: true, ratings: ratings, total: n };
}

function rate_(artist, title, rating, date, notes) {
  const value = Number(rating);
  if (!(value >= 0.5 && value <= 5)) return { ok: false, error: 'Rating must be between 0.5 and 5.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const row = findRow_(sh, artist, title);
    if (!row) return { ok: false, error: 'Could not find "' + artist + ' – ' + title + '" in the sheet.' };
    sh.getRange(row, COL.rating).setValue(value);
    sh.getRange(row, COL.reviewDate).setValue(parseDate_(date)).setNumberFormat('yyyy-mm-dd');
    if (notes !== undefined && notes !== null) {
      if (sh.getRange(1, COL.notes).getValue() === '') sh.getRange(1, COL.notes).setValue('Notes').setFontWeight('bold');
      let text = String(notes).slice(0, 5000);
      if (/^[=+\-@]/.test(text)) text = "'" + text;   // keep notes as plain text, never a formula
      sh.getRange(row, COL.notes).setValue(text).setWrap(true);
    }
    return { ok: true, row: row, artist: artist, title: title, rating: value };
  } finally {
    lock.releaseLock();
  }
}

// ---------- One-time setup for the 2026 edition ----------

const NEW_ALBUMS = [
  // artist, title, year, runtime (seconds or null), genre, songs
  ['Alvvays', 'Blue Rev', 2022, 2321, 'Rock', 14],
  ['Nova Twins', 'Supernova', 2022, 1853, 'Rock', 11],
  ['The Rolling Stones', 'Hackney Diamonds', 2023, 2903, 'Rock', 12],
  ['The Chemical Brothers', 'For That Beautiful Feeling', 2023, null, 'Electronic', 11],
  ['St. Vincent', 'All Born Screaming', 2024, null, 'Rock', 10],
  ['The Cure', 'Songs of a Lost World', 2024, 2953, 'Rock', 8],
  ['Charli xcx', 'Brat', 2024, 2473, 'Pop', 15],
  ['Billie Eilish', 'Hit Me Hard and Soft', 2024, 2631, 'Pop', 10],
  ['jasmine.4.t', 'You Are the Morning', 2025, 2421, 'Folk', 13],
  ['Ela Minus', 'Día', 2025, 2023, 'Electronic', 10],
  ['Mon Rovîa', 'Bloodline', 2026, null, 'Folk', 16],
  ['Poppy', 'Empty Hands', 2026, 2311, 'Metal', 13],
  ['Charli xcx', 'Wuthering Heights', 2026, 2074, 'Pop', 12]
];

const REMOVED = [
  ['Fiona Apple', 'Fetch the Bolt Cutters'], ['Little Simz', 'Grey Area'], ['Hookworms', 'Microshift'],
  ['Jane Weaver', 'Modern Kosmology'], ['Leonard Cohen', 'You Want It Darker'], ['Hot Chip', 'In Our Heads'],
  ['Django Django', 'Django Django'], ['Beach House', 'Teen Dream'], ['Wild Beasts', 'Two Dancers'],
  ['The Mars Volta', 'De-Loused in the Comatorium'], ['Jurassic 5', 'Power in Numbers'],
  ['Drive-By Truckers', 'Southern Rock Opera'], ['Super Furry Animals', 'Rings Around the World']
];

function setup2026() {
  const sh = sheet_();
  if (findRow_(sh, 'Charli xcx', 'Wuthering Heights')) { Logger.log('Already set up – nothing to do.'); return; }

  const last = lastAlbumRow_(sh);
  const n = NEW_ALBUMS.length;
  // Insert inside the data block so every range ending at the last album (averages, counts) grows with it.
  sh.insertRowsAfter(last - 1, n);
  // The old last album is now at last+n; move it back to `last` so the list stays in year order.
  sh.getRange(last + n, 1, 1, 11).copyTo(sh.getRange(last, 1, 1, 11));

  const first = last + 1;
  sh.getRange(first, 1, n, 11).clearContent();
  sh.getRange(first, 1, n, 10).setValues(NEW_ALBUMS.map(function (a) {
    return [a[0], a[1], a[2], '', '', a[3] === null ? '' : a[3] / 86400, a[4], a[5], 2020, 'Y'];
  }));
  sh.getRange(first, 6, n, 1).setNumberFormat('[h]:mm:ss');
  sh.getRange(first, 11, n, 1).setFormulas(NEW_ALBUMS.map(function (_, i) {
    return ['=if(isblank(D' + (first + i) + '), 0, 1)'];
  }));

  sh.getRange(1, COL.edition).setValue('2026 Edition').setFontWeight('bold');
  sh.getRange(first, COL.edition, n, 1).setValue('Added in 2026');
  REMOVED.forEach(function (a) {
    const row = findRow_(sh, a[0], a[1]);
    if (row) sh.getRange(row, COL.edition).setValue('Removed in 2026');
    else Logger.log('Not found: ' + a.join(' – '));
  });
  Logger.log('Added ' + n + ' albums at rows ' + first + '–' + (first + n - 1) + '.');
}

// ---------- Helpers ----------

function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET);
  if (!sh) throw new Error('Sheet "' + SHEET + '" not found.');
  return sh;
}

function lastAlbumRow_(sh) {
  const vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  let last = 1;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] !== '' && vals[i][1] !== '') last = i + 1; else break;
  }
  return last;
}

function norm_(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

function findRow_(sh, artist, title) {
  const a = norm_(artist), t = norm_(title);
  const vals = sh.getRange(2, 1, lastAlbumRow_(sh) - 1, 2).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (norm_(vals[i][1]) === t && norm_(vals[i][0]) === a) return i + 2;
  }
  for (let i = 0; i < vals.length; i++) {   // fall back to title only if unique
    if (norm_(vals[i][1]) === t) {
      const dup = vals.some(function (r, j) { return j !== i && norm_(r[1]) === t; });
      if (!dup) return i + 2;
    }
  }
  return 0;
}

function parseDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// GET replies: JSON for the Android app, a small confirmation page when opened from the Claude artifact (page=1).
function reply_(obj, p) {
  if (p.page !== '1') return json_(obj);
  const ok = obj.ok;
  const msg = ok
    ? 'Saved <b>' + esc_(obj.rating) + '/5</b> for <b>' + esc_(obj.artist) + ' – ' + esc_(obj.title) + '</b> (row ' + obj.row + ').'
    : esc_(obj.error || 'Something went wrong.');
  const html = '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 20px">' +
    '<h2 style="margin:0 0 8px">' + (ok ? 'Written to your sheet' : 'Not saved') + '</h2><p>' + msg + '</p>' +
    '<p style="color:#667">You can close this tab and go back to Spin Next.</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle(ok ? 'Saved' : 'Not saved');
}

function esc_(s) {
  return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
}
