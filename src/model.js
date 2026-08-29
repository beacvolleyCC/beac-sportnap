export const EVENT_STATUSES = ["UPCOMING", "LIVE", "ARCHIVED", "CLOSED"];

const BASE_PAIRINGS = [
  { round: 1, court: 1, a: 0, b: 1 },
  { round: 1, court: 2, a: 2, b: 3 },
  { round: 2, court: 1, a: 0, b: 2 },
  { round: 2, court: 2, a: 1, b: 3 },
  { round: 3, court: 1, a: 0, b: 3 },
  { round: 3, court: 2, a: 1, b: 2 }
];

function timerFields() {
  return {
    timerEndAt: 0,
    timerRunning: false,
    timerPaused: false,
    timerPausedRemainingMs: 0
  };
}

function matchRows() {
  return BASE_PAIRINGS.map((m, i) => ({
    id: `M${i + 1}`,
    ...m,
    scoreA: 0,
    scoreB: 0,
    finished: false,
    updatedAt: 0,
    ...timerFields()
  }));
}

function baseTournament(id, number, time) {
  return {
    id,
    enabled: true,
    nameHu: `${number}. bajnokság`,
    nameEn: `Tournament ${number}`,
    time,
    roundSeconds: 480,
    currentRound: 1,

    // Legacy mezők a v0.5.3 alatti állapot kompatibilitásához.
    roundEndAt: 0,
    roundRunning: false,
    roundPaused: false,
    roundPausedRemainingMs: 0,

    winner: "",
    teams: [
      "1. csapat",
      "2. csapat",
      "3. csapat",
      "4. csapat"
    ],
    matches: matchRows()
  };
}

export function defaultState() {
  return {
    version: 2,
    rev: 1,
    eventStatus: "UPCOMING",
    archiveAt: 0,
    titleHu: "Sportnap – Röplabda",
    titleEn: "Sports Day – Volleyball",
    activeTournamentId: "T1",
    lastUpdatedAt: Date.now(),
    recentActionIds: [],
    tournaments: [
      baseTournament("T1", 1, "14:30–15:00"),
      baseTournament("T2", 2, "15:00–15:30"),
      baseTournament("T3", 3, "15:30–16:00"),
      baseTournament("T4", 4, "16:00–16:30"),
      {
        id: "FINAL",
        enabled: false,
        nameHu: "Döntő – Final Four",
        nameEn: "Final – Final Four",
        time: "",
        roundSeconds: 480,
        currentRound: 1,
        roundEndAt: 0,
        roundRunning: false,
        roundPaused: false,
        roundPausedRemainingMs: 0,
        winner: "",
        teams: [],
        matches: []
      }
    ]
  };
}

