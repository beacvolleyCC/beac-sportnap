const T = {
  hu: {
    standings:"Tabella", team:"Csapat", results:"Eredmények", rules:"Szabályok",
    matchRules:"Mérkőzés", durationPrefix:"Egy mérkőzés játékideje:",
    rally:"Minden labdamenet pontot ér.",
    finishRally:"Az idő lejártakor az aktuális labdamenetet még befejezzük.",
    margin:"Nem kell két ponttal nyerni: egy pont különbség elég.",
    draw:"Döntetlen nincs. Ha az idő végén egyenlő az állás, a következő pont nyer.",
    pointsTitle:"Bajnoki pontozás", win:"Győzelem: 3 pont", loss:"Vereség: 0 pont",
    tiebreak:"Holtverseny a tabellán", tb1:"bajnoki pont;", tb2:"pontkülönbség;", tb3:"szerzett pontok;", tb4:"egymás elleni eredmény.",
    round:"forduló", court:"pálya", winner:"A bajnokság győztese",
    golden:"Döntetlen – a következő pont nyer",
    upcoming:"A sportnap még nem indult el.", live:"Élő eredmények", archived:"A sportnap véget ért – az eredmények visszanézhetők.",
    closed:"Ez az esemény lezárult.", shareTitle:"Élő eredmények megosztása",
    shareHint:"A QR-kód és a link az egész sportnap közös eredményoldalára mutat.",
    copy:"Link másolása", share:"Megosztás", print:"QR nyomtatása", close:"Bezárás",
    time:"IDŐ!", paused:"Szüneteltetve", finished:"Mérkőzés vége", timeExpired:"Idő lejárt", finalUnknown:"A döntő párosítása még nem ismert.", noData:"Nincs eredmény."
  },
  en: {
    standings:"Standings", team:"Team", results:"Results", rules:"Rules",
    matchRules:"Match", durationPrefix:"Match duration:",
    rally:"Every rally scores a point.",
    finishRally:"When time expires, the current rally is completed.",
    margin:"A two-point margin is not required: one point is enough to win.",
    draw:"There are no draws. If the score is level when time expires, the next point wins.",
    pointsTitle:"League points", win:"Win: 3 points", loss:"Loss: 0 points",
    tiebreak:"Standings tie-break", tb1:"league points;", tb2:"point difference;", tb3:"points scored;", tb4:"head-to-head result.",
    round:"round", court:"court", winner:"Tournament winner",
    golden:"Tied – next point wins",
    upcoming:"The sports day has not started yet.", live:"Live results", archived:"The sports day is over – results remain available.",
    closed:"This event has ended.", shareTitle:"Share live results",
    shareHint:"The QR code and link point to the shared results page for the whole sports day.",
    copy:"Copy link", share:"Share", print:"Print QR", close:"Close",
    time:"TIME!", paused:"Paused", finished:"Match finished", timeExpired:"Time expired", finalUnknown:"The final pairing is not known yet.", noData:"No results yet."
  }
};

let state = null;
let selectedId = localStorage.getItem("beac-public-tournament") || "";
let lang = localStorage.getItem("beac-lang") || "hu";
let ws = null;
let reconnectTimer = null;

const $ = id => document.getElementById(id);

function tr(key){ return T[lang][key] || key; }
function escapeHtml(v){ return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }

async function loadState(){
  try{
    const res = await fetch("/api/state", { cache:"no-store" });
    const data = await res.json();
    if(!res.ok || !data.ok) throw new Error(data.error || "Load error");
    acceptState(data.state);
  }catch(error){
    showNotice("error", error.message || String(error));
  }
}

function acceptState(next){
  if(state && Number(next.rev) < Number(state.rev)) return;
  state = next;

  const enabled = state.tournaments.filter(t=>t.enabled);
  if(!enabled.some(t=>t.id===selectedId)){
    selectedId = enabled.some(t=>t.id===state.activeTournamentId) ? state.activeTournamentId : enabled[0]?.id;
  }
  localStorage.setItem("beac-public-tournament", selectedId || "");
  render();

  if(state.eventStatus === "LIVE") connectWs();
  else disconnectWs();
}

function connectWs(){
  if(ws && [WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState)) return;
  clearTimeout(reconnectTimer);
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = e => {
    if(e.data === "pong") return;
    try{
      const msg = JSON.parse(e.data);
      if(msg.type === "STATE") acceptState(msg.state);
    }catch{}
  };
  ws.onclose = () => {
    ws = null;
    if(state?.eventStatus === "LIVE"){
      reconnectTimer = setTimeout(connectWs, 1800);
    }
  };
  ws.onerror = () => {};
}

function disconnectWs(){
  clearTimeout(reconnectTimer);
  if(ws){
    try{ ws.close(); }catch{}
    ws = null;
  }
}

setInterval(()=>{
  if(ws?.readyState === WebSocket.OPEN){
    try{ ws.send("ping"); }catch{}
  }
},30000);

function currentTournament(){
  return state?.tournaments.find(t=>t.id===selectedId) || null;
}

