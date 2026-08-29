import assert from "node:assert/strict";
import {
  defaultState,
  applyAction,
  calculateStandings,
  decorateState
} from "../src/model.js";

function liveState() {
  return applyAction(
    defaultState(),
    { type:"SET_EVENT_STATUS", status:"LIVE", actionId:`live-${Math.random()}` },
    1000
  ).state;
}

function t1(state) {
  return state.tournaments.find(t=>t.id==="T1");
}

function match(state, round, court) {
  return t1(state).matches.find(
    m=>Number(m.round)===Number(round)&&Number(m.court)===Number(court)
  );
}

// Alapállapot
let s = defaultState();
assert.equal(s.version, 2);
assert.equal(s.tournaments.length, 5);
assert.equal(s.tournaments[0].matches.length, 6);
assert.equal(s.tournaments[0].matches[0].timerRunning, false);

// Pontozás + deduplikáció
s = liveState();
let r = applyAction(
  s,
  {
    type:"CHANGE_SCORE",
    tournamentId:"T1",
    round:1,
    court:1,
    side:"A",
    delta:1,
    actionId:"score-a"
  },
  1100
);
s = r.state;
assert.equal(match(s,1,1).scoreA, 1);

const dup = applyAction(
  s,
  {
    type:"CHANGE_SCORE",
    tournamentId:"T1",
    round:1,
    court:1,
    side:"A",
    delta:1,
    actionId:"score-a"
  },
  1200
);
assert.equal(dup.duplicate, true);
assert.equal(match(dup.state,1,1).scoreA, 1);

// 1. pálya indulása nem indítja a 2.-at
let timer = liveState();
timer = applyAction(
  timer,
  { type:"START_MATCH", tournamentId:"T1", court:1, actionId:"start-c1" },
  10000
).state;

assert.equal(match(timer,1,1).timerRunning, true);
assert.equal(match(timer,1,1).timerEndAt, 10000 + 480000);
assert.equal(match(timer,1,2).timerRunning, false);

// 2. pálya külön indulhat
timer = applyAction(
  timer,
  { type:"START_MATCH", tournamentId:"T1", court:2, actionId:"start-c2" },
  15000
).state;

assert.equal(match(timer,1,1).timerEndAt, 490000);
assert.equal(match(timer,1,2).timerEndAt, 495000);

// 1. pálya pause nem állítja meg a 2.-at
timer = applyAction(
  timer,
  { type:"PAUSE_MATCH", tournamentId:"T1", court:1, actionId:"pause-c1" },
  20000
).state;

assert.equal(match(timer,1,1).timerRunning, false);
assert.equal(match(timer,1,1).timerPaused, true);
assert.equal(match(timer,1,1).timerPausedRemainingMs, 470000);
assert.equal(match(timer,1,2).timerRunning, true);

// Resume ugyanonnan
timer = applyAction(
  timer,
  { type:"START_MATCH", tournamentId:"T1", court:1, actionId:"resume-c1" },
  30000
).state;

assert.equal(match(timer,1,1).timerRunning, true);
assert.equal(match(timer,1,1).timerPaused, false);
assert.equal(match(timer,1,1).timerEndAt, 500000);

// Globális pause minden éppen futó pályát megállít
timer = applyAction(
  timer,
  { type:"PAUSE_MATCH", tournamentId:"T1", court:0, actionId:"pause-both" },
  40000
).state;

assert.equal(match(timer,1,1).timerPaused, true);
assert.equal(match(timer,1,2).timerPaused, true);

// Globális folytatás mindkettőt folytatja
timer = applyAction(
  timer,
  { type:"START_MATCH", tournamentId:"T1", court:0, actionId:"resume-both" },
  50000
).state;

assert.equal(match(timer,1,1).timerRunning, true);
assert.equal(match(timer,1,2).timerRunning, true);

// Egy pálya STOP-ja csak azt a meccset zárja
let stop = liveState();
stop = applyAction(
  stop,
  {
    type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:1,
    side:"A", delta:1, actionId:"c1-point"
  },
  60000
).state;

r = applyAction(
  stop,
  { type:"STOP_MATCH", tournamentId:"T1", court:1, actionId:"stop-c1" },
  61000
);
stop = r.state;

assert.equal(match(stop,1,1).finished, true);
assert.equal(match(stop,1,2).finished, false);
assert.equal(t1(stop).currentRound, 1);
assert.match(r.notice, /1\. pálya/i);

// Lezárt meccs nem pontozható tovább
assert.throws(
  () => applyAction(
    stop,
    {
      type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:1,
      side:"A", delta:1, actionId:"closed-score"
    },
    62000
  ),
  /lezárt/i
);

// A második pálya külön lezárása után automatikus következő forduló
stop = applyAction(
  stop,
  {
    type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:2,
    side:"B", delta:1, actionId:"c2-point"
  },
  63000
).state;

r = applyAction(
  stop,
  { type:"STOP_MATCH", tournamentId:"T1", court:2, actionId:"stop-c2" },
  64000
);
stop = r.state;

assert.equal(match(stop,1,2).finished, true);
assert.equal(t1(stop).currentRound, 2);
assert.match(r.notice, /következő forduló/i);

