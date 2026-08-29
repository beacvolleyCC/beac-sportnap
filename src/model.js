export const EVENT_STATUSES = ["UPCOMING", "LIVE", "ARCHIVED", "CLOSED"];

const BASE_PAIRINGS = [
  { round: 1, court: 1, a: 0, b: 1 },
  { round: 1, court: 2, a: 2, b: 3 },
  { round: 2, court: 1, a: 0, b: 2 },
  { round: 2, court: 2, a: 1, b: 3 },
  { round: 3, court: 1, a: 0, b: 3 },
  { round: 3, court: 2, a: 1, b: 2 }
];

function matchRows() {
  return BASE_PAIRINGS.map((m, i) => ({
    id: `M${i + 1}`,
    ...m,
    scoreA: 0,
    scoreB: 0,
    finished: false,
    updatedAt: 0
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
    version: 1,
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

function resetTournamentScores(t) {
  t.currentRound = 1;
  t.roundEndAt = 0;
  t.roundRunning = false;
  t.roundPaused = false;
  t.roundPausedRemainingMs = 0;
  t.winner = "";

  for (const m of t.matches) {
    m.scoreA = 0;
    m.scoreB = 0;
    m.finished = false;
    m.updatedAt = 0;
  }
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

function createFinal(state) {
  const bases = ["T1", "T2", "T3", "T4"].map(id => getTournament(state, id));
  assert(bases.every(Boolean), "Hiányzik valamelyik alapbajnokság.");
  assert(bases.every(t => t.winner), "A döntőhöz mind a 4 alapbajnokságnak kell győztes.");

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
      {
        id: "SF1", round: 1, court: 1, a: 0, b: 3,
        scoreA: 0, scoreB: 0, finished: false, updatedAt: 0
      },
      {
        id: "SF2", round: 1, court: 2, a: 1, b: 2,
        scoreA: 0, scoreB: 0, finished: false, updatedAt: 0
      },
      {
        id: "F", round: 2, court: 1, a: null, b: null,
        scoreA: 0, scoreB: 0, finished: false, updatedAt: 0
      }
    ]
  });

  state.activeTournamentId = "FINAL";
}

function finishRound(state, t, now) {
  const current = t.matches.filter(m => m.round === t.currentRound);
  assert(current.length > 0, "Nincs lezárható mérkőzés ebben a fordulóban.");

  for (const m of current) {
    assert(m.a != null && m.b != null, "A mérkőzés párosítása még nem ismert.");
    assert(m.scoreA !== m.scoreB, `${m.court}. pálya: döntetlen nincs, a következő pont nyer.`);
  }

  for (const m of current) {
    m.finished = true;
    m.updatedAt = now;
  }

  t.roundRunning = false;
  t.roundEndAt = 0;
  t.roundPaused = false;
  t.roundPausedRemainingMs = 0;

  if (t.id === "FINAL") {
    if (t.currentRound === 1) {
      const semis = current.sort((a, b) => a.court - b.court);
      const final = t.matches.find(m => m.round === 2);
      final.a = winnerIndex(semis[0]);
      final.b = winnerIndex(semis[1]);
      t.currentRound = 2;
      return;
    }

    const finalMatch = current[0];
    const wi = winnerIndex(finalMatch);
    t.winner = t.teams[wi] || "";
    return;
  }

  if (t.currentRound < 3) {
    t.currentRound += 1;
  } else {
    t.winner = determineBaseWinner(t);
  }
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
  const state = JSON.parse(JSON.stringify(inputState));
  const actionId = String(action?.actionId || "");

  if (actionIdKnown(state, actionId)) {
    return { state, duplicate: true };
  }

  const type = String(action?.type || "");
  const tournamentId = String(action?.tournamentId || state.activeTournamentId || "T1");
  const t = getTournament(state, tournamentId);

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

    case "START_ROUND": {
      assert(playableEvent(state), "Az időmérő csak LIVE módban indítható.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      assert(!t.winner, "Ez a bajnokság már lezárult.");
      const current = t.matches.filter(m => m.round === t.currentRound);
      assert(current.length > 0, "Nincs mérkőzés az aktuális fordulóban.");

      const resumeMs =
        t.roundPaused && Number(t.roundPausedRemainingMs || 0) > 0
          ? Number(t.roundPausedRemainingMs)
          : Number(t.roundSeconds || 0) * 1000;

      t.roundRunning = true;
      t.roundPaused = false;
      t.roundPausedRemainingMs = 0;
      t.roundEndAt = now + resumeMs;
      break;
    }

    case "PAUSE_ROUND": {
      assert(playableEvent(state), "Szüneteltetni csak LIVE módban lehet.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      assert(t.roundRunning, "Az időmérő jelenleg nem fut.");

      const remainingMs = Math.max(0, Number(t.roundEndAt || 0) - now);
      assert(remainingMs > 0, "Az idő már lejárt.");

      t.roundRunning = false;
      t.roundPaused = true;
      t.roundPausedRemainingMs = remainingMs;
      t.roundEndAt = 0;
      break;
    }

    case "RESET_TIMER": {
      assert(editableEvent(state), "Az esemény archivált.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      t.roundRunning = false;
      t.roundPaused = false;
      t.roundPausedRemainingMs = 0;
      t.roundEndAt = 0;
      break;
    }

    case "STOP_ROUND": {
      assert(playableEvent(state), "Mérkőzést csak LIVE módban lehet lezárni.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      finishRound(state, t, now);
      break;
    }

    case "RESET_MATCH": {
      assert(editableEvent(state), "Az esemény archivált.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      const m = findMatch(t, action.round, action.court);
      assert(m, "A mérkőzés nem található.");
      assert(!m.finished, "Lezárt mérkőzést előbb a bajnokság nullázásával lehet újranyitni.");
      m.scoreA = 0;
      m.scoreB = 0;
      m.updatedAt = now;
      break;
    }

    case "FINISH_ROUND": {
      assert(playableEvent(state), "Fordulót csak LIVE módban lehet lezárni.");
      assert(t && t.enabled, "A bajnokság nem érhető el.");
      finishRound(state, t, now);
      break;
    }

    case "SAVE_TOURNAMENT_SETTINGS": {
      assert(editableEvent(state), "Az esemény archivált.");
      assert(t && t.id !== "FINAL", "A Final Four csapatai automatikusan jönnek létre.");

      const names = Array.isArray(action.teams) ? action.teams.map(x => String(x || "").trim()) : [];
      assert(names.length === 4 && names.every(Boolean), "Pontosan 4 csapatnév szükséges.");

      const seconds = Math.round(Number(action.roundSeconds));
      assert(Number.isFinite(seconds) && seconds >= 60 && seconds <= 1800, "A meccsidő 1–30 perc lehet.");

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
          tournament.roundRunning = false;
          tournament.roundPaused = false;
          tournament.roundPausedRemainingMs = 0;
          tournament.roundEndAt = 0;
        }
      }
      break;
    }

    case "SET_ARCHIVE_AT": {
      assert(editableEvent(state), "Az esemény archivált.");
      const value = Number(action.archiveAt || 0);
      assert(value === 0 || value > now, "Az automatikus archiválás időpontja legyen a jövőben.");
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

  return { state, duplicate: false };
}

export function decorateState(rawState) {
  const state = JSON.parse(JSON.stringify(rawState));
  delete state.recentActionIds;

  for (const t of state.tournaments) {
    t.standings = t.id === "FINAL" ? [] : calculateStandings(t);
  }

  return state;
}
