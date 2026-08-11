const KEY="menotme_complete_v1", today=new Date().toISOString().slice(0,10);
const defaultState=()=>({
 date:today,seasonStart:today,me:0,notme:0,streak:1,best:0,combo:0,crowd:65,ended:false,selected:null,
 assets:[],
 liabilities:[],
 weekly:{meWins:0,notMeWins:0,history:[]},friend:{name:"",score:null},gate:{required:false,asset:false,liability:false},signature:"Team Me Next Level",shown:{7:false,30:false,60:false,90:false},
 fans:[],doubters:[],arena:{showFans:true,showDoubters:true,showSigns:true,reactions:true}
});
let state=defaultState(),mode="asset",dragging=false,start=null,audio=null,handState="EMPTY";
const $=id=>document.getElementById(id);
// ---- Hand + paper state machine ----
// States: EMPTY | HOLDING_PAPER | AIMING | PULLBACK | THROWING
// Two hand assets: hand-right-empty.png (open fingers) | hand-right-holding.png (gripping paper)
const HAND_EMPTY="assets/hand-right-empty.png";
const HAND_HOLDING="assets/hand-right-holding.png";
const HAND_AIM="assets/hand-right-aim.png";
const HAND_PULLBACK="assets/hand-right-pullback.png";
const HAND_RELEASE="assets/hand-right-release.png";
const HAND_FOLLOWTHROUGH="assets/hand-right-followthrough.png";
function setHandState(s,opts){
  const prev=handState;handState=s;
  const hR=$("handRight"),hW=$("handWrap"),p=$("paper"),hp=$("heldPaper");if(!hW)return;
  if(s==="EMPTY"){
    if(hp){hp.classList.add("paper--hidden");hp.textContent="";hp.style.transform="";}
    p.classList.add("paper--hidden");p.textContent="";
    if(hR)hR.src=HAND_EMPTY;
    hW.classList.remove("hand--aiming");hW.style.transition="";hW.style.transform="";
  } else if(s==="HOLDING_PAPER"){
    if(hR)hR.src=HAND_HOLDING;
    hW.classList.remove("hand--aiming");hW.style.transform="";
    if(hp&&state.selected!==null)hp.textContent=state.assets[state.selected]?.name||"";
    p.classList.add("paper--hidden");
    if(prev==="EMPTY"&&!(opts&&opts.skipAppear)){
      if(hp){
        hp.classList.remove("paper--hidden");
        hp.getAnimations().forEach(a=>a.cancel());
        hp.animate(
          [{transform:"translate(-50%,-50%) scale(0.45)",opacity:0},
           {transform:"translate(-50%,-50%) scale(1.06)",opacity:1,offset:.7,easing:"ease-out"},
           {transform:"translate(-50%,-50%) scale(1)",opacity:1}],
          {duration:240,easing:"cubic-bezier(.2,.8,.3,1)",fill:"none"});
      }
    } else {
      if(hp)hp.classList.remove("paper--hidden");
    }
  } else if(s==="AIMING"){
    if(hp)hp.classList.remove("paper--hidden");
    p.classList.add("paper--hidden");
    if(hR)hR.src=HAND_AIM;
    hW.classList.add("hand--aiming");
  } else if(s==="PULLBACK"){
    if(hp)hp.classList.remove("paper--hidden");
    p.classList.add("paper--hidden");
    if(hR)hR.src=HAND_PULLBACK;
    hW.classList.remove("hand--aiming");
  } else if(s==="THROWING"){
    // Transfer paper from grip to stage at current screen position
    if(hp&&!hp.classList.contains("paper--hidden")){
      const st=$("stage")?.getBoundingClientRect();
      if(st){
        const hr=hp.getBoundingClientRect();
        const gx=(hr.left+hr.width/2-st.left)/st.width*100;
        const gy=(hr.top+hr.height/2-st.top)/st.height*100;
        p.style.left=gx+"%";p.style.top=gy+"%";
        p.textContent=hp.textContent||"";
        p.classList.remove("paper--hidden");
      }
      hp.classList.add("paper--hidden");hp.textContent="";hp.style.transform="";
    }
    if(hR)hR.src=HAND_RELEASE;
    hW.classList.remove("hand--aiming");
  }
}
function saveState(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){try{(state.fans||[]).forEach(f=>{delete f.photo});localStorage.setItem(KEY,JSON.stringify(state));console.warn("MeNotMe: storage was full — fan photos were dropped to save your game.")}catch(e2){console.error("MeNotMe: could not save game state",e2)}}}
function loadState(){try{const s=JSON.parse(localStorage.getItem(KEY));if(s)state={...defaultState(),...s}}catch(e){};rollDay();resetSeasonIfNeeded()}
function daysBetween(a,b){return Math.floor((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000)}
function resetSeasonIfNeeded(){if(daysBetween(state.seasonStart,today)>=90){state=defaultState();saveState()}}
function rollDay(){if(state.date!==today){state.date=today;state.me=0;state.notme=0;state.combo=0;state.crowd=65;state.ended=false;state.selected=null;state.assets.forEach(a=>{a.done=false;a.scored=false});state.liabilities.forEach(l=>{l.addressed=false;l.avoided=true});saveState()}}
function tone(f,d=.12,type="sine",v=.04,delay=0){try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime+delay;o.type=type;o.frequency.setValueAtTime(f,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(v,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+d+.03)}catch(e){}}
function cheer(){tone(520,.14,"square",.04);tone(700,.18,"square",.04,.12);tone(940,.22,"triangle",.04,.25)} function boo(){tone(210,.4,"sawtooth",.045);tone(155,.55,"sawtooth",.04,.2)} function rimSound(){tone(280,.1,"square",.05);tone(210,.12,"square",.04,.08)} function missSound(){tone(170,.18,"sawtooth",.04);tone(125,.3,"sawtooth",.035,.12)}
function confetti(){let cx=50,cy=14;try{const st=$("stage").getBoundingClientRect(),rf=$("rimFront").getBoundingClientRect();cx=(rf.left+rf.width/2-st.left)/st.width*100;cy=(rf.top-st.top)/st.height*100}catch(e){}for(let i=0;i<34;i++){const p=document.createElement("span");p.className="confetti";p.style.left=(cx-5+Math.random()*10)+"%";p.style.top=(cy+Math.random()*8)+"%";p.style.animationDelay=(Math.random()*.18)+"s";$("stage").appendChild(p);setTimeout(()=>p.remove(),1500)}}
function renderPower(n=0){$("power").innerHTML="";for(let i=0;i<12;i++){const x=document.createElement("i");if(i<Math.round(n*12))x.className="on";$("power").appendChild(x)}}
function gateComplete(){return !state.gate.required||(state.gate.asset&&state.gate.liability)}
function render(){
 $("meScore").textContent=state.me;$("notMeScore").textContent=state.notme;$("streak").textContent=state.streak;$("bestStreak").textContent=state.best;$("winner").textContent=state.me>state.notme?"TEAM ME NEXT LEVEL":state.notme>state.me?"TEAM HOLDING ME BACK":"DRAW";const _crowd=$("crowd");if(_crowd)_crowd.style.width=state.crowd+"%";const _crowdPct=$("crowdPct");if(_crowdPct)_crowdPct.textContent=state.crowd+"%";const _combo=$("combo");if(_combo)_combo.textContent="X"+state.combo;$("gate").classList.toggle("show",state.gate.required&&!gateComplete());
 $("assets").innerHTML="";if(state.assets.length===0){$("assets").innerHTML='<div class="empty-state"><p class="es-title">DAILY WINS</p><p class="es-sub">Build your own team.<br>What will move you closer to your next level?</p><button class="es-btn" id="emptyAddAsset">+ ADD YOUR FIRST DAILY WIN</button></div>';const ea=$("emptyAddAsset");if(ea)ea.onclick=()=>openModal("asset")}else{state.assets.forEach((a,i)=>{const b=document.createElement("button");b.className="tag"+(a.done?" active":"")+(a.scored?" scored":"");b.disabled=state.ended||a.scored||!gateComplete();b.innerHTML="<span>☆</span><span>"+a.name+"</span>"+(a.scored?"<small>SCORED</small>":"");b.onclick=()=>selectAsset(i);$("assets").appendChild(b)})}
 $("liabilities").innerHTML="";if(state.liabilities.length===0){$("liabilities").innerHTML='<div class="empty-state"><p class="es-title">DAILY SETBACKS</p><p class="es-sub">What\'s holding you back?</p><button class="es-btn" id="emptyAddLiab">+ ADD YOUR FIRST DAILY SETBACK</button></div>';const el=$("emptyAddLiab");if(el)el.onclick=()=>openModal("liability")}else{state.liabilities.forEach((l,i)=>{const b=document.createElement("button");b.className="tag"+(l.addressed&&l.avoided?" active":"");b.disabled=state.ended||!gateComplete();b.innerHTML="<span>○</span><span>"+l.name+"</span><small>"+(!l.addressed?"IGNORED":l.avoided?"AVOIDED":"HAPPENED")+"</small>";b.onclick=()=>toggleLiability(i);$("liabilities").appendChild(b)})}
 $("weekMe").textContent=state.weekly.meWins;$("weekNotMe").textContent=state.weekly.notMeWins;$("weekStreak").textContent=state.streak;$("historyList").innerHTML=state.weekly.history.slice(-7).reverse().map(h=>"<p>"+h.date+": Me Next Level "+h.me+" — "+h.notme+" Holding Me Back</p>").join("")||"<p>No completed days yet.</p>";
 if(window.renderArena)window.renderArena();
 if(state.friend.name){$("friendName").value=state.friend.name;$("friendScore").value=state.friend.score??"";$("friendResult").textContent=state.friend.score==null?"No friend score yet.":state.me>state.friend.score?"You lead "+state.me+"–"+state.friend.score:state.me<state.friend.score?state.friend.name+" leads "+state.friend.score+"–"+state.me:"Draw "+state.me+"–"+state.friend.score}
 saveState()
}
function selectAsset(i){if(state.ended||!gateComplete())return;state.selected=i;state.assets[i].done=true;const hp=$("heldPaper");if(hp)hp.textContent=state.assets[i].name;tone(360,.06,"square",.02);setHandState("HOLDING_PAPER");render()}
function toggleLiability(i){if(state.ended||!gateComplete())return;const l=state.liabilities[i];if(!l.addressed){l.addressed=true;l.avoided=true}else if(l.avoided)l.avoided=false;else{l.addressed=false;l.avoided=true}render()}
function outcome(power){const r=Math.random(),skill=Math.max(0,1-Math.abs(power-.72));if(skill>.72&&r<.62)return"swish";if(skill>.45&&r<.82)return"rim";return"miss"}
function shoot(power=.72){if(state.selected===null||state.ended||!gateComplete())return;const p=$("paper");if(p.dataset.flying)return;const o=outcome(power);
 // trajectory computed from the live rim element so it lands dead-centre at every screen size
 const st=$("stage").getBoundingClientRect(),rf=$("rimFront").getBoundingClientRect(),nw=$("netWrap").getBoundingClientRect(),pr=p.getBoundingClientRect();
 const cx=(rf.left+rf.width/2-st.left)/st.width*100,cy=(rf.top+rf.height/2-st.top)/st.height*100,nb=(nw.bottom-st.top)/st.height*100;
 const px=(pr.left+pr.width/2-st.left)/st.width*100,py=(pr.top+pr.height/2-st.top)/st.height*100;
 const TR="translate(-50%,-50%)";p.dataset.flying="1";
 const done=()=>{
    p.getAnimations().forEach(a=>a.cancel());delete p.dataset.flying;p.className="live paper";p.removeAttribute("style");
    if(state.selected===null){
      // Scored — hand returns empty, paper disappears
      p.classList.add("paper--hidden");p.textContent="";setHandState("EMPTY");
    }else{
      // Missed — paper returns to grip; hand switches back to holding image
      p.textContent=state.assets[state.selected].name;
      p.classList.remove("paper--hidden");
      setHandState("HOLDING_PAPER",{skipAppear:true});
    }
  };
 const showToast=t=>{$("toast").textContent=t;$("toast").classList.remove("show");void $("toast").offsetWidth;$("toast").classList.add("show")};
 // scoring fires the moment the paper crosses the rim — not when the shot starts
 const scoreNow=()=>{if(o==="swish")tone(980,.13,"sine",.04);state.me++;state.combo++;state.crowd=Math.min(100,state.crowd+(o==="swish"?10:6));state.assets[state.selected].scored=true;state.selected=null;cheer();confetti();const n=$("netImg");n.classList.remove("net-anim");void n.offsetWidth;n.classList.add("net-anim");showToast(o==="swish"?"SWISH +1":"RIM IN +1");if(window.arenaReact)window.arenaReact(state.combo);render()};
 // fall through the inside of the net, shrink, fade only below the net's bottom
 const fall=()=>{p.animate([{left:cx+"%",top:cy+"%",transform:TR+" scale(.32) rotate(540deg)",opacity:1},{left:cx+"%",top:(nb-.6)+"%",transform:TR+" scale(.2) rotate(600deg)",opacity:1,offset:.72},{left:cx+"%",top:(nb+1.6)+"%",transform:TR+" scale(.13) rotate(640deg)",opacity:0}],{duration:430,easing:"cubic-bezier(.5,0,.8,.4)",fill:"forwards"}).onfinish=()=>{setTimeout(done,60)}};
 if(o==="miss"){const side=Math.random()<.5?-1:1,mx=cx+side*9;
  p.animate([{left:px+"%",top:py+"%",transform:TR+" scale(1) rotate(0deg)"},{left:(px+(cx-px)*.5+side*3)+"%",top:(cy+14)+"%",transform:TR+" scale(.62) rotate(360deg)",offset:.55},{left:mx+"%",top:(cy-1)+"%",transform:TR+" scale(.4) rotate(560deg)"}],{duration:600,easing:"cubic-bezier(.18,.82,.22,1)",fill:"forwards"}).onfinish=()=>{
   missSound();showToast("MISSED");state.combo=0;state.crowd=Math.max(0,state.crowd-5);render();
   p.animate([{left:mx+"%",top:(cy-1)+"%",transform:TR+" scale(.4) rotate(560deg)",opacity:1},{left:(mx+side*5)+"%",top:(cy+15)+"%",transform:TR+" scale(.3) rotate(680deg)",opacity:0}],{duration:360,easing:"cubic-bezier(.5,0,.8,.4)",fill:"forwards"}).onfinish=done};return}
 const curve=Math.random()<.5?-6:6;
 p.animate([{left:px+"%",top:py+"%",transform:TR+" scale(1) rotate(0deg)"},{left:(px+(cx-px)*.5+curve)+"%",top:(cy+15)+"%",transform:TR+" scale(.6) rotate(300deg)",offset:.55},{left:cx+"%",top:(cy-(o==="rim"?.8:0))+"%",transform:TR+" scale(.34) rotate(540deg)"}],{duration:620,easing:"cubic-bezier(.18,.82,.22,1)",fill:"forwards"}).onfinish=()=>{
  if(o==="rim"){rimSound();
   p.animate([{left:cx+"%",top:(cy-.8)+"%",transform:TR+" scale(.34) rotate(540deg)"},{left:(cx+1.6)+"%",top:(cy-2.6)+"%",transform:TR+" scale(.33) rotate(580deg)",offset:.5},{left:cx+"%",top:cy+"%",transform:TR+" scale(.32) rotate(600deg)"}],{duration:300,easing:"ease-out",fill:"forwards"}).onfinish=()=>{scoreNow();fall()}
  }else{scoreNow();fall()}}
}
function finalBell(){if(state.ended||!gateComplete())return;state.liabilities.forEach(l=>{if(l.addressed&&l.avoided)state.me++;else state.notme++});state.ended=true;const meWon=state.me>state.notme;if(meWon){state.streak++;state.best=Math.max(state.best,state.streak);state.weekly.meWins++;cheer();confetti()}else{state.streak=1;state.weekly.notMeWins++;boo()}state.weekly.history.push({date:today,me:state.me,notme:state.notme});checkCeremonies();render()}
function checkCeremonies(){const s=state.streak;if(s>=90&&!state.shown[90]){state.shown[90]=true;showCeremony("90 Days Straight","🎽","Retirement Ceremony — Team Me Next Level retires the jersey.")}else if(s>=60&&!state.shown[60]){state.shown[60]=true;showCeremony("60 Days Straight","🖼️","Welcome to the Me Next Level Wall of Fame.")}else if(s>=30&&!state.shown[30]){state.shown[30]=true;state.gate={required:true,asset:false,liability:false};showCeremony("30 Days Straight","🏆","Me Next Level Champion. Add one new Asset and one new Liability for the next challenge.")}else if(s>=7&&!state.shown[7]){state.shown[7]=true;showCeremony("7 Days Straight","📸","Paparazzi are waiting. Sign your autograph.")}}
function showCeremony(title,icon,text){$("ceremonyTitle").textContent=title;$("ceremonyIcon").textContent=icon;$("ceremonyText").textContent=text;$("ceremonySignature").textContent=state.signature;$("ceremony").classList.add("show");if(window.arenaCelebrate)window.arenaCelebrate()}
const ASSET_CHIPS=["Workout","Reading","Family Time","Saving Money","Building My Business","Healthy Eating","Learning"];
const LIAB_CHIPS=["Procrastination","Overspending","Self-Doubt","Too Much Screen Time","Poor Sleep","Negative Thinking"];
function normalize(s){return s.toLowerCase().trim().replace(/\s+/g," ").replace(/[^\w\s]/g,"").trim()}
function clearModalHint(){const h=$("modalHint");if(h){h.textContent="";h.className="modal-hint"}}
function openModal(type){mode=type;$("modalTitle").textContent=type==="asset"?"WHAT MOVES YOU FORWARD?":"WHAT'S HOLDING YOU BACK?";$("tagInput").value="";$("tagInput").placeholder="Type your own...";clearModalHint();const list=type==="asset"?state.assets:state.liabilities;const hasEntries=list.length>0;const inspireRow=$("inspireChips")&&$("inspireChips").closest(".inspire-row");if(hasEntries){const chips=type==="asset"?ASSET_CHIPS:LIAB_CHIPS;$("inspireChips").innerHTML=chips.map(c=>`<button type="button" class="inspire-chip" data-val="${c}">${c}</button>`).join("");if(inspireRow)inspireRow.style.display=""}else{$("inspireChips").innerHTML="";if(inspireRow)inspireRow.style.display="none"}$("modal").classList.add("show");$("tagInput").focus()}
function saveTag(){
  const v=$("tagInput").value.trim();if(!v)return;
  const norm=normalize(v);
  const h=$("modalHint");
  // Same-category duplicate check
  const sameList=mode==="asset"?state.assets:state.liabilities;
  const dupIdx=sameList.findIndex(x=>normalize(x.name)===norm);
  if(dupIdx!==-1){
    if(h){h.textContent=mode==="asset"?"Already on your team — This Asset already exists. Use the existing tag instead.":"Already on your team — This Liability already exists. Use the existing tag instead.";h.className="modal-hint modal-hint--error";}
    const listId=mode==="asset"?"assets":"liabilities";
    const tags=document.querySelectorAll("#"+listId+" .tag");
    const el=tags[dupIdx];if(el){el.scrollIntoView({block:"nearest",behavior:"smooth"});el.classList.remove("tag--flash");void el.offsetWidth;el.classList.add("tag--flash");}
    return;
  }
  // Cross-category duplicate check
  const otherList=mode==="asset"?state.liabilities:state.assets;
  if(otherList.some(x=>normalize(x.name)===norm)){
    if(h){h.textContent="This already exists on the other team. Use the existing entry or rename this one so its meaning is clear.";h.className="modal-hint modal-hint--warn";}
    return;
  }
  clearModalHint();
  if(mode==="asset"){state.assets.push({name:v,done:false,scored:false});if(state.gate.required)state.gate.asset=true}else{state.liabilities.push({name:v,addressed:false,avoided:true});if(state.gate.required)state.gate.liability=true}
  if(gateComplete())state.gate.required=false;$("modal").classList.remove("show");render()
}
function updateClock(){const d=new Date(),e=new Date();e.setHours(23,59,59,999);const m=Math.max(0,Math.floor((e-d)/60000));$("clock").textContent=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")}
// ---- Hand throw animation (WAAPI position + frame-sequenced pose swap) ----
// startRx/Ry = right-hand px offset at release moment (from drag)
// startRr    = right-hand wrist rotation in deg at release moment
// Frame sequence: RELEASE → FOLLOWTHROUGH (at peak) → EMPTY (after return)
let _throwTimers=[];
function animateThrow(power,startRx,startRy,startRr){
  const hR=$("handRight"),hW=$("handWrap");if(!hW)return;
  _throwTimers.forEach(clearTimeout);_throwTimers=[];
  hW.getAnimations().forEach(a=>a.cancel());
  hW.classList.remove("hand--aiming");hW.style.transition="none";
  const p=Math.max(0,Math.min(1,power));
  // Timing: faster flick → shorter phases
  const tMs=Math.round(250-p*100);   // forward throw peak:  150–250 ms
  const fMs=Math.round(330-p*100);   // follow-through:      230–330 ms
  const rMs=Math.round(440-p*100);   // return to rest:      340–440 ms
  const tot=tMs+fMs+rMs;
  const tOff=tMs/tot, fOff=(tMs+fMs)/tot;
  // Frame 1 — RELEASE (already set by setHandState("THROWING") before this call)
  // Frame 2 — FOLLOWTHROUGH when hand reaches peak of forward motion
  _throwTimers.push(setTimeout(()=>{if(hR)hR.src=HAND_FOLLOWTHROUGH;},tMs));
  // Frame 3 — EMPTY when hand has returned to rest; reset wrap transform too
  _throwTimers.push(setTimeout(()=>{if(hR)hR.src=HAND_EMPTY;if(hW)hW.style.transform="";},tMs+fMs));
  // WAAPI spatial transform on wrap: start pos → lunge forward/up → follow-through arc → rest
  hW.animate([
    {transform:`translate(${startRx}px,${startRy}px) rotate(${startRr}deg)`},
    {transform:`translate(-4%,-11%) rotate(-24deg) scaleX(1.09)`,offset:tOff,easing:"cubic-bezier(.1,.8,.2,1)"},
    {transform:`translate(-2%,-6.5%) rotate(-14deg) scaleX(1.04)`,offset:fOff,easing:"ease-out"},
    {transform:"translate(0,0) rotate(0deg) scale(1)"}
  ],{duration:tot,easing:"ease-in-out",fill:"none"});
}
$("heldPaper").onpointerdown=e=>{
  if(state.selected===null||$("paper").dataset.flying)return;
  dragging=true;start={x:e.clientX,y:e.clientY};
  $("heldPaper").setPointerCapture(e.pointerId);$("heldPaper").classList.add("dragging");
  const hW=$("handWrap");
  if(hW){hW.getAnimations().forEach(a=>a.cancel());hW.style.transition="none";hW.style.transform=""}
  setHandState("AIMING");
};
$("heldPaper").onpointermove=e=>{
  if(!dragging)return;
  const dx=e.clientX-start.x,dy=e.clientY-start.y,p=Math.min(1,Math.hypot(dx,dy)/150);
  renderPower(p);
  // Paper moves 26% locally; wrap moves 9% → 35% total screen motion (same feel as before)
  $("heldPaper").style.transform=`translate(calc(-50% + ${dx*.26}px),calc(-50% + ${dy*.26}px))`;
  const hR=$("handRight"),hW=$("handWrap");
  if(hW){
    // PULLBACK pose: wrist fully cocked; inline transform drives wrap position
    if(handState!=="PULLBACK"&&hR){hR.src=HAND_PULLBACK;hW.classList.remove("hand--aiming");}
    hW.style.transform=`translate(${dx*.09}px,${dy*.09}px) rotate(${dx*.028}deg)`;
  }
  handState="PULLBACK";
};
$("heldPaper").onpointerup=e=>{
  if(!dragging)return;
  dragging=false;
  const dx=e.clientX-start.x,dy=e.clientY-start.y;
  const p=Math.min(1,Math.hypot(dx,dy)/150);
  $("heldPaper").classList.remove("dragging");renderPower(0);
  const hW=$("handWrap");if(hW){hW.style.transition="";hW.classList.remove("hand--aiming")}
  // Transfer paper from grip to stage, then animate throw
  setHandState("THROWING");
  animateThrow(p,dx*.09,dy*.09,dx*.028);
  shoot(p);
};
// Shoot button: brief AIMING flash then throw
function triggerButtonShoot(){
  if($("paper").dataset.flying||state.selected===null||state.ended||!gateComplete())return;
  setHandState("AIMING");
  // After the wrist-cock pause, switch to open hand and release paper
  setTimeout(()=>{setHandState("THROWING");animateThrow(.72,0,0,0);shoot(.72)},110);
}
$("shoot").onclick=triggerButtonShoot;
$("panelAddAsset").onclick=()=>openModal("asset");$("panelAddLiability").onclick=()=>openModal("liability");$("finalBell").onclick=finalBell;$("cancel").onclick=()=>{$("modal").classList.remove("show");clearModalHint()};$("save").onclick=saveTag;
$("tagInput").addEventListener("input",clearModalHint);
$("inspireChips").addEventListener("click",e=>{const b=e.target.closest(".inspire-chip");if(b){$("tagInput").value=b.dataset.val;clearModalHint();$("tagInput").focus()}});
$("closeHistory").onclick=()=>$("historyPanel").classList.remove("show");
// ---- Calendar Panel ----
(function(){
  let calYear=new Date().getFullYear(),calMonth=new Date().getMonth();
  const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
  function buildHistoryMap(){
    const map={};
    (state.weekly.history||[]).forEach(h=>{
      if(!h||!h.date)return;
      const me=Number(h.me)||0,notme=Number(h.notme)||0;
      map[h.date]=me>notme?"me":notme>me?"notme":"draw";
    });
    return map;
  }
  function renderCalendar(y,m){
    calYear=y;calMonth=m;
    $("calMonthLabel").textContent=MONTHS[m]+" "+y;
    const grid=$("calendarGrid");
    grid.innerHTML="";
    DAYS.forEach(d=>{const el=document.createElement("div");el.className="cal-day-header";el.textContent=d;grid.appendChild(el);});
    const firstDay=new Date(y,m,1).getDay();
    const daysInMonth=new Date(y,m+1,0).getDate();
    const map=buildHistoryMap();
    for(let i=0;i<firstDay;i++){const el=document.createElement("div");el.className="cal-day cal-day--empty";grid.appendChild(el);}
    for(let d=1;d<=daysInMonth;d++){
      const el=document.createElement("div");el.className="cal-day";
      const key=y+"-"+String(m+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
      if(key===today)el.classList.add("cal-day--today");
      if(map[key])el.dataset.result=map[key];
      el.textContent=d;
      grid.appendChild(el);
    }
  }
  window.openCalendar=function(){
    const now=new Date();renderCalendar(now.getFullYear(),now.getMonth());$("calendarPanel").classList.add("show");
  };
  $("calPrev").onclick=()=>renderCalendar(calMonth===0?calYear-1:calYear,calMonth===0?11:calMonth-1);
  $("calNext").onclick=()=>renderCalendar(calMonth===11?calYear+1:calYear,calMonth===11?0:calMonth+1);
  $("closeCalendar").onclick=()=>$("calendarPanel").classList.remove("show");
  $("calendarPanel").addEventListener("click",e=>{if(e.target===$("calendarPanel"))$("calendarPanel").classList.remove("show");});
})();$("saveFriend").onclick=()=>{state.friend.name=$("friendName").value.trim();state.friend.score=$("friendScore").value===""?null:Number($("friendScore").value);render()};
$("closeCeremony").onclick=()=>$("ceremony").classList.remove("show");$("editSignature").onclick=()=>{const n=prompt("Enter your signature:",state.signature);if(n&&n.trim()){state.signature=n.trim();$("ceremonySignature").textContent=state.signature;saveState()}};
$("share").onclick=async()=>{const t=`Me Next Level: Me Next Level ${state.me} — ${state.notme} Holding Me Back`;try{if(navigator.share)await navigator.share({title:"Me Next Level",text:t})}catch(e){}};
loadState();renderPower(0);render();updateClock();setInterval(updateClock,30000);
// Sync hand/paper state from whatever was persisted in localStorage
if(state.selected!==null){
  const hp=$("heldPaper");if(hp)hp.textContent=state.assets[state.selected]?.name||"";
  setHandState("HOLDING_PAPER",{skipAppear:true});
}else{
  setHandState("EMPTY");
}
$("netImg").addEventListener("animationend",()=>$("netImg").classList.remove("net-anim"));