function tournamentName(t){
  return lang === "en" ? t.nameEn : t.nameHu;
}

function formatDuration(sec){
  const mins = sec/60;
  const value = Number.isInteger(mins) ? String(mins) : String(mins).replace(".",",");
  return lang === "en" ? `${value} min` : `${value} perc`;
}

function matchRemaining(t,m){
  if(m.timerPaused){
    return Math.max(0,Math.ceil(Number(m.timerPausedRemainingMs||0)/1000));
  }

  if(m.timerRunning){
    return Math.max(0,Math.ceil((Number(m.timerEndAt||0)-Date.now())/1000));
  }

  // v0.5.3 állapot fallback.
  if(m.timerRunning===undefined){
    if(t.roundPaused){
      return Math.max(0,Math.ceil(Number(t.roundPausedRemainingMs||0)/1000));
    }
    if(t.roundRunning&&t.roundEndAt){
      return Math.max(0,Math.ceil((Number(t.roundEndAt)-Date.now())/1000));
    }
  }

  return Number(t.roundSeconds||0);
}

function matchMode(t,m){
  if(m.finished)return "finished";
  if(m.timerPaused)return "paused";
  if(m.timerRunning)return matchRemaining(t,m)<=0?"expired":"running";
  return "ready";
}

function publicMatchStatus(t,m){
  const mode=matchMode(t,m);
  if(mode==="finished")return tr("finished");
  if(mode==="paused")return tr("paused");
  if(mode==="expired"){
    return m.scoreA===m.scoreB?tr("golden"):tr("timeExpired");
  }
  return "";
}

function fmt(sec){
  return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}

function showNotice(kind,text){
  const n=$("notice"); n.className=`notice ${kind}`; n.textContent=text;
}

function statusText(){
  if(!state) return "";
  return {
    UPCOMING:tr("upcoming"), LIVE:tr("live"), ARCHIVED:tr("archived"), CLOSED:tr("closed")
  }[state.eventStatus] || state.eventStatus;
}

function render(){
  if(!state) return;
  document.documentElement.lang=lang;
  $("huBtn").classList.toggle("active",lang==="hu");
  $("enBtn").classList.toggle("active",lang==="en");
  $("eventTitle").textContent=lang==="en"?state.titleEn:state.titleHu;

  const t=currentTournament();
  $("eventSub").textContent=t?`${tournamentName(t)}${t.time?" · "+t.time:""}`:"";

  const pill=$("statusPill");
  pill.className=`status-pill ${state.eventStatus.toLowerCase()}`;
  $("statusText").textContent=state.eventStatus;
  showNotice(state.eventStatus.toLowerCase(),statusText());

  renderTabs();
  renderTournament();
  translateStatic();
}

function renderTabs(){
  $("tournamentTabs").innerHTML=state.tournaments.filter(t=>t.enabled).map(t=>`
    <button class="${t.id===selectedId?"active":""}" data-id="${t.id}">
      ${escapeHtml(tournamentName(t))}
      ${t.time?`<small>${escapeHtml(t.time)}</small>`:""}
    </button>`).join("");
  $("tournamentTabs").querySelectorAll("button").forEach(b=>{
    b.onclick=()=>{selectedId=b.dataset.id;localStorage.setItem("beac-public-tournament",selectedId);render();};
  });
}

function renderTournament(){
  const t=currentTournament(); if(!t) return;
  $("duration").textContent=formatDuration(t.roundSeconds);

  $("winnerWrap").innerHTML=t.winner?`
    <div class="winner"><small>${tr("winner")}</small><strong>🏆 ${escapeHtml(t.winner)}</strong></div>`:"";

  const active=t.matches.filter(m=>Number(m.round)===Number(t.currentRound));

  $("matches").innerHTML=active.map(m=>{
    if(m.a==null||m.b==null){
      return `<article class="match-card">
        <div class="match-head"><span>${m.court}. ${tr("court")}</span><span>${t.currentRound}. ${tr("round")}</span></div>
        <div class="match-body"><div class="sub" style="text-align:center">${tr("finalUnknown")}</div></div>
      </article>`;
    }

    const mode=matchMode(t,m);
    const sec=matchRemaining(t,m);
    const timerText=mode==="finished"?tr("finished"):mode==="expired"?tr("time"):fmt(sec);

    return `<article class="match-card ${mode}">
      <div class="match-head"><span>${m.court}. ${tr("court")}</span><span>${t.currentRound}. ${tr("round")}</span></div>
      <div class="match-body">
        <div class="teams-score">
          <div class="team">${escapeHtml(t.teams[m.a])}</div>
          <div class="live-score">${m.scoreA} : ${m.scoreB}</div>
          <div class="team">${escapeHtml(t.teams[m.b])}</div>
        </div>
        <div
          class="public-timer"
          data-match-timer
          data-round="${m.round}"
          data-court="${m.court}"
        >${timerText}</div>
        <div
          class="golden"
          data-match-status
          data-round="${m.round}"
          data-court="${m.court}"
        >${escapeHtml(publicMatchStatus(t,m))}</div>
      </div>
    </article>`;
  }).join("");

  $("standingsCard").classList.toggle("hidden",t.id==="FINAL");
  $("standingsBody").innerHTML=(t.standings||[]).map((r,i)=>`
    <tr><td>${i+1}.</td><td>${escapeHtml(r.name)}</td><td>${r.played}</td><td>${r.diff>0?"+":""}${r.diff}</td><td><strong>${r.points}</strong></td></tr>`).join("");

  const rounds=t.id==="FINAL"?[1,2]:[1,2,3];
  $("results").innerHTML=rounds.map(r=>{
    const ms=t.matches.filter(m=>m.round===r);
    return `<div class="result-round"><div class="result-title">${r}. ${tr("round")}</div>${
      ms.map(m=>`<div class="result-row"><span>${m.court}. ${tr("court")} · ${escapeHtml(m.a==null?"—":t.teams[m.a])} – ${escapeHtml(m.b==null?"—":t.teams[m.b])}</span><strong>${m.finished?`${m.scoreA} : ${m.scoreB}`:"—"}</strong></div>`).join("")
    }</div>`;
  }).join("") || `<div class="sub">${tr("noData")}</div>`;
}

