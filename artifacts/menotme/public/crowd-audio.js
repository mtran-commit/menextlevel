// Crowd audio engine: voice reactions, ambience, chants, beats.
// Generated, commercially-licensed audio assets in assets/audio/ (no browser TTS).
// Layers on top of app.js by wrapping tone/cheer/boo/missSound — no game mechanics changed.
(function(){
"use strict";
if(window.__mnmCrowdAudioInit)return;window.__mnmCrowdAudioInit=true;
const A="assets/audio/";
const FAN_KEYS=["yougotthis","letsgo","teamme","onemore","keepgoing","whatashot"];
const DOUBT_KEYS=["youllmiss","nottoday","cantkeepup","proveit","letssee"];
const FILES={};
FAN_KEYS.forEach(k=>{FILES["fan_"+k+"_m"]=A+"fan_"+k+"_m.mp3";FILES["fan_"+k+"_f"]=A+"fan_"+k+"_f.mp3"});
DOUBT_KEYS.forEach(k=>{FILES["doubt_"+k+"_m"]=A+"doubt_"+k+"_m.mp3";FILES["doubt_"+k+"_f"]=A+"doubt_"+k+"_f.mp3"});
["ambience_loop","beat_loop","cheer_small","cheer_big","groan","jeer","chant_teamme","chant_onemore","intro_rhythm"].forEach(k=>FILES[k]=A+k+".mp3");
// Match commentator library (fictional MeNotMe announcer voice; no private names ever spoken)
["comm_greet_1","comm_greet_2","comm_greet_3","comm_new_1","comm_win_1","comm_win_2","comm_loss_1","comm_loss_2","comm_streak_1","comm_streakbig_1","comm_neutral_1","comm_milestone_1","comm_out_1","comm_out_2","comm_out_3","comm_tutorial_1"].forEach(k=>FILES[k]=A+k+".mp3");
// Contextual Inspiration Engine narrated quotes (pregenerated announcer clips — no runtime TTS)
for(let i=1;i<=64;i++){const k="insp_q"+String(i).padStart(2,"0");FILES[k]=A+k+".mp3"}

function ensureAudioPrefs(){
  if(!state.audio)state.audio={master:true,crowd:true,fanVoices:true,doubterVoices:true,music:false};
  if(state.audio.gameIntro===undefined)state.audio.gameIntro=true;
  if(state.audio.commentator===undefined)state.audio.commentator=true;
  if(state.audio.sfx===undefined)state.audio.sfx=true;       // swish/rim/miss/cheer/boo/bell tones
  if(state.audio.haptics===undefined)state.audio.haptics=true; // vibration — separate from audio, NOT muted by master
  if(state.audio.inspireAudio===undefined)state.audio.inspireAudio=true; // narrated inspiration quotes
  if(state.audio.inspireText===undefined)state.audio.inspireText=true;   // on-screen inspiration quotes
}
function buzz(pattern){
  ensureAudioPrefs();
  if(!state.audio.haptics)return;
  try{if(navigator.vibrate)navigator.vibrate(pattern)}catch(e){}
}
ensureAudioPrefs();

/* ---------- Asset preload & decode cache ---------- */
const raw={},bufs={};
// Inspiration quotes (insp_*) are fetched lazily on first use to keep page load light.
Object.entries(FILES).forEach(([k,url])=>{if(k.indexOf("insp_")!==0)raw[k]=fetch(url).then(r=>{if(!r.ok)throw new Error(url);return r.arrayBuffer()}).catch(()=>null)});
let ctx=null,master=null,crowdBus=null,musicBus=null,voiceBus=null;
async function buf(k){
  if(bufs[k])return bufs[k];
  if(!raw[k]&&FILES[k])raw[k]=fetch(FILES[k]).then(r=>{if(!r.ok)throw new Error(FILES[k]);return r.arrayBuffer()}).catch(()=>null);
  const ab=await raw[k];if(!ab||!ctx)return null;
  try{bufs[k]=await ctx.decodeAudioData(ab.slice(0))}catch(e){return null}
  return bufs[k];
}
function pan(node,v){
  if(ctx.createStereoPanner){const p=ctx.createStereoPanner();p.pan.value=v;node.connect(p);return p}
  return node; // no stereo support: mono fallback
}
function initCtx(){
  if(ctx)return;
  try{ctx=new(window.AudioContext||window.webkitAudioContext)()}catch(e){return}
  master=ctx.createGain();master.connect(ctx.destination);
  crowdBus=ctx.createGain();crowdBus.connect(master);
  musicBus=ctx.createGain();musicBus.gain.value=.22;musicBus.connect(master);
  voiceBus=ctx.createGain();voiceBus.gain.value=.9;voiceBus.connect(master);
  applyPrefs();
}

/* ---------- Loops (ambience + beat) ---------- */
let ambSrc=null,beatSrc=null,ambGain=null;
async function startLoop(kind){
  if(!ctx)return;
  if(kind==="amb"&&!ambSrc){
    const b=await buf("ambience_loop");if(!b||ambSrc)return;
    ambGain=ctx.createGain();ambGain.gain.value=ambLevel();ambGain.connect(crowdBus);
    ambSrc=ctx.createBufferSource();ambSrc.buffer=b;ambSrc.loop=true;ambSrc.connect(ambGain);ambSrc.start();
  }
  if(kind==="beat"&&!beatSrc){
    const b=await buf("beat_loop");if(!b||beatSrc)return;
    beatSrc=ctx.createBufferSource();beatSrc.buffer=b;beatSrc.loop=true;beatSrc.connect(musicBus);beatSrc.start();
  }
}
function stopLoop(kind){
  if(kind==="amb"&&ambSrc){try{ambSrc.stop()}catch(e){}ambSrc=null}
  if(kind==="beat"&&beatSrc){try{beatSrc.stop()}catch(e){}beatSrc=null}
}
function minutesLeft(){const d=new Date(),e=new Date();e.setHours(23,59,59,999);return Math.max(0,Math.floor((e-d)/60000))}
function intensity(){ // 0..1 extra energy: crowd meter + final-hour countdown pressure
  let x=(state.crowd||65)/100*.5;
  const m=minutesLeft();if(m<60)x+=.35*(1-m/60);
  if((state.combo||0)>=3)x+=.15;
  return Math.min(1,x);
}
function ambLevel(){return .10+.14*intensity()}
setInterval(()=>{if(ambGain&&ctx)ambGain.gain.linearRampToValueAtTime(ambLevel(),ctx.currentTime+1.5)},5000);

/* ---------- One-shots ---------- */
function shot(k,dest,vol,panV){
  if(!ctx)return;
  buf(k).then(b=>{
    if(!b)return;
    const s=ctx.createBufferSource();s.buffer=b;
    const g=ctx.createGain();g.gain.value=vol;
    s.connect(g);
    const out=panV!=null?pan(g,panV):g;
    out.connect(dest);s.start();
  });
}

/* ---------- Voice scheduler ---------- */
let voiceBusyUntil=0,cd={fan:0,doubt:0},lastKey={fan:"",doubt:""},hushUntil=0;
function pick(arr,avoid){let k;do{k=arr[Math.floor(Math.random()*arr.length)]}while(arr.length>1&&k===avoid);return k}
function say(side,chance,opts={}){
  ensureAudioPrefs();const a=state.audio;
  if(!ctx||!a.master||(side==="fan"?!a.fanVoices:!a.doubterVoices))return;
  const now=performance.now();
  const hot=intensity()>0.6;
  if(side==="doubt"&&now<hushUntil)return; // doubters go quiet after a comeback
  if(now<voiceBusyUntil||now<cd[side])return;
  if(Math.random()>chance+(hot?.15:0))return;
  const keys=side==="fan"?FAN_KEYS:DOUBT_KEYS;
  let name;
  if(side==="fan"&&opts.chant&&Math.random()<.35)name=Math.random()<.5?"chant_teamme":"chant_onemore";
  else{
    const k=pick(keys,lastKey[side]);lastKey[side]=k;
    name=(side==="fan"?"fan_":"doubt_")+k+"_"+(Math.random()<.5?"m":"f");
  }
  buf(name).then(b=>{
    if(!b)return;
    const nowT=performance.now();
    if(nowT<voiceBusyUntil)return;
    voiceBusyUntil=nowT+b.duration*1000+200;
    cd[side]=nowT+(hot?4500:7000)+Math.random()*6000;
    const s=ctx.createBufferSource();s.buffer=b;
    const g=ctx.createGain();g.gain.value=side==="fan"?.85:.75;
    s.connect(g);
    pan(g,side==="fan"?-.45:.45).connect(voiceBus);
    // duck ambience under the prominent voice
    if(ambGain){ambGain.gain.cancelScheduledValues(ctx.currentTime);ambGain.gain.linearRampToValueAtTime(ambLevel()*.4,ctx.currentTime+.1);ambGain.gain.linearRampToValueAtTime(ambLevel(),ctx.currentTime+b.duration+.4)}
    s.start();
  });
}

/* ---------- Preference application + settings UI ---------- */
function applyPrefs(){
  ensureAudioPrefs();const a=state.audio;
  if(!ctx)return;
  master.gain.value=a.master?1:0;
  if(a.master&&a.crowd)startLoop("amb");else stopLoop("amb");
  if(a.master&&a.music)startLoop("beat");else stopLoop("beat");
}
const PREFS=[["prefSoundMaster","master"],["prefCrowdAudio","crowd"],["prefFanVoices","fanVoices"],["prefDoubterVoices","doubterVoices"],["prefMusic","music"],["prefGameIntro","gameIntro"],["prefCommentator","commentator"],["prefSoundFx","sfx"],["prefHaptics","haptics"],["prefInspireAudio","inspireAudio"],["prefInspireText","inspireText"]];

/* ---------- Quick HUD master audio toggle (🔊 / 🔇) ---------- */
function renderQuickAudio(){
  const b=document.getElementById("audioQuick");if(!b)return;
  ensureAudioPrefs();
  const on=!!state.audio.master;
  b.textContent=on?"🔊 AUDIO ON":"🔇 AUDIO OFF";
  b.classList.toggle("off",!on);
  b.setAttribute("aria-pressed",on?"true":"false");
  const c=document.getElementById("prefSoundMaster");if(c)c.checked=on;
}
(function(){
  const b=document.getElementById("audioQuick");if(!b)return;
  b.onclick=function(){
    ensureAudioPrefs();
    // Only the master flag flips; individual prefs are untouched, so turning
    // audio back ON restores the user's previous per-channel choices.
    state.audio.master=!state.audio.master;
    saveState();initCtx();applyPrefs();renderQuickAudio();
    if(!state.audio.master&&window.stopIntroAudio)window.stopIntroAudio();
  };
  renderQuickAudio();
})();

/* ---------- Intro audio (rhythm + commentator), stoppable via Skip ---------- */
let introStopped=false;const introSrcs=[];
window.stopIntroAudio=function(){introStopped=true;introSrcs.forEach(s=>{try{s.stop()}catch(e){}});introSrcs.length=0;narrGuard=0};
// Time-based narration guard: can't get stuck if a suspended AudioContext never fires onended.
let narrGuard=0;
function guardNarr(sec){narrGuard=Math.max(narrGuard,performance.now()+sec*1000+800)}
window.commentaryEnabled=function(){ensureAudioPrefs();return !!(state.audio.master&&state.audio.commentator)};
// Plays clips back-to-back; resolves when finished (or immediately if disabled/stopped).
window.playCommentary=function(keys){
  ensureAudioPrefs();introStopped=false;
  initCtx();if(ctx&&ctx.state==="suspended")ctx.resume();
  if(!ctx||!state.audio.master||!state.audio.commentator)return Promise.resolve();
  return keys.reduce((p,k)=>p.then(()=>new Promise(res=>{
    if(introStopped)return res();
    buf(k).then(b=>{
      if(!b||introStopped)return res();
      const s=ctx.createBufferSource();s.buffer=b;
      const g=ctx.createGain();g.gain.value=1;s.connect(g);g.connect(voiceBus);
      if(ambGain){ambGain.gain.cancelScheduledValues(ctx.currentTime);ambGain.gain.setValueAtTime(ambLevel()*.35,ctx.currentTime)}
      introSrcs.push(s);s.onended=()=>{const i=introSrcs.indexOf(s);if(i>=0)introSrcs.splice(i,1);setTimeout(res,120)};guardNarr(b.duration);s.start();
    });
  })),Promise.resolve()).then(()=>{if(ambGain&&ctx)ambGain.gain.linearRampToValueAtTime(ambLevel(),ctx.currentTime+.8)});
};

// New-day intro rhythm (TUM-TA-TUM-TUM-TA → cheer + chant). Called from intro.js
// after a user tap, so autoplay policy is satisfied.
window.playIntroSound=function(){
  ensureAudioPrefs();
  initCtx();if(ctx&&ctx.state==="suspended")ctx.resume();
  if(!ctx||!state.audio.master||!state.audio.gameIntro||introStopped)return;
  buf("intro_rhythm").then(b=>{
    if(!b||introStopped)return;
    const s=ctx.createBufferSource();s.buffer=b;
    const g=ctx.createGain();g.gain.value=.95;s.connect(g);g.connect(crowdBus);
    introSrcs.push(s);s.onended=()=>{const i=introSrcs.indexOf(s);if(i>=0)introSrcs.splice(i,1)};guardNarr(b.duration);s.start();
  });
};
/* ---------- Inspiration narration API (used by inspire.js) ---------- */
let inspActive=false;
window.narrationActive=function(){return performance.now()<narrGuard};
window.crowdShout=function(side,strong){say(side,1,{chant:!!strong})};
window.hushDoubters=function(ms){hushUntil=performance.now()+(ms||20000)};
// Plays one narrated quote clip through the voice bus with ambience ducking.
// Resolves true if audio actually played, false otherwise (text-only mode).
window.playInspiration=function(key,vol){
  ensureAudioPrefs();
  initCtx();if(ctx&&ctx.state==="suspended")ctx.resume();
  if(!ctx||!state.audio.master||!state.audio.inspireAudio)return Promise.resolve(false);
  return buf(key).then(b=>{
    if(!b)return false;
    // Queue behind any fan/doubter voice currently speaking, then narrate.
    const wait=Math.max(0,voiceBusyUntil-performance.now());
    return new Promise(res=>{setTimeout(res,wait)}).then(()=>new Promise(res=>{
      const s=ctx.createBufferSource();s.buffer=b;
      const g=ctx.createGain();g.gain.value=vol||1;s.connect(g);g.connect(voiceBus);
      if(ambGain){ambGain.gain.cancelScheduledValues(ctx.currentTime);ambGain.gain.linearRampToValueAtTime(ambLevel()*.35,ctx.currentTime+.1)}
      inspActive=true;guardNarr(b.duration);
      voiceBusyUntil=performance.now()+b.duration*1000+500; // fan/doubter voices wait
      s.onended=()=>{inspActive=false;if(ambGain&&ctx)ambGain.gain.linearRampToValueAtTime(ambLevel(),ctx.currentTime+.8);res(true)};
      s.start();
    }));
  });
};

PREFS.forEach(([id,key])=>{
  const el=document.getElementById(id);if(!el)return;
  el.checked=!!state.audio[key];
  el.onchange=e=>{ensureAudioPrefs();state.audio[key]=e.target.checked;saveState();initCtx();applyPrefs();renderQuickAudio();if(key==="master"&&!state.audio.master&&window.stopIntroAudio)window.stopIntroAudio()};
});
// keep checkboxes in sync when the Manage modal opens
const _openBtns=["navProfile","menuArena"];
_openBtns.forEach(id=>{const el=document.getElementById(id);if(!el)return;const prev=el.onclick;el.onclick=e=>{if(prev)prev(e);ensureAudioPrefs();PREFS.forEach(([pid,key])=>{const c=document.getElementById(pid);if(c)c.checked=!!state.audio[key]})}});

/* ---------- Unlock on first gesture (autoplay policy) ---------- */
function unlock(){initCtx();if(ctx&&ctx.state==="suspended")ctx.resume();applyPrefs()}
["pointerdown","keydown"].forEach(ev=>document.addEventListener(ev,unlock,{once:false,passive:true}));

/* ---------- Game event hooks (wrap app.js globals; mechanics untouched) ---------- */
function crowdOn(){ensureAudioPrefs();return ctx&&state.audio.master&&state.audio.crowd}
const _tone=tone;
tone=function(f,d,type,v,delay){ensureAudioPrefs();if(!state.audio.master||!state.audio.sfx)return;_tone(f,d,type,v,delay)};
const _cheer=cheer;
cheer=function(){
  _cheer();
  buzz(state.ended?[60,50,90]:30); // haptics: separate from audio, honors its own pref only
  if(state.ended){ // final bell — Team Me won: eruption
    if(crowdOn())shot("cheer_big",crowdBus,.9);
    say("fan",1,{chant:true});
    setTimeout(()=>say("fan",.9,{chant:true}),2600);
  }else{ // scored
    if(crowdOn())shot("cheer_small",crowdBus,.4+.4*intensity());
    const combo=state.combo||1;
    say("fan",combo>=2?.75:.5,{chant:combo>=3});
  }
};
const _missSound=missSound;
missSound=function(){
  _missSound();
  buzz(20);
  if(crowdOn())shot("groan",crowdBus,.5,.15);
  say("doubt",state.notme>state.me?.75:.5);
};
const _boo=boo;
boo=function(){
  _boo();
  if(state.ended){ // Team Not Me won the day
    if(crowdOn())shot("jeer",crowdBus,.7,.35);
    say("doubt",1);
    setTimeout(()=>say("doubt",.85),2400);
  }else if(crowdOn())shot("jeer",crowdBus,.45,.35);
};
// occasional idle chatter from either side while playing (rare, cooldown-gated)
setInterval(()=>{
  if(!ctx||state.ended||document.hidden)return;
  if(Math.random()<.22)say(Math.random()<.6?"fan":"doubt",.5);
},20000);
})();
