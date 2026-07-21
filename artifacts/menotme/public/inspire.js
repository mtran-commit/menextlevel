// Contextual Inspiration Engine — deterministic trigger rules, no AI decisions.
// The game engine (state changes) determines the trigger; this file selects an
// eligible quote from that category; crowd-audio.js narrates it (pregenerated
// announcer clips — no runtime TTS). Purely additive: no game mechanics changed.
(function(){
"use strict";
if(window.__mnmInspireInit)return;window.__mnmInspireInit=true;

/* ---------- Quote catalog (ids → text; audio clip = insp_<id>.mp3) ---------- */
const Q={
q01:"Every day starts at zero. What happens next is yours.",
q02:"Yesterday's score is final. Today's game is not.",
q03:"Your streak starts with today.",
q04:"You don't become Team Me Next Level tomorrow. You choose Team Me Next Level today.",
q05:"One decision. One point. One step closer to who you want to become.",
q06:"The Final Bell hasn't rung yet.",
q07:"The score can change with your very next move.",
q08:"If Team Holding Me Back scored, score back.",
q09:"A bad first quarter doesn't decide the final score.",
q10:"You don't need a perfect game. You need one more point than Team Holding Me Back.",
q11:"The comeback starts with the next decision.",
q12:"The game isn't over.",
q13:"Back on the court.",
q14:"Missed the shot? Pick up the paper and shoot again.",
q15:"Take the shot.",
q16:"Keep playing.",
q17:"One more point.",
q18:"The next point is yours to win.",
q19:"This is your comeback.",
q20:"Every time you choose differently, you change the score.",
q21:"Small wins become winning streaks.",
q22:"Build the streak.",
q23:"Finish strong.",
q24:"Make today count.",
q25:"The clock is still running.",
q26:"Your move.",
q27:"One decision can change the game.",
q28:"You didn't just win the game. You showed up for yourself.",
q29:"The person you want to become is built one day at a time.",
q30:"Make today count. Then do it again tomorrow.",
q31:"One day won't define you. What you repeatedly choose might.",
q32:"You can't change yesterday's scoreboard. You can change today's.",
q33:"Your streak ended. Your story didn't.",
q34:"Day One isn't starting over. It's starting stronger.",
q35:"Your next streak starts with your next win.",
q36:"One more win. Your fans are waiting.",
q37:"Seven days isn't luck. It's consistency.",
q38:"One more game. Finish strong.",
q39:"Seven days. Seven victories. Team Me is building something.",
q40:"Give your fans something to cheer about. You just did.",
q41:"The Championship is one victory away.",
q42:"Thirty days started with one decision.",
q43:"The arena is watching. Finish the game.",
q44:"Thirty days. You didn't wait to become Team Me. You chose it every day.",
q45:"Discipline is showing up when motivation stays home.",
q46:"One more victory and your name goes on the Wall.",
q47:"Sixty days of choosing who you want to become.",
q48:"You've come too far to stop playing now.",
q49:"This isn't motivation anymore. This is who you're becoming.",
q50:"Your habits are keeping score. Look at the scoreboard.",
q51:"Don't play against everyone else. Play against yesterday's you.",
q52:"Ninety days started with one decision. One more game remains.",
q53:"The Final Bell is coming. Finish what you started.",
q54:"One more victory. Play for the person you've become.",
q55:"Ninety days ago, you started playing for the person you wanted to become. Look who showed up.",
q56:"You came here to change the score. You changed the player.",
q57:"Team Me Next Level wins more than a game today. Team Me Next Level wins a season.",
q58:"Don't give Team Holding Me Back an easy point.",
q59:"Your habits are keeping score, even when you aren't.",
q60:"One decision can change the direction of the game.",
q61:"Welcome back. The scoreboard is waiting.",
q62:"No explanations needed. Get back on the court.",
q63:"The comeback starts today.",
q64:"Team Me Next Level needs you on the court.",
q65:"Your next level is built in today's decisions.",
q66:"Live your future in your present.",
q67:"Every point for Team Me Next Level is a vote for your future.",
q68:"What holds you back doesn't get the final say.",
q69:"Your future self is watching today's scoreboard.",
q70:"The next level isn't somewhere you arrive. It's something you choose.",
q71:"Today's choices are tomorrow's identity.",
q72:"Play today's game like your future depends on it.",
};

/* ---------- Trigger categories (exact rules from the spec) ---------- */
const CAT={
  newDay:      ["q01","q02","q03","q04","q05","q65","q66","q71"],
  losing:      ["q06","q07","q08","q09","q10","q68","q69"],
  lostLead:    ["q11","q12","q07","q13"],
  misses:      ["q14","q15","q16","q17","q18"],
  comeback:    ["q19","q20","q17","q16"],
  strongLead:  ["q21","q22","q23","q24"],
  bellLosing:  ["q06","q11","q25","q08","q26"],
  bellClose:   ["q27","q17","q18","q23","q26"],
  winDay:      ["q28","q21","q29","q20","q30","q67","q70","q71"],
  loseDay:     ["q02","q31","q11","q32","q13","q72"],
  streakBreak: ["q33","q34","q02","q11","q35"],
  near7:       ["q36","q37","q38"],
  hit7:        ["q39","q40","q21"],
  near30:      ["q41","q42","q43"],
  hit30:       ["q44","q45","q29"],
  near60:      ["q46","q47","q48"],
  hit60:       ["q49","q50","q51"],
  near90:      ["q52","q53","q54"],
  hit90:       ["q55","q56","q57"],
  liability:   ["q58","q59","q60"],
  welcomeBack: ["q61","q62","q63","q64","q66","q68"],
};
const MILESTONE=new Set(["near7","hit7","near30","hit30","near60","hit60","near90","hit90"]); // exempt from daily cap
const HIGH=new Set(["bellLosing","bellClose","winDay","loseDay","streakBreak","near7","hit7","near30","hit30","near60","hit60","near90","hit90"]); // override cooldown

/* ---------- Persistent engine memory ---------- */
const KEY="mnm_inspire_v1";
const today=new Date().toISOString().slice(0,10);
let mem;
try{mem=JSON.parse(localStorage.getItem(KEY))||{}}catch(e){mem={}}
if(mem.day!==today){
  const lastSeen=mem.lastSeen;
  mem={day:today,count:0,lastNarr:0,recent:mem.recent||[],fired:{},lastSeen:today,prevSeen:lastSeen};
}else mem.lastSeen=today;
// Normalize shape defensively — a malformed store must never throw in the engine loop.
if(!Array.isArray(mem.recent))mem.recent=[];
if(!mem.fired||typeof mem.fired!=="object")mem.fired={};
if(typeof mem.count!=="number"||!isFinite(mem.count))mem.count=0;
if(typeof mem.lastNarr!=="number"||!isFinite(mem.lastNarr))mem.lastNarr=0;
function save(){try{localStorage.setItem(KEY,JSON.stringify(mem))}catch(e){}}
save();

/* ---------- Global limits ---------- */
const COOLDOWN=10*60*1000; // 10 min between normal narrated quotes
const DAILY_CAP=3;
function canPlay(cat){
  const milestone=MILESTONE.has(cat),high=HIGH.has(cat);
  if(mem.fired[cat])return false;
  if(!milestone&&mem.count>=DAILY_CAP)return false;
  if(!high&&Date.now()-mem.lastNarr<COOLDOWN)return false;
  return true;
}
function pickQuote(cat){
  const recent=mem.recent||[];
  let pool=CAT[cat].filter(id=>!recent.includes(id));
  if(!pool.length)pool=CAT[cat];
  return pool[Math.floor(Math.random()*pool.length)];
}

/* ---------- Never interrupt: shot flight, intro, commentary, milestone narration ---------- */
let shotBusyUntil=0;
document.addEventListener("pointerdown",e=>{
  const t=e.target;
  if(t&&(t.id==="shoot"||t.id==="paper"||(t.closest&&t.closest("#shoot,#paper"))))shotBusyUntil=Date.now()+1900;
},true);
function blocked(){
  if(Date.now()<shotBusyUntil)return true;
  const p=document.getElementById("paper");
  if(p&&p.dataset.flying)return true;
  if(window.narrationActive&&window.narrationActive())return true;
  return false;
}

/* ---------- Text overlay (visual quote) ---------- */
function prefs(){try{return (typeof state!=="undefined"&&state.audio)||{}}catch(e){return{}}}
function showText(text){
  const a=prefs();
  if(a.inspireText===false)return;
  let el=document.getElementById("inspireQuote");
  if(!el){
    el=document.createElement("div");el.id="inspireQuote";
    (document.getElementById("stage")||document.body).appendChild(el);
  }
  el.textContent="“"+text+"”";
  el.classList.remove("show");void el.offsetWidth;el.classList.add("show");
  clearTimeout(el.__t);el.__t=setTimeout(()=>el.classList.remove("show"),5200);
}

/* ---------- Delivery queue ---------- */
let delivering=false;
function deliver(cat,opts={}){
  if(!canPlay(cat)||delivering)return;
  const a=prefs();
  if(!a.master&&a.inspireText===false)return; // nothing to show or say
  mem.fired[cat]=true;
  const id=pickQuote(cat);
  mem.recent=((mem.recent||[]).concat(id)).slice(-10);
  save();
  delivering=true;
  const start=Date.now();
  (function attempt(){
    if(blocked()&&Date.now()-start<30000)return setTimeout(attempt,700); // queue behind active audio
    showText(Q[id]);
    const p=(a.master&&window.playInspiration)?window.playInspiration("insp_"+id,opts.vol||1):Promise.resolve(false);
    p.then(played=>{
      // The narrated-quote daily cap and cooldown only count quotes that actually narrated.
      if(played){if(!MILESTONE.has(cat))mem.count++;mem.lastNarr=Date.now();save()}
      delivering=false;if(opts.after)try{opts.after()}catch(e){}
    }).catch(()=>{delivering=false});
  })();
}
// Fans occasionally shout instead of the narrator (arena crowd, not narration).
function maybeShoutInstead(){
  if(Math.random()<0.25&&window.crowdShout){window.crowdShout("fan");return true}
  return false;
}

/* ---------- Game-state watcher (poll — app.js mechanics untouched) ---------- */
let prev=null,wasBehind=false,losingQuoted=false,missStreak=0,pendingLosing=0;

// Miss/success tracking via already-wrapped audio hooks (load order: after crowd-audio.js)
const _miss=window.missSound;
window.missSound=function(){_miss.apply(this,arguments);missStreak++;
  if(!state.ended&&missStreak>=2&&!mem.fired.misses&&Math.random()<.6){
    if(!maybeShoutInstead())setTimeout(()=>deliver("misses"),1800);
    else mem.fired.misses=true,save();
  }
};
const _cheer=window.cheer;
window.cheer=function(){_cheer.apply(this,arguments);missStreak=0};

// Liability points: repeated "HAPPENED" liabilities during the day
const _toggle=window.toggleLiability;
if(typeof _toggle==="function")window.toggleLiability=function(i){
  _toggle(i);
  try{
    const happened=state.liabilities.filter(l=>l.addressed&&!l.avoided).length;
    if(happened>=2&&!state.ended)deliver("liability"); // never names the liability
  }catch(e){}
};

function onDayEnd(p){
  const meWon=state.me>state.notme;
  const s=state.streak;
  if(meWon){
    // Final Bell → Result → Crowd Celebration → audio dips → Quote → streak update
    if(s>=90&&!mem.fired.hit90)setTimeout(()=>deliver("hit90"),6500);
    else if(s>=60&&!mem.fired.hit60)setTimeout(()=>deliver("hit60",{after:()=>window.crowdShout&&window.crowdShout("fan",true)}),6500);
    else if(s>=30&&!mem.fired.hit30)setTimeout(()=>deliver("hit30"),6500);
    else if(s>=7&&s<8&&!mem.fired.hit7)setTimeout(()=>deliver("hit7"),6500);
    else setTimeout(()=>deliver("winDay",{after:()=>window.crowdShout&&window.crowdShout("fan",true)}),4200);
    // "one win away" heads-up for tomorrow's milestone
    if(s===6)setTimeout(()=>deliver("near7",{after:()=>window.crowdShout&&window.crowdShout("fan")}),12000);
    else if(s===29)setTimeout(()=>deliver("near30"),12000);
    else if(s===59)setTimeout(()=>deliver("near60"),12000);
    else if(s===89)setTimeout(()=>deliver("near90",{after:()=>window.crowdShout&&window.crowdShout("fan",true)}),12000);
  }else{
    if(window.hushDoubters)window.hushDoubters(25000); // encouraging, never piled on
    const streakBroke=p.streak>1; // streak reset by this loss
    setTimeout(()=>deliver(streakBroke?"streakBreak":"loseDay"),3800); // after Team Not Me reaction + pause
  }
}

setInterval(function(){
  if(typeof state==="undefined"||!state||typeof state.me!=="number")return;
  const cur={me:state.me,notme:state.notme,ended:!!state.ended,streak:state.streak};
  if(!prev){prev=cur;return}

  if(!cur.ended){
    const lead=cur.me-cur.notme;
    // losing-period bookkeeping
    if(lead>=0){losingQuoted=false;pendingLosing=0}
    if(lead<0)wasBehind=true;

    // 3. fell behind after leading (higher priority than plain losing)
    if(prev.me>prev.notme&&cur.notme>cur.me){
      setTimeout(()=>deliver("lostLead"),3000);losingQuoted=true;
    }
    // 2. losing by 2+ — wait 5–10s after the score change, once per losing period
    else if(cur.notme-cur.me>=2&&!losingQuoted){
      if(cur.notme!==prev.notme)pendingLosing=Date.now()+5000+Math.random()*5000;
      else if(!pendingLosing)pendingLosing=Date.now()+5000+Math.random()*5000;
      if(pendingLosing&&Date.now()>=pendingLosing){
        losingQuoted=true;pendingLosing=0;
        if(maybeShoutInstead()){mem.fired.losing=true;save()}
        else deliver("losing");
      }
    }
    // 5. comeback: was losing, now tied or leading
    if(wasBehind&&lead>=0&&(prev.me-prev.notme)<0){
      wasBehind=false;
      deliver("comeback",{after:function(){
        if(window.crowdShout)window.crowdShout("fan",true); // fans surge
        if(window.hushDoubters)window.hushDoubters(30000);  // doubters go quiet
      }});
    }
    // 6. strong lead (3+), once per day
    if(lead>=3&&!mem.fired.strongLead){
      if(maybeShoutInstead()){mem.fired.strongLead=true;save()}
      else deliver("strongLead");
    }
    // 7/8. Final Bell approaching (last hour of the day)
    const mLeft=(function(){const d=new Date(),e=new Date();e.setHours(23,59,59,999);return (e-d)/60000})();
    if(mLeft<60){
      if(lead<0)deliver("bellLosing",{vol:1.05,after:()=>window.crowdShout&&window.crowdShout("fan")}); // more intense delivery + crowd lift
      else if(Math.abs(lead)===1)deliver("bellClose",{vol:1.05});
    }
  }else if(!prev.ended&&cur.ended){
    onDayEnd(prev);
  }
  prev=cur;
},1000);

/* ---------- New day / welcome back (after intro finishes; ~30–40% of days) ---------- */
(function newDayQuote(){
  const gap=mem.prevSeen?Math.round((new Date(today)-new Date(mem.prevSeen))/86400000):0;
  const wantWelcome=gap>=3&&!mem.fired.welcomeBack;
  const wantNewDay=!mem.fired.newDay&&Math.random()<0.35;
  if(!wantWelcome&&!wantNewDay){mem.fired.newDay=true;save();return} // decided once per day
  let tries=0;
  (function wait(){ // after Yesterday's Result + commentator intro + drum rhythm
    if(tries++>120)return;
    if(document.visibilityState==="hidden"||blocked()||typeof state==="undefined")return setTimeout(wait,1000);
    setTimeout(()=>{if(!blocked())deliver(wantWelcome?"welcomeBack":"newDay");},1500);
  })();
  setTimeout(()=>{}, 0);
})();
})();
