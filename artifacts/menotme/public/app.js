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
function setHandState(s,opts){
  const prev=handState;handState=s;
  const hR=$("handRight"),p=$("paper");if(!p)return;
  if(s==="EMPTY"){
    p.classList.add("paper--hidden");p.textContent="";
    if(hR){hR.classList.remove("hand--aiming");hR.style.transition=""}
  } else if(s==="HOLDING_PAPER"){
    if(hR)hR.classList.remove("hand--aiming");
    if(prev==="EMPTY"&&!(opts&&opts.skipAppear)){
      // Paper appears with a brief scale-up from the hand
      p.classList.remove("paper--hidden");
      p.getAnimations().forEach(a=>a.cancel());
      p.animate(
        [{transform:"translate(-50%,-50%) scale(0.45)",opacity:0},
         {transform:"translate(-50%,-50%) scale(1.06)",opacity:1,offset:.7,easing:"ease-out"},
         {transform:"translate(-50%,-50%) scale(1)",opacity:1}],
        {duration:240,easing:"cubic-bezier(.2,.8,.3,1)",fill:"none"});
    } else {
      p.classList.remove("paper--hidden");
    }
  } else if(s==="AIMING"){
    p.classList.remove("paper--hidden");
    if(hR)hR.classList.add("hand--aiming");
  } else {
    // PULLBACK / THROWING — paper visible, no aiming class (drag/WAAPI controls transform)
    p.classList.remove("paper--hidden");
    if(hR)hR.classList.remove("hand--aiming");
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
 $("meScore").textContent=state.me;$("notMeScore").textContent=state.notme;$("streak").textContent=state.streak;$("bestStreak").textContent=state.best;$("winner").textContent=state.me>state.notme?"TEAM ME NEXT LEVEL":state.notme>state.me?"TEAM HOLDING ME BACK":"DRAW";$("crowd").style.width=state.crowd+"%";$("crowdPct").textContent=state.crowd+"%";$("combo").textContent="X"+state.combo;$("gate").classList.toggle("show",state.gate.required&&!gateComplete());
 $("assets").innerHTML="";if(state.assets.length===0){$("assets").innerHTML='<div class="empty-state"><p class="es-title">BUILD YOUR TEAM</p><p class="es-sub">What will move you closer to your next level?</p><button class="es-btn" id="emptyAddAsset">+ ADD MY FIRST ASSET</button></div>';const ea=$("emptyAddAsset");if(ea)ea.onclick=()=>openModal("asset")}else{state.assets.forEach((a,i)=>{const b=document.createElement("button");b.className="tag"+(a.done?" active":"")+(a.scored?" scored":"");b.disabled=state.ended||a.scored||!gateComplete();b.innerHTML="<span>☆</span><span>"+a.name+"</span>"+(a.scored?"<small>SCORED</small>":"");b.onclick=()=>selectAsset(i);$("assets").appendChild(b)})}
 $("liabilities").innerHTML="";if(state.liabilities.length===0){$("liabilities").innerHTML='<div class="empty-state"><p class="es-title">WHAT\'S HOLDING<br>YOU BACK?</p><p class="es-sub">Choose something you want to beat, reduce or stop.</p><button class="es-btn" id="emptyAddLiab">+ ADD MY FIRST LIABILITY</button></div>';const el=$("emptyAddLiab");if(el)el.onclick=()=>openModal("liability")}else{state.liabilities.forEach((l,i)=>{const b=document.createElement("button");b.className="tag"+(l.addressed&&l.avoided?" active":"");b.disabled=state.ended||!gateComplete();b.innerHTML="<span>○</span><span>"+l.name+"</span><small>"+(!l.addressed?"IGNORED":l.avoided?"AVOIDED":"HAPPENED")+"</small>";b.onclick=()=>toggleLiability(i);$("liabilities").appendChild(b)})}
 $("weekMe").textContent=state.weekly.meWins;$("weekNotMe").textContent=state.weekly.notMeWins;$("weekStreak").textContent=state.streak;$("historyList").innerHTML=state.weekly.history.slice(-7).reverse().map(h=>"<p>"+h.date+": Me Next Level "+h.me+" — "+h.notme+" Holding Me Back</p>").join("")||"<p>No completed days yet.</p>";
 if(window.renderArena)window.renderArena();
 if(state.friend.name){$("friendName").value=state.friend.name;$("friendScore").value=state.friend.score??"";$("friendResult").textContent=state.friend.score==null?"No friend score yet.":state.me>state.friend.score?"You lead "+state.me+"–"+state.friend.score:state.me<state.friend.score?state.friend.name+" leads "+state.friend.score+"–"+state.me:"Draw "+state.me+"–"+state.friend.score}
 saveState()
}
function selectAsset(i){if(state.ended||!gateComplete())return;state.selected=i;state.assets[i].done=true;$("paper").textContent=state.assets[i].name;tone(360,.06,"square",.02);setHandState("HOLDING_PAPER");render()}
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
      p.classList.add("paper--hidden");p.textContent="";setHandState("EMPTY");
    }else{
      p.textContent=state.assets[state.selected].name;
      handState="HOLDING_PAPER";const hR=$("handRight");if(hR)hR.classList.remove("hand--aiming");
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
function openModal(type){mode=type;$("modalTitle").textContent=type==="asset"?"WHAT MOVES YOU FORWARD?":"WHAT'S HOLDING YOU BACK?";$("tagInput").value="";$("tagInput").placeholder="Type your own...";const chips=type==="asset"?ASSET_CHIPS:LIAB_CHIPS;$("inspireChips").innerHTML=chips.map(c=>`<button type="button" class="inspire-chip" data-val="${c}">${c}</button>`).join("");$("modal").classList.add("show");$("tagInput").focus()}
function saveTag(){const v=$("tagInput").value.trim();if(!v)return;if(mode==="asset"){state.assets.push({name:v,done:false,scored:false});if(state.gate.required)state.gate.asset=true}else{state.liabilities.push({name:v,addressed:false,avoided:true});if(state.gate.required)state.gate.liability=true}if(gateComplete())state.gate.required=false;$("modal").classList.remove("show");render()}
function updateClock(){const d=new Date(),e=new Date();e.setHours(23,59,59,999);const m=Math.max(0,Math.floor((e-d)/60000));$("clock").textContent=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0")}
// ---- Hand throw animation (WAAPI, velocity-scaled) ----
// startRx/Ry = right-hand px offset at release moment (from drag)
// startRr    = right-hand wrist rotation in deg at release moment
function animateThrow(power,startRx,startRy,startRr){
  const hR=$("handRight");if(!hR)return;
  hR.getAnimations().forEach(a=>a.cancel());
  hR.classList.remove("hand--aiming");hR.style.transition="none";
  const p=Math.max(0,Math.min(1,power));
  // Timing: faster flick → shorter phases
  const tMs=Math.round(250-p*100);   // throw/release:  150–250 ms
  const fMs=Math.round(380-p*130);   // follow-through: 250–380 ms
  const rMs=Math.round(480-p*130);   // return to ready:350–480 ms
  const tot=tMs+fMs+rMs;
  const tOff=tMs/tot, fOff=(tMs+fMs)/tot;
  // Right hand: pull-back pos → lunge forward-up (release) → follow-through → return
  hR.animate([
    {transform:`translate(${startRx}px,${startRy}px) rotate(${startRr}deg)`},
    {transform:`translate(-4%,-11%) rotate(-24deg) scaleX(1.09)`,offset:tOff,easing:"cubic-bezier(.1,.8,.2,1)"},
    {transform:`translate(-2%,-6.5%) rotate(-14deg) scaleX(1.04)`,offset:fOff,easing:"ease-out"},
    {transform:"translate(0,0) rotate(0deg) scale(1)"}
  ],{duration:tot,easing:"ease-in-out",fill:"none"});
}
$("paper").onpointerdown=e=>{
  if(state.selected===null||$("paper").dataset.flying)return;
  dragging=true;start={x:e.clientX,y:e.clientY};
  $("paper").setPointerCapture(e.pointerId);$("paper").classList.add("dragging");
  const hR=$("handRight");
  if(hR){hR.getAnimations().forEach(a=>a.cancel());hR.style.transition="none";hR.style.transform=""}
  // Briefly enter AIMING (wrist rotates to throw-ready) before first drag move
  handState="AIMING";if(hR)hR.classList.add("hand--aiming");
};
$("paper").onpointermove=e=>{
  if(!dragging)return;
  const dx=e.clientX-start.x,dy=e.clientY-start.y,p=Math.min(1,Math.hypot(dx,dy)/150);
  renderPower(p);
  $("paper").style.transform=`translate(calc(-50% + ${dx*.35}px),calc(-50% + ${dy*.35}px))`;
  const hR=$("handRight");
  if(hR){
    // Inline transform takes over from AIMING class; remove class to avoid double-transform
    hR.classList.remove("hand--aiming");
    hR.style.transform=`translate(${dx*.09}px,${dy*.09}px) rotate(${dx*.028}deg)`;
  }
  handState="PULLBACK";
};
$("paper").onpointerup=e=>{
  if(!dragging)return;
  dragging=false;
  const dx=e.clientX-start.x,dy=e.clientY-start.y;
  const p=Math.min(1,Math.hypot(dx,dy)/150);
  $("paper").classList.remove("dragging");renderPower(0);
  const hR=$("handRight");if(hR){hR.style.transition="";hR.classList.remove("hand--aiming")}
  handState="THROWING";
  animateThrow(p,dx*.09,dy*.09,dx*.028);
  shoot(p);
};
// Shoot button: brief AIMING flash then throw
function triggerButtonShoot(){
  if($("paper").dataset.flying||state.selected===null||state.ended||!gateComplete())return;
  setHandState("AIMING");
  setTimeout(()=>{handState="THROWING";animateThrow(.72,0,0,0);shoot(.72)},110);
}
$("shoot").onclick=triggerButtonShoot;
$("assetShot").onclick=triggerButtonShoot;
$("addAsset").onclick=$("panelAddAsset").onclick=()=>openModal("asset");$("addLiability").onclick=$("panelAddLiability").onclick=()=>openModal("liability");$("finalBell").onclick=finalBell;$("cancel").onclick=()=>$("modal").classList.remove("show");$("save").onclick=saveTag;
$("inspireChips").addEventListener("click",e=>{const b=e.target.closest(".inspire-chip");if(b){$("tagInput").value=b.dataset.val;$("tagInput").focus()}});
$("liabilityList").onclick=()=>$("historyPanel").classList.add("show");$("closeHistory").onclick=()=>$("historyPanel").classList.remove("show");$("saveFriend").onclick=()=>{state.friend.name=$("friendName").value.trim();state.friend.score=$("friendScore").value===""?null:Number($("friendScore").value);render()};
$("closeCeremony").onclick=()=>$("ceremony").classList.remove("show");$("editSignature").onclick=()=>{const n=prompt("Enter your signature:",state.signature);if(n&&n.trim()){state.signature=n.trim();$("ceremonySignature").textContent=state.signature;saveState()}};
$("share").onclick=async()=>{const t=`Me Next Level: Me Next Level ${state.me} — ${state.notme} Holding Me Back`;try{if(navigator.share)await navigator.share({title:"Me Next Level",text:t})}catch(e){}};
loadState();renderPower(0);render();updateClock();setInterval(updateClock,30000);
// Sync hand/paper state from whatever was persisted in localStorage
if(state.selected!==null){
  $("paper").textContent=state.assets[state.selected]?.name||"";
  setHandState("HOLDING_PAPER",{skipAppear:true});
}else{
  setHandState("EMPTY");
}
$("netImg").addEventListener("animationend",()=>$("netImg").classList.remove("net-anim"));
