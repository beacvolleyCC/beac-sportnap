let pin="";
let state=null;
let selectedId=localStorage.getItem("beac-admin-tournament")||"";
let courtFilter=Number(localStorage.getItem("beac-court-filter")||0);
let ws=null;
let reconnectTimer=null;
let page="match";

const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const queueKey="beac-score-queue-v1";

function toast(text){
  const el=$("toast");el.textContent=text;el.classList.remove("hidden");
  clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.add("hidden"),2600);
}
function setConnection(kind,text){
  const el=$("connection");el.className=`connection ${kind}`;el.textContent=text;
}
function getQueue(){try{return JSON.parse(localStorage.getItem(queueKey)||"[]");}catch{return[];}}
function saveQueue(q){localStorage.setItem(queueKey,JSON.stringify(q));}
function addQueue(action){const q=getQueue();q.push(action);saveQueue(q);}
function removeQueue(id){saveQueue(getQueue().filter(a=>a.actionId!==id));}
function makeId(){return crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;}

async function login(){
  pin=$("pin").value.trim();
  $("loginError").textContent="";
  try{
    const res=await fetch("/api/login",{method:"POST",headers:{"x-admin-pin":pin}});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.error||"Hibás PIN.");
    sessionStorage.setItem("beac-pin",pin);
    $("loginScreen").classList.add("hidden");$("adminApp").classList.remove("hidden");$("bottomNav").classList.remove("hidden");
    await loadState();flushQueue();
  }catch(e){$("loginError").textContent=e.message||String(e);}
}
$("loginBtn").onclick=login;$("pin").onkeydown=e=>{if(e.key==="Enter")login();};

async function loadState(){
  try{
    const res=await fetch("/api/state",{cache:"no-store"});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.error||"Betöltési hiba");
    acceptState(data.state);
  }catch(e){setConnection("offline","OFFLINE");toast(e.message||String(e));}
}

function acceptState(next,ackActionId=null){
  if(ackActionId)removeQueue(ackActionId);
  if(state&&Number(next.rev)<Number(state.rev))return;
  state=next;
  const enabled=state.tournaments.filter(t=>t.enabled);
  if(!enabled.some(t=>t.id===selectedId))selectedId=enabled.some(t=>t.id===state.activeTournamentId)?state.activeTournamentId:enabled[0]?.id;
  localStorage.setItem("beac-admin-tournament",selectedId||"");
  render();
  if(state.eventStatus==="LIVE")connectWs();else disconnectWs();
}

function connectWs(){
  if(ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState))return;
  clearTimeout(reconnectTimer);
  const proto=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen=()=>setConnection("online","REALTIME");
  ws.onmessage=e=>{
    if(e.data==="pong")return;
    try{const msg=JSON.parse(e.data);if(msg.type==="STATE")acceptState(msg.state,msg.ackActionId);}catch{}
  };
  ws.onclose=()=>{ws=null;if(state?.eventStatus==="LIVE"){setConnection("offline","ÚJRACSATLAKOZÁS");reconnectTimer=setTimeout(connectWs,1600);}else setConnection("","NEM LIVE");};
  ws.onerror=()=>{};
}

function disconnectWs(){clearTimeout(reconnectTimer);if(ws){try{ws.close();}catch{}ws=null;}setConnection("",state?.eventStatus==="ARCHIVED"?"ARCHÍV":"NEM LIVE");}
setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)try{ws.send("ping");}catch{}},30000);
window.addEventListener("online",()=>{flushQueue();if(state?.eventStatus==="LIVE")connectWs();});
window.addEventListener("offline",()=>setConnection("offline","OFFLINE"));

function currentT(){return state?.tournaments.find(t=>t.id===selectedId);}

function currentMatches(t){
  return (t?.matches||[]).filter(m=>Number(m.round)===Number(t.currentRound));
}

