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

console.log("MODEL TESTS OK");
