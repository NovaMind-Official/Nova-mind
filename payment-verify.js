/**
 * ============================================================
 * PHRAORTES PAYMENT VERIFICATION — payment-verify.js
 * ============================================================
 * Replaces the fake "wait a few seconds and always succeed"
 * payment flow with a REAL check against the BNB Smart Chain
 * (BEP20), using BscScan's free public API.
 *
 * What this actually checks before activating a plan:
 *   1. The transaction hash (TXID) really exists on-chain
 *   2. It's a USDT (BEP20) transfer — not some random tx
 *   3. It was sent TO your wallet address (not someone else's)
 *   4. The amount is at least what the plan costs
 *   5. This exact TXID hasn't already been used before
 *      (stops someone reusing one real payment for multiple
 *      free activations)
 *
 * WHAT THIS DOES NOT FULLY SOLVE
 * --------------------------------
 * Because this is a static site with no backend, a technically
 * savvy person could still open the browser console and call
 * `activatePlanDirectly()` (or edit localStorage) to fake an
 * activation without paying. There is no way to fully close
 * that hole without a real server. What this DOES fix is the
 * bigger, more important problem: right now literally ANY text
 * typed into the TXID box (even garbage) gets accepted as valid
 * "proof of payment" — meaning even non-technical users could
 * get free plans by accident or on purpose, and you'd have zero
 * real record of who actually paid. This closes that gap for
 * everyone except someone deliberately reverse-engineering your
 * client-side code — which is a much smaller, much less likely
 * group of people than "anyone who notices the box accepts
 * anything."
 *
 * ============================================================
 * SETUP — you need one free API key
 * ============================================================
 * 1. Go to https://bscscan.com/register and make a free account
 * 2. Go to https://bscscan.com/myapikey and create a new API key
 * 3. Paste it below, replacing "YOUR_BSCSCAN_API_KEY_HERE"
 *
 * Free tier limits: 5 calls/second, 100,000 calls/day — more
 * than enough for a project at your current scale.
 * ============================================================
 *
 * INTEGRATION — in index.html:
 *
 * STEP 1 — In <head>, add:
 *   <script src="payment-verify.js"></script>
 *
 * STEP 2 — Find the verifyPayment() function in index.html and
 * replace its body with this (it now calls the real checker):
 *
 *   async function verifyPayment(){
 *     const txid=document.getElementById("pay-txid").value.trim();
 *     if(!txid){showToast("Please enter your Transaction ID","error");return}
 *     const btn=document.getElementById("pay-verify-btn");
 *     btn.disabled=true;btn.classList.add("loading");btn.textContent="Verifying on blockchain...";haptic("double");
 *
 *     const priceText=document.getElementById("pay-plan-price").textContent; // e.g. "$14.99 / month"
 *     const expectedAmount=parseFloat(priceText.replace(/[^0-9.]/g,""));
 *
 *     const result=await verifyBep20Payment(txid, expectedAmount);
 *
 *     if(!result.ok){
 *       btn.disabled=false;btn.classList.remove("loading");btn.textContent="✦ VERIFY PAYMENT & ACTIVATE PLAN";
 *       showToast(result.reason,"error");
 *       return;
 *     }
 *
 *     btn.textContent="Confirming transaction...";
 *     // --- everything below this line is unchanged from your original function ---
 *     const keyMap={"Satrap":"starter","Immortal":"pro","Shahanshah":"ultimate"};
 *     const key=keyMap[pendingPlan];
 *     if(key){activePlan=key;localStorage.setItem("phraortes_plan",activePlan);proSlotsUsed=0;trialCount=0;localStorage.setItem("phraortes_slots","0");localStorage.setItem("phraortes_trial","0");initPlanUI()}
 *     billing.unshift({date:new Date().toLocaleDateString("en-GB"),item:pendingPlan,txid:txid.substring(0,12)+"...",amount:document.getElementById("pay-plan-price").textContent});
 *     localStorage.setItem("phraortes_billing",JSON.stringify(billing));renderBilling();haptic("success");
 *     document.getElementById("pay-form").style.display="none";
 *     const success=document.getElementById("pay-success");success.style.display="flex";
 *     document.getElementById("pay-success-title").textContent="Plan Activated! 🎉";
 *     document.getElementById("pay-success-sub").textContent=`Welcome to ${pendingPlan}. Your features are live right now.`;
 *     document.getElementById("pay-success-badge").textContent=pendingPlan.toUpperCase();
 *     const feats=PLAN_FEATURES[key]||[];
 *     document.getElementById("pay-success-features").innerHTML=feats.map(f=>`<li>${f}</li>`).join("");
 *     showToast(`✅ ${pendingPlan} activated!`,"success");playSound("chime");
 *   }
 * ============================================================
 */