function matchRemaining(t,m){
  if(!m)return Number(t?.roundSeconds||0);

  if(m.timerPaused){
    return Math.max(0,Math.ceil(Number(m.timerPausedRemainingMs||0)/1000));
  }

  if(m.timerRunning){
    return Math.max(0,Math.ceil((Number(m.timerEndAt||0)-Date.now())/1000));
  }

  // Régi v0.5.3 állapot fallback.
  if(m.timerRunning===undefined){
    if(t.roundPaused){
      return Math.max(0,Math.ceil(Number(t.roundPausedRemainingMs||0)/1000));
    }
    if(t.roundRunning&&t.roundEndAt){
      return Math.max(0,Math.ceil((Number(t.roundEndAt)-Date.now())/1000));
    }
  }

  return Number(t?.roundSeconds||0);
}

function matchMode(t,m){
  if(!m)return "missing";
  if(m.finished)return "finished";
  if(m.timerPaused)return "paused";
  if(m.timerRunning)return matchRemaining(t,m)<=0?"expired":"running";
  return "ready";
}

function fmt(s){return`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}

function modeText(t,m){
  const mode=matchMode(t,m);
  const sec=matchRemaining(t,m);

  if(mode==="finished")return "Mérkőzés lezárva";
  if(mode==="paused")return `Szüneteltetve · ${fmt(sec)}`;
  if(mode==="running")return `Játék folyamatban · ${fmt(sec)}`;
  if(mode==="expired"){
    return m.scoreA===m.scoreB
      ?"IDŐ! · döntetlen – a következő pont nyer"
      :"IDŐ! · STOP-pal lezárható";
  }
  if(mode==="ready")return `Indításra kész · ${fmt(sec)}`;
  return "Nincs mérkőzés";
}

function pendingDelta(match,side){
  return getQueue().filter(a=>a.type==="CHANGE_SCORE"&&a.tournamentId===selectedId&&Number(a.round)===Number(match.round)&&Number(a.court)===Number(match.court)&&a.side===side).reduce((sum,a)=>sum+Number(a.delta||0),0);
}
function shownScore(match,side){
  const base=side==="A"?match.scoreA:match.scoreB;
  return Math.max(0,base+pendingDelta(match,side));
}

async function sendAction(action,{queueScore=false}={}){
  action.actionId=action.actionId||makeId();
  if(queueScore)addQueue(action);
  render();

  try{
    const res=await fetch("/api/action",{
      method:"POST",
      headers:{"content-type":"application/json","x-admin-pin":pin},
      body:JSON.stringify(action)
    });

    let data={};
    try{data=await res.json();}catch{}

    if(!res.ok||!data.ok){
      if(queueScore){
        removeQueue(action.actionId);
        render();
      }
      throw new Error(data.error||`Szerverhiba (${res.status})`);
    }

    acceptState(data.state,data.ackActionId);
    if(data.notice)toast(data.notice);
    setConnection(state.eventStatus==="LIVE"?"online":"","REALTIME");
    return true;
  }catch(e){
    const isNetworkError =
      e instanceof TypeError ||
      /fetch|network|offline|failed/i.test(String(e?.message||e));

    if(queueScore&&isNetworkError){
      setConnection("offline","OFFLINE – PONT ELMENTVE");
      toast("A pont a telefonon elmentve, visszakapcsolódáskor szinkronizál.");
    }else{
      if(queueScore){
        removeQueue(action.actionId);
        render();
      }
      toast(e.message||String(e));
    }
    return false;
  }
}

async function flushQueue(){
  if(!navigator.onLine||!pin)return;

  const q=[...getQueue()];

  for(const action of q){
    try{
      const res=await fetch("/api/action",{
        method:"POST",
        headers:{"content-type":"application/json","x-admin-pin":pin},
        body:JSON.stringify(action)
      });

      let data={};
      try{data=await res.json();}catch{}

      if(res.ok&&data.ok){
        acceptState(data.state,data.ackActionId);
        continue;
      }

      if(res.status>=400&&res.status<500){
        removeQueue(action.actionId);
        toast(`Egy offline pont nem volt alkalmazható: ${data.error||res.status}`);
        continue;
      }

      break;
    }catch{
      break;
    }
  }

  render();
}

function render(){
  if(!state)return;
  const t=currentT();if(!t)return;
  $("adminSub").textContent=`${t.nameHu}${t.time?" · "+t.time:""}`;
  const notice=$("eventNotice");notice.className=`notice ${state.eventStatus.toLowerCase()}`;
  notice.textContent={UPCOMING:"Előkészítés – a publikus oldal még nem realtime.",LIVE:"LIVE – a publikus oldal valós időben követi az eredményeket.",ARCHIVED:"ARCHÍV – az eredmények visszanézhetők, realtime kapcsolat nincs.",CLOSED:"Az esemény lezárt."}[state.eventStatus]||state.eventStatus;
  renderTabs();renderMatch();renderResults();renderSettings();
}

function renderTabs(){
  $("tournamentTabs").innerHTML=state.tournaments.filter(t=>t.enabled).map(t=>`<button class="btn ${t.id===selectedId?"active":""}" data-id="${t.id}">${esc(t.nameHu)}</button>`).join("");
  $("tournamentTabs").querySelectorAll("button").forEach(b=>b.onclick=async()=>{selectedId=b.dataset.id;localStorage.setItem("beac-admin-tournament",selectedId);await sendAction({type:"SET_ACTIVE_TOURNAMENT",tournamentId:selectedId});});
}

function renderMatch(){
  const t=currentT();
  const all=currentMatches(t);
  const timerEl=$("timer");
  const mainBtn=$("timerMainBtn");
  const resetBtn=$("resetTimerBtn");
  const stopBtn=$("stopBtn");

  mainBtn.classList.remove("hidden");
  resetBtn.classList.add("hidden");
  stopBtn.classList.add("hidden");
  mainBtn.disabled=false;
  resetBtn.disabled=false;
  stopBtn.disabled=false;
  mainBtn.dataset.mode="";

  const isGlobal=courtFilter===0;

  if(isGlobal){
    $("roundLabel").textContent=`${t.currentRound}. forduló · GLOBÁLIS VEZÉRLÉS`;
    timerEl.classList.remove("timeup");
    timerEl.classList.add("global-mode");

    timerEl.innerHTML=`<div class="global-timers">${
      all.map(m=>{
        const mode=matchMode(t,m);
        const sec=matchRemaining(t,m);
        const timerText=mode==="finished"?"VÉGE":mode==="expired"?"IDŐ!":fmt(sec);
        return`<div class="global-timer-item ${mode}">
          <span>${m.court}. PÁLYA</span>
          <strong>${timerText}</strong>
          <small>${esc(modeText(t,m))}</small>
        </div>`;
      }).join("")
    }</div>`;

    const active=all.filter(m=>!m.finished&&m.a!=null&&m.b!=null);
    const pausable=active.filter(m=>matchMode(t,m)==="running");
    const paused=active.filter(m=>matchMode(t,m)==="paused");
    const ready=active.filter(m=>matchMode(t,m)==="ready");
    const expired=active.filter(m=>matchMode(t,m)==="expired");

    if(state.eventStatus!=="LIVE"||t.winner){
      $("timerStatus").textContent=t.winner
        ?"A bajnokság lezárult."
        :"A timer LIVE módban indítható.";
      mainBtn.textContent="INDÍTÁS";
      mainBtn.disabled=true;
      stopBtn.classList.add("hidden");
    }else if(!active.length){
      $("timerStatus").textContent="Nincs aktív mérkőzés.";
      mainBtn.classList.add("hidden");
    }else if(pausable.length){
      $("timerStatus").textContent="Globális vezérlés – a SZÜNET minden futó pályát megállít.";
      mainBtn.textContent="SZÜNET";
      mainBtn.dataset.mode="pause";
      stopBtn.classList.remove("hidden");
    }else if(paused.length){
      $("timerStatus").textContent="Globális vezérlés – a FOLYTATÁS a szüneteltetett és még el nem indított pályákat is elindítja.";
      mainBtn.textContent="FOLYTATÁS";
      mainBtn.dataset.mode="start";
      stopBtn.classList.remove("hidden");
    }else if(ready.length){
      $("timerStatus").textContent="Globális vezérlés – az INDÍTÁS minden még el nem indított pályát elindít.";
      mainBtn.textContent="INDÍTÁS";
      mainBtn.dataset.mode="start";
      resetBtn.classList.remove("hidden");
      if(expired.length)stopBtn.classList.remove("hidden");
    }else if(expired.length){
      $("timerStatus").textContent="Idő lejárt. A STOP lezárja, ami lezárható; a döntetlen pálya nyitva marad.";
      mainBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
    }
  }else{
    const m=all.find(x=>Number(x.court)===courtFilter);
    $("roundLabel").textContent=`${t.currentRound}. forduló · ${courtFilter}. pálya`;
    timerEl.classList.remove("global-mode");

    const mode=matchMode(t,m);
    const sec=matchRemaining(t,m);
    timerEl.textContent=mode==="finished"?"VÉGE":mode==="expired"?"IDŐ!":fmt(sec);
    timerEl.classList.toggle("timeup",mode==="expired");
    $("timerStatus").textContent=modeText(t,m);

    if(state.eventStatus!=="LIVE"||t.winner||!m||m.finished){
      mainBtn.classList.add("hidden");
      stopBtn.classList.add("hidden");
    }else if(mode==="running"){
      mainBtn.textContent="SZÜNET";
      mainBtn.dataset.mode="pause";
      stopBtn.classList.remove("hidden");
    }else if(mode==="paused"){
      mainBtn.textContent="FOLYTATÁS";
      mainBtn.dataset.mode="start";
      stopBtn.classList.remove("hidden");
    }else if(mode==="ready"){
      mainBtn.textContent="INDÍTÁS";
      mainBtn.dataset.mode="start";
      resetBtn.classList.remove("hidden");
    }else if(mode==="expired"){
      mainBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
    }
  }

  let ms=all;
  if(courtFilter)ms=ms.filter(m=>Number(m.court)===courtFilter);

  $("courts").innerHTML=ms.map(m=>{
    if(m.a==null||m.b==null){
      return`<section class="card court-card">
        <div class="court-label">${m.court}. pálya</div>
        <div class="sub">A döntő párosítása még nem ismert.</div>
      </section>`;
    }

    const mode=matchMode(t,m);
    return`<section class="card court-card ${m.finished?"finished":""}">
      <div class="court-card-head">
        <div class="court-label">${m.court}. pálya</div>
        <div class="court-timer-state ${mode}">${esc(modeText(t,m))}</div>
      </div>
      <div class="score-grid">
        ${sideHtml(t,m,"A",m.a)}
        ${sideHtml(t,m,"B",m.b)}
      </div>
      <button
        class="btn full reset-match"
        data-round="${m.round}"
        data-court="${m.court}"
        style="margin-top:12px"
        ${m.finished?"disabled":""}
      >Meccs nullázása</button>
    </section>`;
  }).join("");

  document.querySelectorAll(".score-action").forEach(b=>b.onclick=()=>scoreClick(b));
  document.querySelectorAll(".reset-match").forEach(b=>b.onclick=()=>{
    if(b.disabled)return;
    if(confirm("Biztosan nullázod ezt a meccset? A saját időmérője is visszaáll.")){
      sendAction({
        type:"RESET_MATCH",
        tournamentId:selectedId,
        round:Number(b.dataset.round),
        court:Number(b.dataset.court)
      });
    }
  });

  $("court1").classList.toggle("active",courtFilter===1);
  $("court2").classList.toggle("active",courtFilter===2);
  $("courtBoth").classList.toggle("active",courtFilter===0);
}
function sideHtml(t,m,side,teamIndex){
  const disabled=m.finished||state.eventStatus!=="LIVE";
  return`<div class="side">
    <div class="score-team">${esc(t.teams[teamIndex])}</div>
    <div class="score-number">${shownScore(m,side)}</div>
    <div class="score-buttons">
      <button class="btn score-action" data-round="${m.round}" data-court="${m.court}" data-side="${side}" data-delta="-1" ${disabled?"disabled":""}>−</button>
      <button class="btn yellow score-action" data-round="${m.round}" data-court="${m.court}" data-side="${side}" data-delta="1" ${disabled?"disabled":""}>+</button>
    </div>
  </div>`;
}
function scoreClick(b){
  if(state.eventStatus!=="LIVE"){toast("Pontozni csak LIVE módban lehet.");return;}
  sendAction({type:"CHANGE_SCORE",tournamentId:selectedId,round:Number(b.dataset.round),court:Number(b.dataset.court),side:b.dataset.side,delta:Number(b.dataset.delta)},{queueScore:true});
}

function renderResults(){
  const t=currentT();
  $("winner").innerHTML=t.winner?`<div class="winner"><small>A bajnokság győztese</small><strong>🏆 ${esc(t.winner)}</strong></div>`:"";
  $("adminStandings").classList.toggle("hidden",t.id==="FINAL");
  $("tableBody").innerHTML=(t.standings||[]).map((r,i)=>`<tr><td>${i+1}.</td><td>${esc(r.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.diff>0?"+":""}${r.diff}</td><td><strong>${r.points}</strong></td></tr>`).join("");
  const rounds=t.id==="FINAL"?[1,2]:[1,2,3];
  $("results").innerHTML=rounds.map(r=>`<div class="result-round"><div class="result-title">${r}. forduló</div>${t.matches.filter(m=>m.round===r).map(m=>`<div class="result-row"><span>${m.court}. pálya · ${esc(m.a==null?"—":t.teams[m.a])} – ${esc(m.b==null?"—":t.teams[m.b])}</span><strong>${m.finished?`${m.scoreA} : ${m.scoreB}`:"—"}</strong></div>`).join("")}</div>`).join("");
}

function renderSettings(){
  const t=currentT();const final=t.id==="FINAL";
  $("tournamentSettings").classList.toggle("hidden",final);
  if(!final){
    $("nameHu").value=t.nameHu;$("nameEn").value=t.nameEn;$("timeLabel").value=t.time;$("minutes").value=t.roundSeconds/60;
    [1,2,3,4].forEach((n,i)=>$(`team${n}`).value=t.teams[i]||"");
  }
  if(state.archiveAt){
    const d=new Date(state.archiveAt);const local=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);$("archiveAt").value=local;
  }else $("archiveAt").value="";
}

setInterval(()=>{if(state&&page==="match")renderMatch();},500);
$("court1").onclick=()=>setCourt(1);$("court2").onclick=()=>setCourt(2);$("courtBoth").onclick=()=>setCourt(0);
function setCourt(v){courtFilter=v;localStorage.setItem("beac-court-filter",String(v));renderMatch();}
$("timerMainBtn").onclick=()=>{
  const mode=$("timerMainBtn").dataset.mode;
  if(!mode)return;

  sendAction({
    type:mode==="pause"?"PAUSE_MATCH":"START_MATCH",
    tournamentId:selectedId,
    court:courtFilter
  });
};

$("resetTimerBtn").onclick=()=>{
  const target=courtFilter===0?"mindkét pálya":"a kiválasztott pálya";
  if(confirm(`Visszaállítsuk ${target} idejét a teljes meccsidőre? A pontok nem törlődnek.`)){
    sendAction({
      type:"RESET_TIMER",
      tournamentId:selectedId,
      court:courtFilter
    });
  }
};

$("stopBtn").onclick=()=>{
  const t=currentT();
  if(!t)return;

  let targets=currentMatches(t).filter(m=>!m.finished&&m.a!=null&&m.b!=null);
  if(courtFilter)targets=targets.filter(m=>Number(m.court)===courtFilter);
  if(!targets.length)return;

  const tied=targets.filter(m=>m.scoreA===m.scoreB);

  if(courtFilter&&tied.length){
    toast(`${courtFilter}. pálya: döntetlen – a következő pont nyer.`);
    return;
  }

  if(!courtFilter&&tied.length===targets.length){
    toast("Mindkét még aktív pálya döntetlen – a következő pont nyer.");
    return;
  }

  const question=courtFilter
    ? `STOP = a ${courtFilter}. pálya mérkőzésének vége. Lezárjuk?`
    : tied.length
      ? "Globális STOP: a nem döntetlen mérkőzést lezárjuk, a döntetlen pálya nyitva marad. Mehet?"
      : "Globális STOP: lezárjuk mindkét még aktív mérkőzést?";

  if(confirm(question)){
    sendAction({
      type:"STOP_MATCH",
      tournamentId:selectedId,
      court:courtFilter
    });
  }
};

$("saveSettingsBtn").onclick=()=>{
  const minutes=Number($("minutes").value);
  sendAction({type:"SAVE_TOURNAMENT_SETTINGS",tournamentId:selectedId,nameHu:$("nameHu").value,nameEn:$("nameEn").value,time:$("timeLabel").value,roundSeconds:Math.round(minutes*60),teams:[1,2,3,4].map(n=>$(`team${n}`).value)});
};
$("upcomingBtn").onclick=()=>sendAction({type:"SET_EVENT_STATUS",status:"UPCOMING"});
$("liveBtn").onclick=()=>{if(confirm("LIVE mód indítása? A publikus oldalak azonnal realtime kapcsolatot nyitnak."))sendAction({type:"SET_EVENT_STATUS",status:"LIVE"});};
$("archiveBtn").onclick=()=>{if(confirm("Lezárjuk a sportnapot? A publikus eredmények megmaradnak, de a realtime kapcsolat leáll."))sendAction({type:"SET_EVENT_STATUS",status:"ARCHIVED"});};
$("saveArchiveAtBtn").onclick=()=>{
  const value=$("archiveAt").value;sendAction({type:"SET_ARCHIVE_AT",archiveAt:value?new Date(value).getTime():0});
};
$("createFinalBtn").onclick=()=>{if(confirm("Létrehozzuk a Final Fourt a négy bajnokság győzteseiből?"))sendAction({type:"CREATE_FINAL"});};
$("resetTournamentBtn").onclick=()=>{if(confirm("Biztosan nullázod az aktuális bajnokságot?"))sendAction({type:"RESET_TOURNAMENT",tournamentId:selectedId});};
$("openPublicBtn").onclick=()=>window.open("/","_blank");$("openQrBtn").onclick=()=>window.open("/?share=1","_blank");

function showPage(next){
  page=next;$("matchPage").classList.toggle("hidden",next!=="match");$("resultsPage").classList.toggle("hidden",next!=="results");$("settingsPage").classList.toggle("hidden",next!=="settings");
  $("navMatch").classList.toggle("active",next==="match");$("navResults").classList.toggle("active",next==="results");$("navSettings").classList.toggle("active",next==="settings");
}
$("navMatch").onclick=()=>showPage("match");$("navResults").onclick=()=>showPage("results");$("navSettings").onclick=()=>showPage("settings");

pin=sessionStorage.getItem("beac-pin")||"";
if(pin){$("pin").value=pin;login();}
