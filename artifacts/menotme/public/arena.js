// Arena layer: dynamic Fans/Doubters signs, crowd reactions, nav & Manage My Arena.
// Relies on globals from app.js: state, saveState, render, selectAsset, $.
(function(){
"use strict";
const FAN_DEFAULTS=n=>["GO "+(n||"CHAMP").toUpperCase()+"!","YOU'VE GOT THIS!","NEXT LEVEL","KEEP GOING!","SO PROUD OF YOU!"];
const DOUBT_SIGNS=["PROVE THEM WRONG","KEEP PLAYING","NOT TODAY","SHOW THEM","STAY FOCUSED"];
const LEFT=["s1","s2","s3","s4","s5"],RIGHT=["d1","d2","d3","d4","d5"];

function ensureArenaState(){
  if(!state.fans)state.fans=[];
  if(!state.doubters)state.doubters=[];
  if(!state.arena)state.arena={showFans:true,showDoubters:true,showSigns:true,reactions:true};
}

function fanFirstName(){
  const f=state.fans[0];
  const sig=(state.signature&&state.signature!=="Team Me Next Level")?state.signature.split(" ")[0]:"";
  return (f&&(f.nickname||f.name))||sig;
}

function renderSigns(){
  ensureArenaState();
  const host=$("signs");if(!host)return;
  host.innerHTML="";
  const a=state.arena;
  if(a.showFans&&a.showSigns){
    const msgs=FAN_DEFAULTS(fanFirstName());
    LEFT.forEach((cls,i)=>{
      const fan=state.fans.length?state.fans[i%state.fans.length]:null;
      const d=document.createElement("div");
      d.className="sign "+cls+" "+(i%2?"dark":"light");
      let txt=msgs[i];
      if(fan&&fan.msg)txt=fan.msg.toUpperCase();
      else if(fan&&i===0)txt="GO "+(fan.nickname||fan.name).toUpperCase()+"!";
      if(fan&&fan.photo){const im=document.createElement("img");im.className="ava";im.alt="";im.src=fan.photo;d.appendChild(im)}
      const s=document.createElement("span");s.textContent=txt;d.appendChild(s);
      if(fan&&(fan.nickname||fan.name)&&!(i===0&&!fan.msg)){const w=document.createElement("span");w.className="who";w.textContent=fan.nickname||fan.name;d.appendChild(w)}
      host.appendChild(d);
    });
  }
  if(a.showDoubters&&a.showSigns){
    RIGHT.forEach((cls,i)=>{
      const d=document.createElement("div");
      d.className="sign "+cls+" doubt";
      const s=document.createElement("span");s.textContent=DOUBT_SIGNS[i];d.appendChild(s);
      host.appendChild(d);
    });
  }
  document.querySelector(".aud-label.fansl").style.display=a.showFans?"":"none";
  document.querySelector(".aud-label.doubl").style.display=a.showDoubters?"":"none";
}
window.renderArena=renderSigns;

/* ---------- Crowd reactions ---------- */
function flashes(n){
  const stage=$("stage");
  for(let i=0;i<n;i++){
    const f=document.createElement("span");f.className="flash";
    const leftSide=Math.random()<.6; // fans side flashes more
    f.style.left=(leftSide?Math.random()*38:60+Math.random()*38)+"%";
    f.style.top=(2+Math.random()*26)+"%";
    f.style.animationDelay=(Math.random()*.5)+"s";
    stage.appendChild(f);setTimeout(()=>f.remove(),1200);
  }
}
window.arenaReact=function(combo){
  ensureArenaState();
  if(!state.arena.reactions)return;
  const signs=[...document.querySelectorAll(".sign.light,.sign.dark")];
  const lifts=Math.min(1+Math.floor((combo||1)/2),3);
  signs.sort(()=>Math.random()-.5).slice(0,lifts).forEach(s=>{
    s.classList.remove("lift");void s.offsetWidth;s.classList.add("lift");
    s.addEventListener("animationend",()=>s.classList.remove("lift"),{once:true});
  });
  flashes(Math.min(3+(combo||1)*2,12));
};
window.arenaCelebrate=function(){
  ensureArenaState();
  if(!state.arena.reactions)return;
  window.arenaReact(6);
  setTimeout(()=>window.arenaReact(6),700);
  setTimeout(()=>window.arenaReact(4),1500);
};

/* ---------- Asset Shot button: select next available asset ---------- */
$("assetShot").onclick=()=>{
  const i=state.assets.findIndex(a=>!a.scored);
  if(i>=0)selectAsset(i);
};

/* ---------- Wall of Fame ---------- */
function openFame(){
  const MILE=[[7,"📸","7 Days Straight — Paparazzi autograph"],[30,"🏆","30 Days — Me Next Level Champion"],[60,"🖼️","60 Days — Me Next Level Wall of Fame"],[90,"🎽","90 Days — Jersey retired"]];
  $("fameList").innerHTML=
    "<p style='margin:4px 0 12px'>Best streak: <b>"+state.best+"</b> days</p>"+
    MILE.map(([d,ic,t])=>"<p style='margin:6px 0;opacity:"+(state.shown[d]?1:.35)+"'>"+ic+" "+t+(state.shown[d]?" — ACHIEVED":"")+"</p>").join("");
  $("fameModal").classList.add("show");
}
$("closeFame").onclick=()=>$("fameModal").classList.remove("show");

/* ---------- Manage My Arena ---------- */
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function renderManage(){
  ensureArenaState();
  $("fanList").innerHTML="";
  state.fans.forEach((f,i)=>{
    const r=document.createElement("div");r.className="fan-row";
    if(f.photo){const im=document.createElement("img");im.src=f.photo;im.alt="";r.appendChild(im)}
    r.insertAdjacentHTML("beforeend","<span>"+esc(f.name)+(f.nickname?" <small>("+esc(f.nickname)+")</small>":"")+"</span>"+(f.msg?"<small>“"+esc(f.msg)+"”</small>":""));
    const x=document.createElement("button");x.className="fx";x.textContent="Remove";
    x.onclick=()=>{state.fans.splice(i,1);saveState();renderManage();renderSigns()};
    r.appendChild(x);$("fanList").appendChild(r);
  });
  if(!state.fans.length)$("fanList").innerHTML="<p class='hint'>No fans yet — add the people in your corner.</p>";
  $("doubterList").innerHTML="";
  state.doubters.forEach((d,i)=>{
    const r=document.createElement("div");r.className="fan-row";
    r.insertAdjacentHTML("beforeend","<span>"+esc(d.name)+"</span>");
    const x=document.createElement("button");x.className="fx";x.textContent="Remove";
    x.onclick=()=>{state.doubters.splice(i,1);saveState();renderManage()};
    r.appendChild(x);$("doubterList").appendChild(r);
  });
  if(!state.doubters.length)$("doubterList").innerHTML="<p class='hint'>No doubters listed.</p>";
  $("prefFans").checked=state.arena.showFans;
  $("prefDoubters").checked=state.arena.showDoubters;
  $("prefSigns").checked=state.arena.showSigns;
  $("prefReactions").checked=state.arena.reactions;
}
function openArena(){renderManage();$("arenaModal").classList.add("show")}
$("closeArena").onclick=()=>$("arenaModal").classList.remove("show");
let pendingPhoto=null;
const PHOTO_BUDGET=300*1024; // total encoded bytes across all fan photos
function photoBytesUsed(){return (state.fans||[]).reduce((n,f)=>n+(f.photo?f.photo.length:0),0)}
// Downscale to a tiny thumbnail so photos stay a few KB each in saved state.
function toThumb(file,cb){
  const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{
    URL.revokeObjectURL(url);
    const S=96,c=document.createElement("canvas");c.width=S;c.height=S;
    const x=c.getContext("2d"),r=Math.max(S/img.width,S/img.height);
    x.drawImage(img,(S-img.width*r)/2,(S-img.height*r)/2,img.width*r,img.height*r);
    cb(c.toDataURL("image/jpeg",.7));
  };
  img.onerror=()=>{URL.revokeObjectURL(url);cb(null)};
  img.src=url;
}
$("fanPhoto").onchange=e=>{
  const f=e.target.files[0];pendingPhoto=null;
  if(!f)return;
  toThumb(f,thumb=>{
    if(!thumb){alert("Could not read that image.");e.target.value="";return}
    if(photoBytesUsed()+thumb.length>PHOTO_BUDGET){alert("Photo storage is full — remove a fan photo first.");e.target.value="";return}
    pendingPhoto=thumb;
  });
};
$("addFan").onclick=()=>{
  const name=$("fanName").value.trim();if(!name)return;
  state.fans.push({name,nickname:$("fanNick").value.trim(),msg:$("fanMsg").value.trim(),photo:pendingPhoto});
  $("fanName").value=$("fanNick").value=$("fanMsg").value="";$("fanPhoto").value="";pendingPhoto=null;
  saveState();renderManage();renderSigns();
};
$("addDoubter").onclick=()=>{
  const name=$("doubterName").value.trim();if(!name)return;
  state.doubters.push({name});$("doubterName").value="";
  saveState();renderManage();
};
[["prefFans","showFans"],["prefDoubters","showDoubters"],["prefSigns","showSigns"],["prefReactions","reactions"]].forEach(([id,key])=>{
  $(id).onchange=e=>{state.arena[key]=e.target.checked;saveState();renderSigns()};
});

/* ---------- Header & nav ---------- */
$("menuBtn").onclick=()=>$("menuModal").classList.add("show");
$("closeMenu").onclick=()=>$("menuModal").classList.remove("show");
$("menuArena").onclick=()=>{$("menuModal").classList.remove("show");openArena()};
$("menuFame").onclick=()=>{$("menuModal").classList.remove("show");openFame()};
$("menuHistory").onclick=()=>{$("menuModal").classList.remove("show");$("historyPanel").classList.add("show")};
$("trophyBtn").onclick=openFame;
$("statsBtn").onclick=()=>$("historyPanel").classList.add("show");
const NAV=["navHome","navFame","navCalendar","navStats","navProfile"];
function setActive(id){NAV.forEach(n=>$(n).classList.toggle("active",n===id))}
$("navHome").onclick=()=>{setActive("navHome");window.scrollTo({top:0,behavior:"smooth"})};
$("navFame").onclick=()=>{setActive("navHome");openFame()};
$("navCalendar").onclick=()=>{setActive("navHome");$("historyPanel").classList.add("show")};
$("navStats").onclick=()=>{setActive("navHome");$("historyPanel").classList.add("show")};
$("navProfile").onclick=()=>{setActive("navHome");openArena()};

ensureArenaState();
renderSigns();
})();