(function () {
  const BSCSCAN_API_KEY = "YOUR_BSCSCAN_API_KEY_HERE"; // <-- put your free key here
  const USDT_BEP20_CONTRACT = "0x55d398326f99059fF775485246999027B3197955"; // official USDT contract on BNB Smart Chain
  const RECEIVE_ADDRESS = "0xdd96c438bdf70ec037b6a51a34348eb85051a6eb"; // your Nobitex BEP20 deposit address
  const AMOUNT_TOLERANCE = 0.03; // allow 3% under the listed price, to absorb minor exchange-rate/fee rounding

  function getUsedTxids() {
    try { return JSON.parse(localStorage.getItem("phraortes_used_txids") || "[]"); }
    catch (e) { return []; }
  }
  function markTxidUsed(txid) {
    const used = getUsedTxids();
    used.push(txid.toLowerCase());
    localStorage.setItem("phraortes_used_txids", JSON.stringify(used.slice(-200))); // keep the list from growing forever
  }

  /**
   * Verifies a BEP20 USDT payment against the real blockchain.
   * Returns { ok: true } or { ok: false, reason: "..." }.
   */
  window.verifyBep20Payment = async function (txid, expectedAmount) {
    if (!txid || !/^0x[a-fA-F0-9]{64}$/.test(txid.trim())) {
      return { ok: false, reason: "That doesn't look like a valid transaction hash. It should start with 0x and be 66 characters long." };
    }
    txid = txid.trim();

    if (getUsedTxids().includes(txid.toLowerCase())) {
      return { ok: false, reason: "This transaction has already been used to activate a plan." };
    }

    if (BSCSCAN_API_KEY === "YOUR_BSCSCAN_API_KEY_HERE") {
      console.error("[Phraortes Payments] No BscScan API key set in payment-verify.js — cannot verify real payments yet.");
      return { ok: false, reason: "Payment verification isn't fully set up yet. Contact support." };
    }

    let data;
    try {
      const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${RECEIVE_ADDRESS}&contractaddress=${USDT_BEP20_CONTRACT}&sort=desc&apikey=${BSCSCAN_API_KEY}`;
      const res = await fetch(url);
      data = await res.json();
    } catch (e) {
      return { ok: false, reason: "Couldn't reach the blockchain verifier right now. Please try again in a moment." };
    }

    if (data.status !== "1" || !Array.isArray(data.result)) {
      return { ok: false, reason: "No transactions found for this wallet yet, or the verifier is temporarily unavailable. Try again shortly." };
    }

    const tx = data.result.find(t => t.hash && t.hash.toLowerCase() === txid.toLowerCase());
    if (!tx) {
      return { ok: false, reason: "Transaction not found yet. If you just sent it, wait a minute for it to confirm and try again." };
    }
    if (tx.to.toLowerCase() !== RECEIVE_ADDRESS.toLowerCase()) {
      return { ok: false, reason: "This transaction wasn't sent to our wallet address." };
    }

    const decimals = parseInt(tx.tokenDecimal || "18", 10);
    const amount = parseFloat(tx.value) / Math.pow(10, decimals);

    if (amount < expectedAmount * (1 - AMOUNT_TOLERANCE)) {
      return { ok: false, reason: `Amount too low: received ${amount.toFixed(2)} USDT, expected about $${expectedAmount}.` };
    }

    markTxidUsed(txid);
    return { ok: true, amount };
  };

  console.log("[Phraortes Payments] Real BEP20 verification ready (make sure your BscScan API key is set).");
})();