// Globális STOP: lezárja a nem döntetlent, döntetlent nyitva hagyja
let globalStop = liveState();

globalStop = applyAction(
  globalStop,
  {
    type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:1,
    side:"A", delta:1, actionId:"gs-c1"
  },
  70000
).state;

r = applyAction(
  globalStop,
  { type:"STOP_MATCH", tournamentId:"T1", court:0, actionId:"gs-stop" },
  71000
);
globalStop = r.state;

assert.equal(match(globalStop,1,1).finished, true);
assert.equal(match(globalStop,1,2).finished, false);
assert.equal(t1(globalStop).currentRound, 1);
assert.match(r.notice, /2\. pálya döntetlen/i);

// Ha minden célmeccs döntetlen, STOP blokkol
assert.throws(
  () => applyAction(
    liveState(),
    { type:"STOP_MATCH", tournamentId:"T1", court:0, actionId:"all-tied" },
    72000
  ),
  /döntetlen/i
);

// Régi v0.5.3 állapot migrálható: közös timer -> két meccstimer
let legacy = defaultState();
legacy.version = 1;
const legacyT = t1(legacy);
legacyT.roundRunning = true;
legacyT.roundEndAt = 999999;

for (const m of legacyT.matches) {
  delete m.timerRunning;
  delete m.timerPaused;
  delete m.timerEndAt;
  delete m.timerPausedRemainingMs;
}

const migrated = decorateState(legacy);
const migratedT = migrated.tournaments.find(t=>t.id==="T1");
const migratedCurrent = migratedT.matches.filter(m=>m.round===1);
assert.equal(migrated.version, 2);
assert.equal(migratedCurrent[0].timerRunning, true);
assert.equal(migratedCurrent[1].timerRunning, true);
assert.equal(migratedCurrent[0].timerEndAt, 999999);
assert.equal(migratedCurrent[1].timerEndAt, 999999);

// Legacy FINISH_ROUND továbbra is szigorú
let legacyFinish = liveState();
assert.throws(
  () => applyAction(
    legacyFinish,
    { type:"FINISH_ROUND", tournamentId:"T1", actionId:"legacy-tie" },
    80000
  ),
  /döntetlen/i
);

legacyFinish = applyAction(
  legacyFinish,
  {
    type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:1,
    side:"A", delta:1, actionId:"lf1"
  },
  80100
).state;

legacyFinish = applyAction(
  legacyFinish,
  {
    type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:2,
    side:"B", delta:1, actionId:"lf2"
  },
  80200
).state;

legacyFinish = applyAction(
  legacyFinish,
  { type:"FINISH_ROUND", tournamentId:"T1", actionId:"legacy-finish" },
  80300
).state;

assert.equal(t1(legacyFinish).currentRound, 2);

// Standings/decorate regresszió
const decorated = decorateState(legacyFinish);
assert.ok(Array.isArray(decorated.tournaments[0].standings));
assert.equal("recentActionIds" in decorated, false);

const table = calculateStandings(t1(legacyFinish));
assert.equal(table.length, 4);



// v0.5.6 – alapbajnokság nullázása törli a korábban létrehozott Final Fourt
let finalResetState = liveState();

// Gyorsan készre állítjuk a 4 alapbajnokságot úgy, hogy legyen győztesük.
for (const tournamentId of ["T1","T2","T3","T4"]) {
  const tt = finalResetState.tournaments.find(x=>x.id===tournamentId);

  for (const round of [1,2,3]) {
    const current = tt.matches.filter(m=>m.round===round);
    for (const m of current) {
      finalResetState = applyAction(
        finalResetState,
        {
          type:"CHANGE_SCORE",
          tournamentId,
          round,
          court:m.court,
          side:"A",
          delta:1,
          actionId:`${tournamentId}-r${round}-c${m.court}-pt`
        },
        90000 + round
      ).state;
    }

    finalResetState = applyAction(
      finalResetState,
      {
        type:"FINISH_ROUND",
        tournamentId,
        actionId:`${tournamentId}-r${round}-finish`
      },
      91000 + round
    ).state;
  }
}

finalResetState = applyAction(
  finalResetState,
  { type:"CREATE_FINAL", actionId:"create-final-for-reset-test" },
  92000
).state;

let finalT = finalResetState.tournaments.find(t=>t.id==="FINAL");
assert.equal(finalT.enabled, true);
assert.equal(finalT.teams.length, 4);
assert.ok(finalT.matches.length > 0);
assert.equal(finalResetState.activeTournamentId, "FINAL");

// Egy alapbajnokság nullázása automatikusan érvényteleníti a döntőt.
finalResetState = applyAction(
  finalResetState,
  {
    type:"RESET_TOURNAMENT",
    tournamentId:"T1",
    actionId:"reset-base-clears-final"
  },
  93000
).state;

finalT = finalResetState.tournaments.find(t=>t.id==="FINAL");
assert.equal(finalT.enabled, false);
assert.deepEqual(finalT.teams, []);
assert.deepEqual(finalT.matches, []);
assert.equal(finalT.winner, "");
assert.equal(finalResetState.activeTournamentId, "T1");

console.log("MODEL TESTS OK – v0.5.6 Final reset cascade");