export function getTournament(state, id) {
  return state.tournaments.find(t => t.id === id);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function editableEvent(state) {
  return state.eventStatus !== "ARCHIVED" && state.eventStatus !== "CLOSED";
}

function playableEvent(state) {
  return state.eventStatus === "LIVE";
}

function clampScore(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function findMatch(t, round, court) {
  return t.matches.find(
    m => Number(m.round) === Number(round) && Number(m.court) === Number(court)
  );
}

function currentMatches(t) {
  return t.matches.filter(m => Number(m.round) === Number(t.currentRound));
}

function currentTargets(t, court = 0, { includeFinished = false } = {}) {
  const c = Number(court || 0);
  let matches = currentMatches(t);
  if (c) matches = matches.filter(m => Number(m.court) === c);
  if (!includeFinished) matches = matches.filter(m => !m.finished);
  return matches;
}

function clearMatchTimer(m) {
  m.timerEndAt = 0;
  m.timerRunning = false;
  m.timerPaused = false;
  m.timerPausedRemainingMs = 0;
}

function matchRemainingMs(t, m, now) {
  if (m.timerPaused) {
    return Math.max(0, Number(m.timerPausedRemainingMs || 0));
  }
  if (m.timerRunning) {
    return Math.max(0, Number(m.timerEndAt || 0) - now);
  }
  return Math.max(0, Number(t.roundSeconds || 0) * 1000);
}

function syncLegacyRoundTimer(t) {
  const current = currentMatches(t).filter(m => !m.finished);

  const running = current.length > 0 &&
    current.every(m => m.timerRunning) &&
    current.every(m => Number(m.timerEndAt || 0) === Number(current[0].timerEndAt || 0));

  const paused = current.length > 0 &&
    current.every(m => m.timerPaused) &&
    current.every(m =>
      Number(m.timerPausedRemainingMs || 0) ===
      Number(current[0].timerPausedRemainingMs || 0)
    );

  t.roundRunning = running;
  t.roundEndAt = running ? Number(current[0].timerEndAt || 0) : 0;
  t.roundPaused = paused;
  t.roundPausedRemainingMs = paused
    ? Number(current[0].timerPausedRemainingMs || 0)
    : 0;
}

function normalizeStateInPlace(state) {
  if (!Array.isArray(state.tournaments)) state.tournaments = [];
  if (!Array.isArray(state.recentActionIds)) state.recentActionIds = [];
  state.version = Math.max(2, Number(state.version || 1));

  for (const t of state.tournaments) {
    if (!Array.isArray(t.matches)) t.matches = [];

    const legacyRunning = Boolean(t.roundRunning);
    const legacyPaused = Boolean(t.roundPaused);
    const legacyEndAt = Number(t.roundEndAt || 0);
    const legacyPausedMs = Number(t.roundPausedRemainingMs || 0);

    for (const m of t.matches) {
      const missingTimerSchema =
        typeof m.timerRunning !== "boolean" ||
        typeof m.timerPaused !== "boolean" ||
        !("timerEndAt" in m) ||
        !("timerPausedRemainingMs" in m);

      if (missingTimerSchema) {
        const isCurrentOpen =
          Number(m.round) === Number(t.currentRound) &&
          !m.finished;

        m.timerRunning = isCurrentOpen ? legacyRunning : false;
        m.timerPaused = isCurrentOpen ? legacyPaused : false;
        m.timerEndAt = isCurrentOpen && legacyRunning ? legacyEndAt : 0;
        m.timerPausedRemainingMs =
          isCurrentOpen && legacyPaused ? legacyPausedMs : 0;
      } else {
        m.timerEndAt = Number(m.timerEndAt || 0);
        m.timerPausedRemainingMs = Number(m.timerPausedRemainingMs || 0);
      }

      if (m.finished) clearMatchTimer(m);
    }

    syncLegacyRoundTimer(t);
  }

  return state;
}

function resetTournamentScores(t) {
  t.currentRound = 1;
  t.winner = "";

  for (const m of t.matches) {
    m.scoreA = 0;
    m.scoreB = 0;
    m.finished = false;
    m.updatedAt = 0;
    clearMatchTimer(m);
  }

  syncLegacyRoundTimer(t);
}

function winnerIndex(match) {
  if (match.scoreA === match.scoreB) return null;
  return match.scoreA > match.scoreB ? match.a : match.b;
}

export function calculateStandings(tournament) {
  const teams = tournament.teams || [];
  const table = teams.map((name, teamNo) => ({
    teamNo,
    name,
    played: 0,
    wins: 0,
    losses: 0,
    scored: 0,
    conceded: 0,
    diff: 0,
    points: 0
  }));

  const finished = (tournament.matches || []).filter(
    m => m.finished && m.a != null && m.b != null && m.scoreA !== m.scoreB
  );

  for (const m of finished) {
    const a = table[m.a];
    const b = table[m.b];
    if (!a || !b) continue;

    a.played += 1;
    b.played += 1;
    a.scored += m.scoreA;
    a.conceded += m.scoreB;
    b.scored += m.scoreB;
    b.conceded += m.scoreA;

    if (m.scoreA > m.scoreB) {
      a.wins += 1;
      b.losses += 1;
      a.points += 3;
    } else {
      b.wins += 1;
      a.losses += 1;
      b.points += 3;
    }
  }

  for (const row of table) row.diff = row.scored - row.conceded;

  table.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.scored !== a.scored) return b.scored - a.scored;

    const direct = finished.find(m =>
      (m.a === a.teamNo && m.b === b.teamNo) ||
      (m.a === b.teamNo && m.b === a.teamNo)
    );

    if (direct) {
      const wi = winnerIndex(direct);
      if (wi === a.teamNo) return -1;
      if (wi === b.teamNo) return 1;
    }

    return a.teamNo - b.teamNo;
  });

  return table;
}

function determineBaseWinner(t) {
  const table = calculateStandings(t);
  return table[0]?.name || "";
}

function makeFinalMatch(id, round, court, a, b) {
  return {
    id,
    round,
    court,
    a,
    b,
    scoreA: 0,
    scoreB: 0,
    finished: false,
    updatedAt: 0,
    ...timerFields()
  };
}

