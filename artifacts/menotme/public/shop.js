/* Me Next Level — Shop Page */
(function(){
"use strict";

// Detect API base from current URL path
const BASE=(()=>{
  const p=location.pathname;
  const idx=p.lastIndexOf("/shop");
  return idx>0?p.slice(0,idx):"";
})();

async function apiFetch(path){
  const res=await fetch(BASE+"/api"+path);
  if(!res.ok)throw new Error("API "+res.status);
  return res.json();
}

// ── Render helpers ────────────────────────────────────────────────────────
function esc(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function fmtPrice(p,cur){return"$"+esc(p)+" "+esc(cur||"AUD")}

function buildCard(product){
  const card=document.createElement("div");
  card.className="shop-card"+(product.soldOut?" sold-out":"");
  const hasImg=!!product.imageUrl;
  const btnLabel=product.soldOut?"SOLD OUT":"ORDER NOW";
  card.innerHTML=`
    <div class="shop-card-img-wrap${hasImg?"":" no-img"}">
      ${hasImg?`<img class="shop-card-img" src="${esc(product.imageUrl)}" alt="${esc(product.name)}" loading="lazy" onerror="this.closest('.shop-card-img-wrap').classList.add('no-img')">`:``}
      <div class="shop-card-placeholder"><span>ME NEXT LEVEL</span></div>
      ${product.soldOut?`<div class="shop-card-sold-badge">SOLD OUT</div>`:""}
    </div>
    <div class="shop-card-body">
      <div class="shop-card-name">${esc(product.name)}</div>
      <div class="shop-card-price">${fmtPrice(product.price,product.currency)}</div>
      <p class="shop-card-desc">${esc(product.shortDescription)}</p>
      <button class="shop-card-btn${product.soldOut?" shop-card-btn-soldout":""}" type="button"${product.soldOut?' disabled':''}>
        ${btnLabel}
      </button>
    </div>`;
  if(!product.soldOut){
    card.querySelector(".shop-card-img-wrap").onclick=()=>openModal(product);
    card.querySelector(".shop-card-name").onclick=()=>openModal(product);
    card.querySelector(".shop-card-btn").onclick=(e)=>{e.stopPropagation();openModal(product)};
  }
  return card;
}

// ── Modal ─────────────────────────────────────────────────────────────────
let qty=1;let currentProduct=null;

function openModal(product){
  currentProduct=product;qty=1;
  document.getElementById("shopQtyNum").textContent="1";
  document.getElementById("shopModalName").textContent=product.name;
  document.getElementById("shopModalPrice").textContent=fmtPrice(product.price,product.currency);
  document.getElementById("shopModalDesc").textContent=product.description||product.shortDescription||"";

  const imgWrap=document.getElementById("shopModalImgWrap");
  const img=document.getElementById("shopModalImg");
  const imgPh=document.getElementById("shopModalImgPh");
  if(product.imageUrl){
    img.src=product.imageUrl;img.alt=product.name;
    img.style.display="block";imgPh.style.display="none";
  }else{
    img.style.display="none";imgPh.style.display="flex";
  }

  const incl=document.getElementById("shopModalIncluded");
  if(product.whatsIncluded&&product.whatsIncluded.trim()){
    const lines=product.whatsIncluded.split("\n").filter(l=>l.trim());
    incl.innerHTML=`<div class="shop-modal-included-title">WHAT'S INCLUDED</div>`+
      lines.map(l=>`<div class="shop-include-item"><span class="shop-include-check">✓</span><span>${esc(l.trim())}</span></div>`).join("");
    incl.style.display="block";
  }else{
    incl.style.display="none";
  }

  // Reset button state
  const btn=document.getElementById("shopOrderBtn");
  btn.disabled=false;
  btn.textContent="ORDER NOW";

  document.getElementById("shopModal").classList.add("show");
  document.body.style.overflow="hidden";
}

function closeModal(){
  document.getElementById("shopModal").classList.remove("show");
  document.body.style.overflow="";
}

// ── Checkout ──────────────────────────────────────────────────────────────
async function startCheckout(){
  if(!currentProduct)return;

  const btn=document.getElementById("shopOrderBtn");
  btn.disabled=true;
  btn.textContent="PROCESSING…";

  try{
    const res=await fetch(BASE+"/api/shop/create-checkout-session",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({productId:currentProduct.id,quantity:qty}),
    });

    if(!res.ok){
      let msg="Checkout failed. Please try again.";
      try{const err=await res.json();msg=err.error||msg;}catch(e){}
      throw new Error(msg);
    }

    const data=await res.json();
    if(!data.url)throw new Error("No checkout URL returned from server.");

    // Redirect to Stripe Checkout hosted page
    window.location.href=data.url;
  }catch(err){
    btn.disabled=false;
    btn.textContent="ORDER NOW";
    alert("Something went wrong:\n\n"+err.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init(){
  const grid=document.getElementById("shopGrid");

  // Bind modal controls
  document.getElementById("shopModalClose").onclick=closeModal;
  document.getElementById("shopModal").onclick=e=>{if(e.target===document.getElementById("shopModal"))closeModal()};
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
  document.getElementById("shopQtyDown").onclick=()=>{if(qty>1){qty--;document.getElementById("shopQtyNum").textContent=qty}};
  document.getElementById("shopQtyUp").onclick=()=>{if(qty<10){qty++;document.getElementById("shopQtyNum").textContent=qty}};
  document.getElementById("shopOrderBtn").onclick=startCheckout;

  // Load products
  try{
    const data=await apiFetch("/products");
    const products=data.products||[];
    grid.innerHTML="";
    if(!products.length){
      grid.innerHTML='<div class="shop-empty">New kits dropping soon.<br>Check back.</div>';
      return;
    }
    products.forEach(p=>grid.appendChild(buildCard(p)));
  }catch(err){
    grid.innerHTML='<div class="shop-empty">Unable to load products right now.<br>Please try again shortly.</div>';
  }
}

document.addEventListener("DOMContentLoaded",init);
})();
