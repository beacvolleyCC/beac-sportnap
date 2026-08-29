import assert from "node:assert/strict";
import { defaultState, applyAction, calculateStandings, decorateState } from "../src/model.js";

let s = defaultState();
assert.equal(s.tournaments.length, 5);
assert.equal(s.tournaments[0].matches.length, 6);

let r = applyAction(s, { type:"SET_EVENT_STATUS", status:"LIVE", actionId:"a1" }, 1000);
s = r.state;
assert.equal(s.eventStatus, "LIVE");

r = applyAction(s, { type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:1, side:"A", delta:1, actionId:"a2" }, 1100);
s = r.state;
assert.equal(s.tournaments[0].matches[0].scoreA, 1);

const dup = applyAction(s, { type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:1, side:"A", delta:1, actionId:"a2" }, 1200);
assert.equal(dup.duplicate, true);
assert.equal(dup.state.tournaments[0].matches[0].scoreA, 1);

assert.throws(() => applyAction(s, { type:"FINISH_ROUND", tournamentId:"T1", actionId:"tie" }, 1300), /döntetlen/i);

r = applyAction(s, { type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:2, side:"B", delta:1, actionId:"a3" }, 1400);
s = r.state;
r = applyAction(s, { type:"FINISH_ROUND", tournamentId:"T1", actionId:"a4" }, 1500);
s = r.state;
assert.equal(s.tournaments[0].currentRound, 2);
assert.equal(s.tournaments[0].matches[0].finished, true);
assert.equal(s.tournaments[0].matches[1].finished, true);

const decorated = decorateState(s);
assert.ok(Array.isArray(decorated.tournaments[0].standings));
assert.equal("recentActionIds" in decorated, false);



// v0.5.3 timer state machine
let timerState = defaultState();
timerState = applyAction(
  timerState,
  { type:"SET_EVENT_STATUS", status:"LIVE", actionId:"timer-live" },
  10000
).state;

timerState = applyAction(
  timerState,
  { type:"START_ROUND", tournamentId:"T1", actionId:"timer-start" },
  11000
).state;

let timerT = timerState.tournaments[0];
assert.equal(timerT.roundRunning, true);
assert.equal(Boolean(timerT.roundPaused), false);
assert.equal(timerT.roundEndAt, 11000 + timerT.roundSeconds * 1000);

timerState = applyAction(
  timerState,
  { type:"PAUSE_ROUND", tournamentId:"T1", actionId:"timer-pause" },
  21000
).state;

timerT = timerState.tournaments[0];
assert.equal(timerT.roundRunning, false);
assert.equal(timerT.roundPaused, true);
assert.equal(timerT.roundEndAt, 0);
assert.equal(timerT.roundPausedRemainingMs, timerT.roundSeconds * 1000 - 10000);

const pausedRemaining = timerT.roundPausedRemainingMs;

timerState = applyAction(
  timerState,
  { type:"START_ROUND", tournamentId:"T1", actionId:"timer-resume" },
  31000
).state;

timerT = timerState.tournaments[0];
assert.equal(timerT.roundRunning, true);
assert.equal(timerT.roundPaused, false);
assert.equal(timerT.roundPausedRemainingMs, 0);
assert.equal(timerT.roundEndAt, 31000 + pausedRemaining);

// STOP = current round close; tie blocks
let stopState = defaultState();
stopState = applyAction(
  stopState,
  { type:"SET_EVENT_STATUS", status:"LIVE", actionId:"stop-live" },
  50000
).state;

assert.throws(
  () => applyAction(
    stopState,
    { type:"STOP_ROUND", tournamentId:"T1", actionId:"stop-tied" },
    51000
  ),
  /döntetlen/i
);

stopState = applyAction(
  stopState,
  { type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:1, side:"A", delta:1, actionId:"stop-p1" },
  52000
).state;

stopState = applyAction(
  stopState,
  { type:"CHANGE_SCORE", tournamentId:"T1", round:1, court:2, side:"B", delta:1, actionId:"stop-p2" },
  53000
).state;

stopState = applyAction(
  stopState,
  { type:"STOP_ROUND", tournamentId:"T1", actionId:"stop-ok" },
  54000
).state;

const stopT = stopState.tournaments[0];
assert.equal(stopT.currentRound, 2);
assert.equal(stopT.matches[0].finished, true);
assert.equal(stopT.matches[1].finished, true);
assert.equal(stopT.roundRunning, false);
assert.equal(Boolean(stopT.roundPaused), false);

console.log("MODEL TESTS OK");