function createFinal(state) {
  const bases = ["T1", "T2", "T3", "T4"].map(id => getTournament(state, id));
  assert(bases.every(Boolean), "Hiányzik valamelyik alapbajnokság.");
  assert(
    bases.every(t => t.winner),
    "A döntőhöz mind a 4 alapbajnokságnak kell győztes."
  );

  const f = getTournament(state, "FINAL");
  const teams = bases.map(t => t.winner);

  Object.assign(f, {
    enabled: true,
    teams,
    winner: "",
    currentRound: 1,
    roundEndAt: 0,
    roundRunning: false,
    roundPaused: false,
    roundPausedRemainingMs: 0,
    matches: [
      makeFinalMatch("SF1", 1, 1, 0, 3),
      makeFinalMatch("SF2", 1, 2, 1, 2),
      makeFinalMatch("F", 2, 1, null, null)
    ]
  });

  state.activeTournamentId = "FINAL";
}

function finishSingleMatch(m, now) {
  assert(m.a != null && m.b != null, "A mérkőzés párosítása még nem ismert.");
  assert(!m.finished, "A mérkőzés már lezárt.");
  assert(
    m.scoreA !== m.scoreB,
    `${m.court}. pálya: döntetlen nincs, a következő pont nyer.`
  );

  m.finished = true;
  m.updatedAt = now;
  clearMatchTimer(m);
}

function advanceRoundIfComplete(t) {
  const current = currentMatches(t);
  if (!current.length || !current.every(m => m.finished)) {
    syncLegacyRoundTimer(t);
    return { advanced: false, tournamentFinished: false };
  }

  if (t.id === "FINAL") {
    if (t.currentRound === 1) {
      const semis = [...current].sort((a, b) => a.court - b.court);
      const final = t.matches.find(m => Number(m.round) === 2);
      final.a = winnerIndex(semis[0]);
      final.b = winnerIndex(semis[1]);
      clearMatchTimer(final);
      t.currentRound = 2;
      syncLegacyRoundTimer(t);
      return { advanced: true, tournamentFinished: false };
    }

    const finalMatch = current[0];
    const wi = winnerIndex(finalMatch);
    t.winner = t.teams[wi] || "";
    syncLegacyRoundTimer(t);
    return { advanced: false, tournamentFinished: true };
  }

  if (t.currentRound < 3) {
    t.currentRound += 1;
    syncLegacyRoundTimer(t);
    return { advanced: true, tournamentFinished: false };
  }

  t.winner = determineBaseWinner(t);
  syncLegacyRoundTimer(t);
  return { advanced: false, tournamentFinished: true };
}

function strictFinishRound(t, now) {
  const current = currentMatches(t);
  assert(current.length > 0, "Nincs lezárható mérkőzés ebben a fordulóban.");

  for (const m of current) {
    assert(m.a != null && m.b != null, "A mérkőzés párosítása még nem ismert.");
    assert(
      m.scoreA !== m.scoreB,
      `${m.court}. pálya: döntetlen nincs, a következő pont nyer.`
    );
  }

  for (const m of current) {
    if (!m.finished) finishSingleMatch(m, now);
  }

  return advanceRoundIfComplete(t);
}

function startMatches(t, court, now) {
  const targets = currentTargets(t, court);
  assert(targets.length > 0, "Nincs indítható mérkőzés.");

  let changed = 0;

  for (const m of targets) {
    assert(m.a != null && m.b != null, `${m.court}. pálya: a párosítás még nem ismert.`);
    if (m.timerRunning) continue;

    const resumeMs =
      m.timerPaused && Number(m.timerPausedRemainingMs || 0) > 0
        ? Number(m.timerPausedRemainingMs)
        : Number(t.roundSeconds || 0) * 1000;

    m.timerRunning = true;
    m.timerPaused = false;
    m.timerPausedRemainingMs = 0;
    m.timerEndAt = now + resumeMs;
    changed += 1;
  }

  assert(changed > 0, "A kiválasztott mérkőzés időmérője már fut.");
  syncLegacyRoundTimer(t);
}

