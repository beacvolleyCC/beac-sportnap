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
function remaining(t){
  if(t.roundPaused){
    return Math.max(0,Math.ceil(Number(t.roundPausedRemainingMs||0)/1000));
  }
  if(!t.roundRunning||!t.roundEndAt)return t.roundSeconds;
  return Math.max(0,Math.ceil((t.roundEndAt-Date.now())/1000));
}
function fmt(s){return`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}

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
  const t=currentT();const sec=remaining(t);const timeup=t.roundRunning&&sec===0;
  $("roundLabel").textContent=`${t.currentRound}. forduló`;
  $("timer").textContent=timeup?"IDŐ!":fmt(sec);
  $("timer").classList.toggle("timeup",timeup);

  const mainBtn=$("timerMainBtn");
  const resetBtn=$("resetTimerBtn");
  const stopBtn=$("stopBtn");

  if(state.eventStatus!=="LIVE"||t.winner){
    $("timerStatus").textContent=t.winner?"A bajnokság lezárult.":"A timer LIVE módban indítható.";
    mainBtn.textContent="INDÍTÁS";
    mainBtn.disabled=true;
    resetBtn.classList.remove("hidden");
    resetBtn.disabled=Boolean(t.winner);
    stopBtn.classList.add("hidden");
  }else if(t.roundPaused){
    $("timerStatus").textContent="Szüneteltetve";
    mainBtn.textContent="FOLYTATÁS";
    mainBtn.disabled=false;
    resetBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    stopBtn.disabled=false;
  }else if(t.roundRunning){
    $("timerStatus").textContent=timeup
      ?"Idő lejárt. Döntetlennél a következő pont nyer."
      :"Játék folyamatban";
    mainBtn.textContent="SZÜNET";
    mainBtn.disabled=timeup;
    resetBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
    stopBtn.disabled=false;
  }else{
    $("timerStatus").textContent="Indításra kész";
    mainBtn.textContent="INDÍTÁS";
    mainBtn.disabled=false;
    resetBtn.classList.remove("hidden");
    resetBtn.disabled=false;
    stopBtn.classList.add("hidden");
  }

  let ms=t.matches.filter(m=>m.round===t.currentRound);
  if(courtFilter)ms=ms.filter(m=>m.court===courtFilter);
  $("courts").innerHTML=ms.map(m=>{
    if(m.a==null||m.b==null)return`<section class="card court-card"><div class="court-label">${m.court}. pálya</div><div class="sub">A döntő párosítása még nem ismert.</div></section>`;
    return`<section class="card court-card">
      <div class="court-label">${m.court}. pálya</div>
      <div class="score-grid">
        ${sideHtml(t,m,"A",m.a)}
        ${sideHtml(t,m,"B",m.b)}
      </div>
      <button class="btn full reset-match" data-round="${m.round}" data-court="${m.court}" style="margin-top:12px">Meccs nullázása</button>
    </section>`;
  }).join("");
  document.querySelectorAll(".score-action").forEach(b=>b.onclick=()=>scoreClick(b));
  document.querySelectorAll(".reset-match").forEach(b=>b.onclick=()=>{if(confirm("Biztosan nullázod ezt a meccset?"))sendAction({type:"RESET_MATCH",tournamentId:selectedId,round:Number(b.dataset.round),court:Number(b.dataset.court)});});
  $("court1").classList.toggle("active",courtFilter===1);$("court2").classList.toggle("active",courtFilter===2);$("courtBoth").classList.toggle("active",courtFilter===0);
}
function sideHtml(t,m,side,teamIndex){
  return`<div class="side"><div class="score-team">${esc(t.teams[teamIndex])}</div><div class="score-number">${shownScore(m,side)}</div><div class="score-buttons">
    <button class="btn score-action" data-round="${m.round}" data-court="${m.court}" data-side="${side}" data-delta="-1">−</button>
    <button class="btn yellow score-action" data-round="${m.round}" data-court="${m.court}" data-side="${side}" data-delta="1">+</button>
  </div></div>`;
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
  const t=currentT();
  if(!t)return;

  if(t.roundRunning){
    sendAction({type:"PAUSE_ROUND",tournamentId:selectedId});
  }else{
    sendAction({type:"START_ROUND",tournamentId:selectedId});
  }
};

$("resetTimerBtn").onclick=()=>{
  if(confirm("Visszaállítsuk az időt a teljes meccsidőre? A pontok nem törlődnek.")){
    sendAction({type:"RESET_TIMER",tournamentId:selectedId});
  }
};

$("stopBtn").onclick=()=>{
  const t=currentT();
  if(!t)return;

  const current=t.matches.filter(m=>m.round===t.currentRound);
  const tied=current.filter(m=>m.a!=null&&m.b!=null&&m.scoreA===m.scoreB);

  if(tied.length){
    const courts=tied.map(m=>`${m.court}. pálya`).join(", ");
    toast(`Nem zárható le: ${courts} döntetlen. A következő pont nyer.`);
    return;
  }

  if(confirm("STOP = a forduló vége. Lezárjuk a két mérkőzést és továbblépünk?")){
    sendAction({type:"STOP_ROUND",tournamentId:selectedId});
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