function translateStatic(){
  $("standingsTitle").textContent=tr("standings"); $("teamHead").textContent=tr("team"); $("resultsTitle").textContent=tr("results"); $("rulesTitle").textContent=tr("rules");
  $("matchRulesTitle").textContent=tr("matchRules"); $("durationPrefix").textContent=tr("durationPrefix"); $("rallyRule").textContent=tr("rally");
  $("finishRallyRule").textContent=tr("finishRally"); $("marginRule").textContent=tr("margin"); $("drawRule").textContent=tr("draw");
  $("pointsRulesTitle").textContent=tr("pointsTitle"); $("winRule").textContent=tr("win"); $("lossRule").textContent=tr("loss");
  $("tieBreakTitle").textContent=tr("tiebreak"); $("tb1").textContent=tr("tb1"); $("tb2").textContent=tr("tb2"); $("tb3").textContent=tr("tb3"); $("tb4").textContent=tr("tb4");
  $("shareTitle").textContent=tr("shareTitle"); $("shareHint").textContent=tr("shareHint"); $("copyBtn").textContent=tr("copy");
  $("nativeShareBtn").textContent=tr("share"); $("printBtn").textContent=tr("print"); $("closeShareBtn").textContent=tr("close");
}

setInterval(()=>{
  const t=currentTournament(); if(!t) return;

  document.querySelectorAll("[data-match-timer]").forEach(el=>{
    const round=Number(el.dataset.round);
    const court=Number(el.dataset.court);
    const m=t.matches.find(x=>Number(x.round)===round&&Number(x.court)===court);
    if(!m)return;

    const mode=matchMode(t,m);
    const sec=matchRemaining(t,m);
    el.textContent=mode==="finished"
      ?tr("finished")
      :mode==="expired"
        ?tr("time")
        :fmt(sec);
  });

  document.querySelectorAll("[data-match-status]").forEach(el=>{
    const round=Number(el.dataset.round);
    const court=Number(el.dataset.court);
    const m=t.matches.find(x=>Number(x.round)===round&&Number(x.court)===court);
    if(m)el.textContent=publicMatchStatus(t,m);
  });
},500);

function setLang(next){lang=next;localStorage.setItem("beac-lang",lang);render();}
$("huBtn").onclick=()=>setLang("hu"); $("enBtn").onclick=()=>setLang("en");
$("themeBtn").onclick=()=>{document.body.classList.toggle("dark");localStorage.setItem("beac-theme",document.body.classList.contains("dark")?"dark":"light");};
if(localStorage.getItem("beac-theme")==="dark")document.body.classList.add("dark");

function openShare(){
  $("shareModal").classList.remove("hidden");
  translateStatic();
  const q=$("qrcode"); q.innerHTML="";
  if(window.QRCode){
    new QRCode(q,{text:location.origin+"/",width:280,height:280,colorDark:"#000000",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
  } else q.textContent=location.origin+"/";
}
$("shareBtn").onclick=openShare;
$("closeShareBtn").onclick=()=>$("shareModal").classList.add("hidden");
$("shareModal").onclick=e=>{if(e.target===$("shareModal"))$("shareModal").classList.add("hidden");};
$("copyBtn").onclick=async()=>{try{await navigator.clipboard.writeText(location.origin+"/");alert(lang==="en"?"Link copied.":"Link kimásolva.");}catch{prompt("Link:",location.origin+"/");}};
$("nativeShareBtn").onclick=async()=>{if(navigator.share){try{await navigator.share({title:lang==="en"?state.titleEn:state.titleHu,url:location.origin+"/"});}catch{}}else $("copyBtn").click();};
$("printBtn").onclick=()=>window.print();

if(new URLSearchParams(location.search).get("share")==="1")setTimeout(openShare,500);
loadState();
