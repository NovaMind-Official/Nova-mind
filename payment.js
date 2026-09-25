/**
 * ============================================================
 * PHRAORTES PAYMENT FLOW — payment.js
 * ============================================================
 * The full payment UI flow: opening the payment modal, QR/address
 * display, and verifying a transaction.
 *
 * IMPORTANT — WHERE THE REAL SECURITY LIVES
 * --------------------------------------------
 * This file does NOT verify payments itself. It calls two endpoints
 * on the Cloudflare Worker:
 *   POST /api/verify-payment   (subscription plans)
 *   POST /api/verify-topup     (one-time extra-slot purchases)
 * Those endpoints do the real work server-side: checking the
 * transaction actually exists on BNB Smart Chain via BscScan, that
 * it was sent to the right address, for the right amount, and that
 * the same transaction hash hasn't already been used — then issue a
 * signed (HMAC) license token that the Worker verifies on every
 * /api/chat call. See index.js for that logic.
 *
 * This file only does two things worth calling out:
 *   1. A quick client-side format check on the tx hash BEFORE
 *      spending a network round-trip on something that's obviously
 *      not a real transaction hash (defense in depth — the server
 *      re-validates this regardless, so this is purely a fast-fail
 *      for UX, not something to rely on for security).
 *   2. Storing the signed license token the server returns, which
 *      is the actual proof of a verified plan — never trust
     *      anything else (like a plain "activePlan" string) as proof.
 *
 * v2: drawQR() now renders a real scannable QR; Notification API guarded for iPhone Safari.
 *
 * LOAD ORDER — this file can load anywhere after the DOM elements it
 * references exist (i.e. in <head>, since it only defines functions
 * that get called later via onclick, not code that runs immediately
 * except the two constants below).
 * ============================================================
 */

let billing=[];try{billing=JSON.parse(localStorage.getItem("phraortes_billing")||"[]")}catch(e){billing=[]}

const PLAN_PRICE_DATA={
  Satrap:{monthly:14.99,annual:10.49,annualTotal:125.88},
  Immortal:{monthly:49.99,annual:34.99,annualTotal:419.88},
  Shahanshah:{monthly:119.99,annual:83.99,annualTotal:1007.88}
};

const TOPUP_PACKS={
  slots50:{label:"+50 Extra Slots",price:2.99,slots:50},
  slots200:{label:"+200 Extra Slots",price:8.99,slots:200}
};

const PLAN_FEATURES={
  starter:["100 Advanced Reasoning Slots / month","30 HD Image Renders","Access to our core intelligence engine","Unlimited Standard Compute"],
  pro:["350 Premium Slots / month","120 Ultra-HD Studio Renders","Unlocks the senior developer-grade engine","API + Webhook access"],
  ultimate:["Truly Unlimited — Every Engine","Unlimited Commercial Artworks","Aura Live Voice Sessions","Priority support & early access"]
};

let pendingTopupKey=null;
let _payLoadingTick=null; // tracked so closePayment() can cancel it

// A real BEP20 transaction hash is always "0x" + 64 hex characters. Anything else can be
// rejected instantly client-side — no point spending a network call on it. The server enforces
// this exact same pattern too, so this is a UX fast-fail only, never the actual security check.
const TXID_PATTERN=/^0x[a-fA-F0-9]{64}$/;