function pauseMatches(t, court, now) {
  const targets = currentTargets(t, court);
  assert(targets.length > 0, "Nincs szüneteltethető mérkőzés.");

  let changed = 0;

  for (const m of targets) {
    if (!m.timerRunning) continue;

    const remainingMs = matchRemainingMs(t, m, now);
    if (remainingMs <= 0) continue;

    m.timerRunning = false;
    m.timerPaused = true;
    m.timerPausedRemainingMs = remainingMs;
    m.timerEndAt = 0;
    changed += 1;
  }

  assert(changed > 0, "Nincs futó időmérő, amit szüneteltetni lehet.");
  syncLegacyRoundTimer(t);
}

function resetTimers(t, court) {
  const targets = currentTargets(t, court);
  assert(targets.length > 0, "Nincs nullázható időmérő.");

  for (const m of targets) clearMatchTimer(m);
  syncLegacyRoundTimer(t);
}

function stopMatches(t, court, now) {
  const targets = currentTargets(t, court);
  assert(targets.length > 0, "Nincs lezárható mérkőzés.");

  for (const m of targets) {
    assert(m.a != null && m.b != null, `${m.court}. pálya: a párosítás még nem ismert.`);
  }

  const tied = targets.filter(m => m.scoreA === m.scoreB);
  const closable = targets.filter(m => m.scoreA !== m.scoreB);

  if (!closable.length) {
    const courts = tied.map(m => `${m.court}. pálya`).join(", ");
    throw new Error(`${courts}: döntetlen nincs, a következő pont nyer.`);
  }

  for (const m of closable) finishSingleMatch(m, now);
  const progress = advanceRoundIfComplete(t);

  if (tied.length) {
    const closedText = closable.map(m => `${m.court}. pálya lezárva`).join(", ");
    const tiedText = tied.map(m => `${m.court}. pálya döntetlen`).join(", ");
    return `${closedText}. ${tiedText} – a következő pont nyer.`;
  }

  if (progress.tournamentFinished) return "Mérkőzés lezárva. A bajnokság befejeződött.";
  if (progress.advanced) return "Forduló lezárva. Következő forduló indításra kész.";

  return closable.length > 1
    ? "Mindkét mérkőzés lezárva."
    : `${closable[0].court}. pálya mérkőzése lezárva.`;
}

function actionIdKnown(state, actionId) {
  return actionId && state.recentActionIds.includes(actionId);
}

function rememberAction(state, actionId) {
  if (!actionId) return;
  state.recentActionIds.push(actionId);
  if (state.recentActionIds.length > 500) {
    state.recentActionIds = state.recentActionIds.slice(-500);
  }
}

