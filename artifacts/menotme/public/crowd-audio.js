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

function ensureAudioPrefs(){
  if(!state.audio)state.audio={master:true,crowd:true,fanVoices:true,doubterVoices:true,music:false};
  if(state.audio.gameIntro===undefined)state.audio.gameIntro=true;
}
ensureAudioPrefs();

/* ---------- Asset preload & decode cache ---------- */
const raw={},bufs={};
Object.entries(FILES).forEach(([k,url])=>{raw[k]=fetch(url).then(r=>{if(!r.ok)throw new Error(url);return r.arrayBuffer()}).catch(()=>null)});
let ctx=null,master=null,crowdBus=null,musicBus=null,voiceBus=null;
async function buf(k){
  if(bufs[k])return bufs[k];
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
let voiceBusyUntil=0,cd={fan:0,doubt:0},lastKey={fan:"",doubt:""};
function pick(arr,avoid){let k;do{k=arr[Math.floor(Math.random()*arr.length)]}while(arr.length>1&&k===avoid);return k}
function say(side,chance,opts={}){
  ensureAudioPrefs();const a=state.audio;
  if(!ctx||!a.master||(side==="fan"?!a.fanVoices:!a.doubterVoices))return;
  const now=performance.now();
  const hot=intensity()>0.6;
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
const PREFS=[["prefSoundMaster","master"],["prefCrowdAudio","crowd"],["prefFanVoices","fanVoices"],["prefDoubterVoices","doubterVoices"],["prefMusic","music"],["prefGameIntro","gameIntro"]];

// New-day intro rhythm (TUM-TA-TUM-TUM-TA → cheer + chant). Called from intro.js
// after a user tap, so autoplay policy is satisfied.
window.playIntroSound=function(){
  ensureAudioPrefs();
  initCtx();if(ctx&&ctx.state==="suspended")ctx.resume();
  if(!ctx||!state.audio.master||!state.audio.gameIntro)return;
  shot("intro_rhythm",crowdBus,.95);
};
PREFS.forEach(([id,key])=>{
  const el=document.getElementById(id);if(!el)return;
  el.checked=!!state.audio[key];
  el.onchange=e=>{ensureAudioPrefs();state.audio[key]=e.target.checked;saveState();initCtx();applyPrefs()};
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
tone=function(f,d,type,v,delay){ensureAudioPrefs();if(!state.audio.master)return;_tone(f,d,type,v,delay)};
const _cheer=cheer;
cheer=function(){
  _cheer();
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
