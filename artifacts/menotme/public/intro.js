// New-day arena intro: Yesterday's result → "NEW DAY. NEW GAME." → lights pulse
// → TUM-TA-TUM-TUM-TA crowd rhythm → cheer + "TEAM ME!" chant → scoreboard 0-0.
// Purely additive overlay; game mechanics untouched.
(function(){
"use strict";
if(window.__mnmIntroInit)return;window.__mnmIntroInit=true;
const DAY_KEY="mnm_intro_day";

function yesterdayResult(){
  const h=(state.weekly&&state.weekly.history)||[];
  const last=h[h.length-1];
  if(!last||last.date===today)return null;
  return last;
}

function shouldShow(){
  if(localStorage.getItem(DAY_KEY)===today)return false;
  if(!localStorage.getItem("mnm_onboarded_v1")){localStorage.setItem(DAY_KEY,today);return false} // don't stack on onboarding
  if(!yesterdayResult()&&!localStorage.getItem(DAY_KEY)){localStorage.setItem(DAY_KEY,today);return false} // first ever day
  return true;
}

// Pick commentary clips from the pregenerated library based on real game state.
// Never announces asset/liability/fan/doubter names — the library is fixed text only.
function pickCommentary(){
  const last=yesterdayResult(),streak=state.streak||0,hist=(state.weekly&&state.weekly.history)||[];
  const rnd=a=>a[Math.floor(Math.random()*a.length)];
  const newUser=!last&&!hist.length;
  const greet=newUser?"comm_greet_1":rnd(["comm_greet_1","comm_greet_2","comm_greet_3"]);
  let mid;
  if([7,30,60,90].indexOf(streak+1)>=0)mid="comm_milestone_1";
  else if(newUser)mid="comm_new_1";
  else if(last&&last.notme>=last.me)mid=rnd(["comm_loss_1","comm_loss_2"]);
  else if(streak>=7)mid="comm_streakbig_1";
  else if(streak>=3)mid="comm_streak_1";
  else if(last&&last.me>last.notme)mid=rnd(["comm_win_1","comm_win_2"]);
  else mid="comm_neutral_1";
  const out=rnd(["comm_out_1","comm_out_2","comm_out_3"]);
  return [greet,mid,out];
}

function build(){
  const last=yesterdayResult();
  const ov=document.createElement("div");ov.id="introOverlay";
  let res;
  if(last){
    const w=last.me>last.notme?"TEAM ME NEXT LEVEL TOOK THE DAY":last.notme>last.me?"TEAM HOLDING ME BACK TOOK THE DAY":"IT WAS A DRAW";
    res="<p class='io-label'>YESTERDAY'S FINAL SCORE</p><p class='io-score'>"+last.me+" — "+last.notme+"</p><p class='io-winner'>"+w+"</p>";
  }else res="<p class='io-label'>WELCOME BACK</p>";
  ov.innerHTML="<div class='io-card'><div id='ioResult'>"+res+"</div><div id='ioNew' class='io-new'>NEW DAY.<br>NEW GAME.</div><p id='ioMic' class='io-mic'>🎙 LIVE FROM THE ARENA</p><button id='ioStart'>START TODAY'S GAME</button></div><button id='ioSkip'>SKIP INTRO ›</button>";
  document.body.appendChild(ov);
  document.getElementById("ioStart").onclick=run;
  document.getElementById("ioSkip").onclick=skip;
}

let timers=[],finished=false;
function later(fn,ms){timers.push(setTimeout(fn,ms))}
function finish(fast){
  if(finished)return;finished=true;
  timers.forEach(clearTimeout);timers=[];
  const ov=document.getElementById("introOverlay"),stage=document.getElementById("stage");
  if(ov){ov.classList.add("io-out");setTimeout(()=>ov.remove(),fast?150:700)}
  if(stage)stage.classList.remove("lights-pulse");
  ["meScore","notMeScore"].forEach(id=>{const el=document.getElementById(id);if(el){el.classList.add("led-reset");el.addEventListener("animationend",()=>el.classList.remove("led-reset"),{once:true})}});
}
function skip(){
  localStorage.setItem(DAY_KEY,today);
  if(window.stopIntroAudio)window.stopIntroAudio();
  finish(true);
}

function run(){
  localStorage.setItem(DAY_KEY,today);
  const startBtn=document.getElementById("ioStart"),mic=document.getElementById("ioMic"),stage=document.getElementById("stage");
  if(startBtn)startBtn.style.display="none";
  later(()=>{ // result fades, lights start pulsing
    const r=document.getElementById("ioResult"),n=document.getElementById("ioNew");
    if(r)r.classList.add("io-gone");
    if(stage)stage.classList.add("lights-pulse");
    if(mic&&window.commentaryEnabled&&window.commentaryEnabled())mic.classList.add("io-show");
    if(n&&!(window.commentaryEnabled&&window.commentaryEnabled()))n.classList.add("io-show");
  },300);
  const talking=window.playCommentary?window.playCommentary(pickCommentary()):Promise.resolve();
  // Commentator intro → rhythm → cheer/chant → scoreboard 0-0 → play.
  // Hard cap keeps the whole sequence under ~8s even if audio stalls.
  let done=false;
  const proceed=()=>{
    if(done||finished)return;done=true;
    const n=document.getElementById("ioNew");
    if(mic)mic.classList.remove("io-show");
    if(n)n.classList.add("io-show");
    if(window.playIntroSound)window.playIntroSound();
    later(()=>{if(window.arenaReact)window.arenaReact(4)},2600);
    later(()=>finish(false),3100);
  };
  talking.then(proceed);
  later(proceed,4300); // cap: worst case ~7.4s total, safely under 8s
}

if(shouldShow())build();
})();