export function applyAction(inputState, action, now = Date.now()) {
  const state = normalizeStateInPlace(JSON.parse(JSON.stringify(inputState)));
  const actionId = String(action?.actionId || "");

  if (actionIdKnown(state, actionId)) {
    return { state, duplicate: true, notice: "" };
  }

  const type = String(action?.type || "");
  const tournamentId = String(
    action?.tournamentId || state.activeTournamentId || "T1"
  );
  const t = getTournament(state, tournamentId);
  let notice = "";

  switch (type) {
    case "SET_ACTIVE_TOURNAMENT": {
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      state.activeTournamentId = tournamentId;
      break;
    }

    case "CHANGE_SCORE": {
      assert(playableEvent(state), "Pontozni csak LIVE módban lehet.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");

      const m = findMatch(t, action.round, action.court);
      assert(m, "A mérkőzés nem található.");
      assert(m.round === t.currentRound, "Csak az aktuális forduló pontozható.");
      assert(!m.finished, "A mérkőzés már lezárt.");
      assert(m.a != null && m.b != null, "A párosítás még nem ismert.");

      const delta = Number(action.delta);
      assert(delta === 1 || delta === -1, "Érvénytelen pontmódosítás.");

      if (action.side === "A") m.scoreA = clampScore(m.scoreA + delta);
      else if (action.side === "B") m.scoreB = clampScore(m.scoreB + delta);
      else throw new Error("Érvénytelen oldal.");

      m.updatedAt = now;
      break;
    }

    case "START_MATCH":
    case "START_ROUND": {
      assert(playableEvent(state), "Az időmérő csak LIVE módban indítható.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      assert(!t.winner, "Ez a bajnokság már lezárult.");

      const court = type === "START_ROUND" ? 0 : Number(action.court || 0);
      startMatches(t, court, now);
      break;
    }

    case "PAUSE_MATCH":
    case "PAUSE_ROUND": {
      assert(playableEvent(state), "Szüneteltetni csak LIVE módban lehet.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");

      const court = type === "PAUSE_ROUND" ? 0 : Number(action.court || 0);
      pauseMatches(t, court, now);
      break;
    }

    case "RESET_TIMER": {
      assert(editableEvent(state), "Az esemény archivált.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      resetTimers(t, Number(action.court || 0));
      break;
    }

    case "STOP_MATCH": {
      assert(playableEvent(state), "Mérkőzést csak LIVE módban lehet lezárni.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      notice = stopMatches(t, Number(action.court || 0), now);
      break;
    }

    // v0.5.3 kliens-kompatibilitás: a régi STOP továbbra is
    // szigorúan a teljes fordulót zárja.
    case "STOP_ROUND":
    case "FINISH_ROUND": {
      assert(playableEvent(state), "Fordulót csak LIVE módban lehet lezárni.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      const progress = strictFinishRound(t, now);
      notice = progress.tournamentFinished
        ? "A bajnokság befejeződött."
        : progress.advanced
          ? "Forduló lezárva. Következő forduló indításra kész."
          : "Forduló lezárva.";
      break;
    }

    case "RESET_MATCH": {
      assert(editableEvent(state), "Az esemény archivált.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");

      const m = findMatch(t, action.round, action.court);
      assert(m, "A mérkőzés nem található.");
      assert(
        !m.finished,
        "Lezárt mérkőzést előbb a bajnokság nullázásával lehet újranyitni."
      );

      m.scoreA = 0;
      m.scoreB = 0;
      m.updatedAt = now;
      clearMatchTimer(m);
      syncLegacyRoundTimer(t);
      break;
    }

    case "SAVE_TOURNAMENT_SETTINGS": {
      assert(editableEvent(state), "Az esemény archivált.");
      assert(t && t.id !== "FINAL", "A Final Four csapatai automatikusan jönnek létre.");

      const names = Array.isArray(action.teams)
        ? action.teams.map(x => String(x || "").trim())
        : [];

      assert(
        names.length === 4 && names.every(Boolean),
        "Pontosan 4 csapatnév szükséges."
      );

      const seconds = Math.round(Number(action.roundSeconds));
      assert(
        Number.isFinite(seconds) && seconds >= 60 && seconds <= 1800,
        "A meccsidő 1–30 perc lehet."
      );

      t.nameHu = String(action.nameHu || t.nameHu).trim();
      t.nameEn = String(action.nameEn || t.nameEn).trim();
      t.time = String(action.time || "").trim();
      t.roundSeconds = seconds;
      t.teams = names;
      break;
    }

    case "RESET_TOURNAMENT": {
      assert(editableEvent(state), "Az esemény archivált.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      resetTournamentScores(t);
      break;
    }

    case "CREATE_FINAL": {
      assert(editableEvent(state), "Az esemény archivált.");
      createFinal(state);
      break;
    }

    case "SET_EVENT_STATUS": {
      const status = String(action.status || "").toUpperCase();
      assert(EVENT_STATUSES.includes(status), "Ismeretlen eseményállapot.");
      state.eventStatus = status;

      if (status !== "LIVE") {
        for (const tournament of state.tournaments) {
          for (const m of tournament.matches || []) clearMatchTimer(m);
          syncLegacyRoundTimer(tournament);
        }
      }
      break;
    }

    case "SET_ARCHIVE_AT": {
      assert(editableEvent(state), "Az esemény archivált.");
      const value = Number(action.archiveAt || 0);
      assert(
        value === 0 || value > now,
        "Az automatikus archiválás időpontja legyen a jövőben."
      );
      state.archiveAt = value;
      break;
    }

    case "RESET_EVENT": {
      const fresh = defaultState();
      fresh.rev = state.rev;
      fresh.eventStatus = "UPCOMING";
      fresh.archiveAt = 0;
      fresh.recentActionIds = state.recentActionIds;
      Object.assign(state, fresh);
      break;
    }

    default:
      throw new Error("Ismeretlen művelet.");
  }

  rememberAction(state, actionId);
  state.rev = Number(state.rev || 0) + 1;
  state.lastUpdatedAt = now;

  return { state, duplicate: false, notice };
}

export function decorateState(rawState) {
  const state = normalizeStateInPlace(JSON.parse(JSON.stringify(rawState)));
  delete state.recentActionIds;

  for (const t of state.tournaments) {
    t.standings = t.id === "FINAL" ? [] : calculateStandings(t);
  }

  return state;
}