function openPayment(planName,fallbackPrice){
  pendingPlan=planName;
  pendingTopupKey=null; // a regular plan purchase always clears any stale top-up intent
  const pd=PLAN_PRICE_DATA[planName];
  const priceText=pd?(isAnnual?pd.annualTotal:pd.monthly).toFixed(2):fallbackPrice;
  const periodText=pd?(isAnnual?" / year":" / month"):" / one-time";
  document.getElementById("pay-plan-name").textContent=planName;
  document.getElementById("pay-plan-price").textContent="$"+priceText+periodText;
  document.getElementById("pay-loading").style.display="flex";
  document.getElementById("pay-form").style.display="none";
  document.getElementById("pay-success").style.display="none";
  document.getElementById("pay-txid").value="";
  const vBtn=document.getElementById("pay-verify-btn");
  vBtn.disabled=false;vBtn.classList.remove("loading");vBtn.textContent="✦ VERIFY PAYMENT & ACTIVATE PLAN";
  document.getElementById("payment-overlay").classList.add("show");
  const fill=document.getElementById("pay-progress"),sub=document.getElementById("pay-load-sub-text");
  const steps=[{p:25,t:"Loading payment options..."},{p:55,t:"Preparing wallet addresses..."},{p:85,t:"Generating QR code..."},{p:100,t:"Ready"}];
  let i=0;fill.style.width="0%";
  clearInterval(_payLoadingTick);
  const tick=_payLoadingTick=setInterval(()=>{if(i>=steps.length){clearInterval(tick);setTimeout(()=>{document.getElementById("pay-loading").style.display="none";document.getElementById("pay-form").style.display="flex";updatePayNet()},500);return}fill.style.width=steps[i].p+"%";if(sub)sub.textContent=steps[i].t;i++},420);
}
function closePayment(){clearInterval(_payLoadingTick);document.getElementById("payment-overlay").classList.remove("show")}
function openTopupPayment(packKey){
  const pack=TOPUP_PACKS[packKey];if(!pack)return;
  if(activePlan==="free"){showToast("Extra Slots require the Satrap plan or above.","error");openPremium();return}
  if(activePlan==="ultimate"){showToast("Shahanshah already has unlimited usage — no top-up needed.","error");return}
  openPayment(pack.label,pack.price.toFixed(2));
  pendingTopupKey=packKey; // set AFTER openPayment, which clears it by default
}
function updatePayNet(){const net=document.getElementById("pay-net").value;const addr=WALLETS[net]||WALLETS.bep20;document.getElementById("pay-address").value=addr;drawQR(addr)}
function drawQR(text){
  // Real, scannable QR (qrcode-generator is already loaded in <head>). The previous version
  // painted a random-looking pattern seeded from the address — it looked like a QR but no
  // wallet could scan it.
  const canvas=document.getElementById("qr-canvas");if(!canvas)return;
  const css=parseInt(canvas.getAttribute("width"),10)||130,dpr=Math.min(3,window.devicePixelRatio||1);
  canvas.style.width=css+"px";canvas.style.height=css+"px";canvas.width=canvas.height=Math.round(css*dpr); // crisp modules on retina
  const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
  const size=canvas.width;
  ctx.fillStyle="#fff";ctx.fillRect(0,0,size,size);
  if(typeof qrcode==="undefined"||!text){
    ctx.fillStyle="#1a1a2e";ctx.font=Math.round(11*dpr)+"px sans-serif";ctx.textAlign="center";
    ctx.fillText("Copy the address below",size/2,size/2);return;
  }
  try{
    const qr=qrcode(0,"M");qr.addData(text);qr.make();
    const n=qr.getModuleCount(),quiet=2,cell=Math.floor(size/(n+quiet*2));
    const off=Math.floor((size-cell*n)/2);
    ctx.fillStyle="#1a1a2e";
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){if(qr.isDark(r,c))ctx.fillRect(off+c*cell,off+r*cell,cell,cell)}
  }catch(e){
    ctx.fillStyle="#1a1a2e";ctx.font=Math.round(11*dpr)+"px sans-serif";ctx.textAlign="center";
    ctx.fillText("Copy the address below",size/2,size/2);
  }
}
function copyAddress(){const addr=document.getElementById("pay-address").value;navigator.clipboard.writeText(addr).then(()=>showToast("Wallet address copied! 📋","success"))}

