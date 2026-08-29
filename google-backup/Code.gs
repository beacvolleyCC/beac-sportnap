const RESULTS_SHEET = 'Latest Results';
const LOG_SHEET = 'Backup Log';

function setupRealtimeBackup() {
  const ss = SpreadsheetApp.getActive();

  let results = ss.getSheetByName(RESULTS_SHEET);
  if (!results) results = ss.insertSheet(RESULTS_SHEET);
  results.clear();
  results.getRange(1,1,1,11).setValues([[
    'Mentés ideje',
    'Bajnokság',
    'Forduló',
    'Pálya',
    'Csapat A',
    'Csapat B',
    'A pont',
    'B pont',
    'Lezárva',
    'Győztes',
    'Esemény állapota'
  ]]);
  results.setFrozenRows(1);

  let log = ss.getSheetByName(LOG_SHEET);
  if (!log) log = ss.insertSheet(LOG_SHEET);
  if (log.getLastRow() === 0) {
    log.getRange(1,1,1,4).setValues([[
      'Mentés ideje',
      'Ok',
      'Revízió',
      'JSON snapshot'
    ]]);
    log.setFrozenRows(1);
  }

  return 'Backup munkalapok elkészültek.';
}

function setRealtimeBackupToken() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    'Cloudflare backup token',
    'Adj meg egy hosszú, véletlen jelszót. Ugyanezt fogod Cloudflare-ben BACKUP_TOKEN secretként megadni.',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) return;

  const token = result.getResponseText().trim();
  if (token.length < 16) {
    ui.alert('Legalább 16 karakteres tokent adj meg.');
    return;
  }

  PropertiesService
    .getScriptProperties()
    .setProperty('BACKUP_TOKEN', token);

  ui.alert('Backup token elmentve.');
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService
      .getScriptProperties()
      .getProperty('BACKUP_TOKEN');

    if (!expected || payload.token !== expected) {
      return json_({ ok:false, error:'Unauthorized' });
    }

    const state = payload.state;
    if (!state || !Array.isArray(state.tournaments)) {
      return json_({ ok:false, error:'Missing state' });
    }

    writeLatest_(state);

    const log = SpreadsheetApp.getActive().getSheetByName(LOG_SHEET);
    log.appendRow([
      new Date(),
      String(payload.reason || ''),
      Number(state.rev || 0),
      JSON.stringify(state)
    ]);

    return json_({ ok:true });
  } catch (error) {
    return json_({ ok:false, error:error.message || String(error) });
  }
}

function writeLatest_(state) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(RESULTS_SHEET);
  if (!sh) {
    setupRealtimeBackup();
    sh = ss.getSheetByName(RESULTS_SHEET);
  }

  if (sh.getLastRow() > 1) {
    sh.getRange(2,1,sh.getLastRow()-1,11).clearContent();
  }

  const rows = [];

  state.tournaments
    .filter(t => t.enabled)
    .forEach(t => {
      t.matches
        .filter(m => m.finished)
        .forEach(m => {
          const teamA = m.a == null ? '' : (t.teams[m.a] || '');
          const teamB = m.b == null ? '' : (t.teams[m.b] || '');
          const winner =
            m.scoreA > m.scoreB ? teamA :
            m.scoreB > m.scoreA ? teamB : '';

          rows.push([
            new Date(),
            t.nameHu || t.id,
            m.round,
            m.court,
            teamA,
            teamB,
            m.scoreA,
            m.scoreB,
            true,
            winner,
            state.eventStatus
          ]);
        });
    });

  if (rows.length) {
    sh.getRange(2,1,rows.length,11).setValues(rows);
  }

  sh.autoResizeColumns(1,11);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
