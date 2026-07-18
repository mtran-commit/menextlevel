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

function build(){
  const last=yesterdayResult();
  const ov=document.createElement("div");ov.id="introOverlay";
  let res;
  if(last){
    const w=last.me>last.notme?"TEAM ME TOOK THE DAY":last.notme>last.me?"TEAM NOT ME TOOK THE DAY":"IT WAS A DRAW";
    res="<p class='io-label'>YESTERDAY'S RESULT</p><p class='io-score'>"+last.me+" — "+last.notme+"</p><p class='io-winner'>"+w+"</p>";
  }else res="<p class='io-label'>WELCOME BACK</p>";
  ov.innerHTML="<div class='io-card'><div id='ioResult'>"+res+"</div><div id='ioNew' class='io-new'>NEW DAY.<br>NEW GAME.</div><button id='ioStart'>START TODAY'S GAME</button></div>";
  document.body.appendChild(ov);
  document.getElementById("ioStart").onclick=run;
}

function run(){
  localStorage.setItem(DAY_KEY,today);
  const ov=document.getElementById("introOverlay");
  document.getElementById("ioStart").style.display="none";
  const stage=document.getElementById("stage");
  setTimeout(()=>{ // Yesterday's result fades, headline lands
    document.getElementById("ioResult").classList.add("io-gone");
    document.getElementById("ioNew").classList.add("io-show");
    if(stage)stage.classList.add("lights-pulse");
  },300);
  setTimeout(()=>{if(window.playIntroSound)window.playIntroSound()},800); // TUM-TA-TUM-TUM-TA → cheer + TEAM ME! chant (in the clip)
  setTimeout(()=>{if(window.arenaReact)window.arenaReact(4)},3400);       // fans lift signs on the final beat
  setTimeout(()=>{ // scoreboard flickers in at 0 - 0, overlay clears, play begins
    ov.classList.add("io-out");
    ["meScore","notMeScore"].forEach(id=>{const el=document.getElementById(id);if(el){el.classList.add("led-reset");el.addEventListener("animationend",()=>el.classList.remove("led-reset"),{once:true})}});
  },3900);
  setTimeout(()=>{ov.remove();if(stage)stage.classList.remove("lights-pulse")},4600);
}

if(shouldShow())build();
})();