async function verifyPayment(){
  const txid=document.getElementById("pay-txid").value.trim();
  if(!txid){showToast("Please enter your Transaction ID","error");return}
  if(!TXID_PATTERN.test(txid)){
    showToast("That doesn't look like a valid transaction hash — it should start with 0x and be 66 characters long.","error");
    haptic("error");
    return;
  }
  const btn=document.getElementById("pay-verify-btn");
  btn.disabled=true;btn.classList.add("loading");btn.textContent="Verifying on blockchain...";haptic("double");

  if(pendingTopupKey){
    const pack=TOPUP_PACKS[pendingTopupKey];
    let result;
    try{
      const r=await fetchWithTimeout(WORKER_BASE_URL+"/api/verify-topup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({txHash:txid,pack:pendingTopupKey})},12000);
      result=await r.json();
    }catch(e){
      btn.disabled=false;btn.classList.remove("loading");btn.textContent="✦ VERIFY PAYMENT & ACTIVATE PLAN";
      showToast("Couldn't reach the verification server — check your connection.","error");haptic("error");
      return;
    }
    if(!result.ok){
      btn.disabled=false;btn.classList.remove("loading");btn.textContent="✦ VERIFY PAYMENT & ACTIVATE PLAN";
      showToast(result.reason||"Verification failed.","error");haptic("error");
      return;
    }
    extraSlots+=result.slots||0;localStorage.setItem("phraortes_extra_slots",String(extraSlots));
    updatePlanCTAs();
    billing.unshift({date:new Date().toLocaleDateString("en-GB"),item:pack?.label||"Extra Slots",txid:txid.substring(0,12)+"...",amount:document.getElementById("pay-plan-price").textContent});
    localStorage.setItem("phraortes_billing",JSON.stringify(billing));renderBilling();haptic("success");
    document.getElementById("pay-form").style.display="none";
    const success=document.getElementById("pay-success");success.style.display="flex";
    document.getElementById("pay-success-title").textContent="Slots Added! ⚡";
    document.getElementById("pay-success-sub").textContent=`+${result.slots} extra slots were added to your account instantly.`;
    document.getElementById("pay-success-badge").textContent="TOP-UP";
    document.getElementById("pay-success-features").innerHTML="";
    showToast(`✅ +${result.slots} slots added!`,"success");playSound("chime");
    pendingTopupKey=null;
    return;
  }

  const keyMap={"Satrap":"starter","Immortal":"pro","Shahanshah":"ultimate"};
  const key=keyMap[pendingPlan];
  const pd=PLAN_PRICE_DATA[pendingPlan];
  if(!key){btn.disabled=false;btn.classList.remove("loading");btn.textContent="✦ VERIFY PAYMENT & ACTIVATE PLAN";showToast("Unknown plan.","error");return}
  let result;
  try{
    const r=await fetchWithTimeout(WORKER_BASE_URL+"/api/verify-payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({txHash:txid,plan:key,isAnnual:!!isAnnual,expectedAmount:pd?(isAnnual?pd.annualTotal:pd.monthly):null})},12000);
    result=await r.json();
  }catch(e){
    btn.disabled=false;btn.classList.remove("loading");btn.textContent="✦ VERIFY PAYMENT & ACTIVATE PLAN";
    showToast("Couldn't reach the verification server — check your connection.","error");haptic("error");
    return;
  }
  if(!result.ok){
    btn.disabled=false;btn.classList.remove("loading");btn.textContent="✦ VERIFY PAYMENT & ACTIVATE PLAN";
    showToast(result.reason||"Verification failed.","error");haptic("error");
    return;
  }
  btn.textContent="Confirming transaction...";
  // Server verified the on-chain payment and signed a license token — this, not localStorage,
  // is now the real proof of plan. The worker checks its signature on every /api/chat call.
  localStorage.setItem("phraortes_license",result.token);
  activePlan=key;localStorage.setItem("phraortes_plan",activePlan);proSlotsUsed=0;trialCount=0;localStorage.setItem("phraortes_slots","0");localStorage.setItem("phraortes_trial","0");initPlanUI();
  billing.unshift({date:new Date().toLocaleDateString("en-GB"),item:pendingPlan,txid:txid.substring(0,12)+"...",amount:document.getElementById("pay-plan-price").textContent});
  localStorage.setItem("phraortes_billing",JSON.stringify(billing));renderBilling();haptic("success");
  document.getElementById("pay-form").style.display="none";
  const success=document.getElementById("pay-success");success.style.display="flex";
  document.getElementById("pay-success-title").textContent="Plan Activated! 🎉";
  document.getElementById("pay-success-sub").textContent=`Welcome to ${pendingPlan}. Your features are live right now.`;
  document.getElementById("pay-success-badge").textContent=pendingPlan.toUpperCase();
  const feats=PLAN_FEATURES[key]||[];
  document.getElementById("pay-success-features").innerHTML=feats.map(f=>`<li>${f}</li>`).join("");
  // `Notification` does not exist on iPhone Safari outside an installed web app — referencing it
  // would throw and skip the success toast/sound below, so guard it.
  // Ask for notification permission a couple of seconds after showing the success screen, not in the
  // same instant — a payment confirmation is the wrong moment to also interrupt with an OS permission
  // prompt. If Notification isn't supported (iPhone Safari outside an installed PWA), this just no-ops.
  setTimeout(()=>{
    try{
      if(typeof Notification==="undefined")return;
      if(Notification.permission==="granted"){new Notification("✅ Phraortes Plan Activated",{body:`${pendingPlan} is now active!`,icon:"icon-192.png"})}
      else if(Notification.permission!=="denied"){Notification.requestPermission().then(p=>{if(p==="granted")new Notification("✅ Phraortes Plan Activated",{body:`${pendingPlan} is now active!`,icon:"icon-192.png"})})}
    }catch(e){}
  },2500);
  showToast(`✅ ${pendingPlan} activated!`,"success");playSound("chime");
}

function renderBilling(){
  const list=document.getElementById("billing-scroll");if(!list)return;
  if(!billing.length){list.innerHTML=`<div style="text-align:center;padding:20px 0;color:#444;font-size:13px">No invoices yet</div>`;return}
  const e=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  list.innerHTML=billing.map(b=>`<div class="billing-item"><div><div class="billing-plan">${e(b.item)}</div><div class="billing-tx">TX: ${e(b.txid)}</div></div><div class="billing-date">${e(b.date)}</div></div>`).join("");
}
