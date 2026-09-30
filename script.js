const DB_KEY = "nexapay_db_v1";
const SESSION_KEY = "nexapay_session_v1";
const DEMO_PASSWORD = "NexaPayDemo2026";

const defaultDB = {
  users: [{
    id: "u_demo",
    name: "Demo Student",
    username: "student",
    password: DEMO_PASSWORD,
    pin: "1234",
    balance: 2350,
    savingsGoals: [],
    demoHoldings: [],
    inbox: [],
    transactions: [{
      id: "TX-DEMO-001",
      type: "credit",
      title: "Initial wallet balance",
      detail: "Demo account",
      amount: 2350,
      date: new Date().toISOString()
    }]
  }]
};

function loadDB(){
  try{
    const stored=JSON.parse(localStorage.getItem(DB_KEY)||"null");
    if(stored&&Array.isArray(stored.users)){
      const demoUser=stored.users.find(u=>u.id==="u_demo"&&u.username==="student");
      if(demoUser?.password==="1234"){
        demoUser.password=DEMO_PASSWORD;
        try{localStorage.setItem(DB_KEY,JSON.stringify(stored));}catch{}
      }
      return stored;
    }
  }catch{}
  return JSON.parse(JSON.stringify(defaultDB));
}
let db = loadDB();
let currentUserId = localStorage.getItem(SESSION_KEY);
let pendingAction = null;
let pinReturnFocus = null;
let receiptReturnFocus = null;
let balanceHidden = false;
let inactivityTimer = null;
let inboxFilter = "all";
const MAX_TRANSACTION_AMOUNT = 1_000_000;
const OUTGOING_LIMITS = {perTransaction:10_000,daily:25_000,monthly:100_000};
const DEMO_BILLERS = {
  "Electricity":["Meralco"],
  "Water":["Maynilad","Manila Water"],
  "Internet":["PLDT","Converge","Globe At Home"],
  "Telecom":["Globe Postpaid","Smart Postpaid"],
  "Credit card":["BDO Credit Card","BPI Credit Card"],
  "Government":["SSS","Pag-IBIG","PhilHealth"],
  "School":["School Fees"]
};

function saveDB(){ localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function saveSession(){ currentUserId ? localStorage.setItem(SESSION_KEY,currentUserId) : localStorage.removeItem(SESSION_KEY); }
function user(){ return db.users.find(u=>u.id===currentUserId); }
function peso(n){ return new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP"}).format(Number(n)||0); }
function roundMoney(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function renderBalances(u){
  const display=balanceHidden?"••••••":peso(u.balance);
  document.getElementById("dashBalance").textContent=display;
  document.getElementById("sendBalance").textContent=display;
  document.getElementById("withdrawBalance").textContent=display;
  document.getElementById("loadBalance").textContent=display;
  document.getElementById("billBalance").textContent=display;
  document.getElementById("bankBalance").textContent=display;
  document.getElementById("profileBalance").textContent=display;
  document.getElementById("growWalletBalance").textContent=display;
}
function ensureGrowData(u=user()){
  if(!u)return null;
  let changed=false;
  if(!Array.isArray(u.savingsGoals)){u.savingsGoals=[];changed=true;}
  if(!Array.isArray(u.demoHoldings)){u.demoHoldings=[];changed=true;}
  if(changed)saveDB();
  return u;
}
function ensureInboxData(u=user()){
  if(!u)return null;
  let changed=false;
  if(!Array.isArray(u.inbox)){u.inbox=[];changed=true;}
  if(u.inboxWelcomeAdded!==true){
    u.inbox.unshift({id:uid("M"),title:"Welcome to your inbox",body:"Wallet and Grow activity updates will appear here. Messages are stored locally in this demo.",category:"account",date:now(),read:false});
    u.inboxWelcomeAdded=true;changed=true;
  }
  if(changed)saveDB();
  return u;
}
function addInboxMessage(title,body,category="wallet",recipient=user()){
  if(!recipient)return;
  ensureInboxData(recipient);
  recipient.inbox.unshift({id:uid("M"),title,body,category,date:now(),read:false});
  if(recipient.inbox.length>100)recipient.inbox.length=100;
}
function localDayKey(date){
  return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
}
function localMonthKey(date){return date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0");}
function sumOutgoing(transactions,period,key){
  return roundMoney(transactions.reduce((sum,tx)=>{
    const limitedOutgoing=tx.type==="debit"&&(tx.title==="Cash withdrawal"||tx.title==="Bank transfer"||/^Sent to @/.test(tx.title));
    if(!limitedOutgoing)return sum;
    const date=new Date(tx.date);
    const txKey=Number.isNaN(date.getTime())?"":period==="day"?localDayKey(date):localMonthKey(date);
    return txKey===key?sum+(Number(tx.amount)||0):sum;
  },0));
}
function ensureLimitUsage(u){
  const today=new Date(),dayKey=localDayKey(today),monthKey=localMonthKey(today);
  if(!u.limitUsage||typeof u.limitUsage!=="object")u.limitUsage={};
  let changed=false;
  if(u.limitUsage.dayKey!==dayKey||!Number.isFinite(Number(u.limitUsage.daily))){
    u.limitUsage.dayKey=dayKey;u.limitUsage.daily=sumOutgoing(u.transactions,"day",dayKey);changed=true;
  }
  if(u.limitUsage.monthKey!==monthKey||!Number.isFinite(Number(u.limitUsage.monthly))){
    u.limitUsage.monthKey=monthKey;u.limitUsage.monthly=sumOutgoing(u.transactions,"month",monthKey);changed=true;
  }
  if(changed)saveDB();
  return u.limitUsage;
}
function checkOutgoingLimits(amount){
  const usage=ensureLimitUsage(user());
  const dailyUsed=Number(usage.daily)||0,monthlyUsed=Number(usage.monthly)||0;
  if(amount>OUTGOING_LIMITS.perTransaction){toast("That is above the per-transaction demo limit of "+peso(OUTGOING_LIMITS.perTransaction)+".",true);return false;}
  if(dailyUsed+amount>OUTGOING_LIMITS.daily){toast("That would exceed today’s outgoing demo limit of "+peso(OUTGOING_LIMITS.daily)+".",true);return false;}
  if(monthlyUsed+amount>OUTGOING_LIMITS.monthly){toast("That would exceed this month’s outgoing demo limit of "+peso(OUTGOING_LIMITS.monthly)+".",true);return false;}
  return true;
}
function recordOutgoingUsage(amount){
  const usage=ensureLimitUsage(user());
  usage.daily=roundMoney((Number(usage.daily)||0)+amount);
  usage.monthly=roundMoney((Number(usage.monthly)||0)+amount);
}
function renderLimitUsage(u){
  const usage=ensureLimitUsage(u);
  document.getElementById("perTransactionLimit").textContent=peso(OUTGOING_LIMITS.perTransaction);
  document.getElementById("dailyLimitAmount").textContent=peso(OUTGOING_LIMITS.daily);
  document.getElementById("monthlyLimitAmount").textContent=peso(OUTGOING_LIMITS.monthly);
  const rows=[
    {used:usage.daily,limit:OUTGOING_LIMITS.daily,bar:"dailyLimitBar",copy:"dailyLimitUsage",remaining:" today"},
    {used:usage.monthly,limit:OUTGOING_LIMITS.monthly,bar:"monthlyLimitBar",copy:"monthlyLimitUsage",remaining:" this month"}
  ];
  rows.forEach(row=>{
    const bar=document.getElementById(row.bar),used=Math.max(0,Number(row.used)||0),shown=Math.min(used,row.limit);
    bar.querySelector("span").style.width=Math.min(100,shown/row.limit*100)+"%";
    bar.setAttribute("aria-valuemax",String(row.limit));
    bar.setAttribute("aria-valuenow",String(shown));
    bar.setAttribute("aria-valuetext",peso(used)+" used of "+peso(row.limit));
    document.getElementById(row.copy).textContent=peso(used)+" used · "+peso(Math.max(0,row.limit-used))+" remaining"+row.remaining;
  });
  const todayRemaining=peso(Math.max(0,OUTGOING_LIMITS.daily-(Number(usage.daily)||0)));
  const monthRemaining=peso(Math.max(0,OUTGOING_LIMITS.monthly-(Number(usage.monthly)||0)));
  const limitCopy="Demo limit: up to "+peso(OUTGOING_LIMITS.perTransaction)+" per transaction · "+todayRemaining+" left today · "+monthRemaining+" left this month.";
  document.getElementById("sendLimitNote").textContent=limitCopy;
  document.getElementById("withdrawLimitNote").textContent=limitCopy;
  document.getElementById("bankLimitNote").textContent=limitCopy;
}
function setBalanceHidden(hidden){
  balanceHidden=hidden;
  const button=document.getElementById("toggleBalance");
  const label=hidden?"Show wallet balances":"Hide wallet balances";
  button.classList.toggle("balance-hidden",hidden);
  button.setAttribute("aria-pressed",String(hidden));
  button.setAttribute("aria-label",label);
  button.title=label;
  const current=user();
  if(current){renderBalances(current);renderMonthlySummary(current);renderGrow(current);}
}
function amountFromField(id){
  const input=document.getElementById(id), amount=Number(input.value);
  if(!input.value.trim() || !Number.isFinite(amount) || amount<1){toast("Enter an amount of at least ₱1.00.",true);return null;}
  if(amount>MAX_TRANSACTION_AMOUNT){toast("The maximum demo transaction is ₱1,000,000.00.",true);return null;}
  return roundMoney(amount);
}
function passwordIsStrong(password){
  return password.length>=8&&password.length<=72&&/[A-Za-z]/.test(password)&&/[0-9]/.test(password);
}
function updatePasswordGuidance(inputId="regPassword"){
  const input=document.getElementById(inputId),password=input.value;
  const checks={length:password.length>=8&&password.length<=72,letter:/[A-Za-z]/.test(password),number:/[0-9]/.test(password)};
  document.querySelectorAll(`[data-password-guidance-for="${inputId}"] [data-password-rule]`).forEach(rule=>{
    const met=checks[rule.dataset.passwordRule];
    rule.classList.toggle("met",met);
    rule.querySelector("i").textContent=met?"✓":"○";
  });
  input.setCustomValidity(password&&!passwordIsStrong(password)?"Use 8–72 characters and include at least one letter and one number.":"");
}
function now(){ return new Date().toISOString(); }
function uid(prefix="U"){ return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6).toUpperCase(); }
function initials(name){ return (name||"U").split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase(); }

function toast(msg,error=false){
  const el=document.createElement("div"); el.className="toast"+(error?" error":""); el.textContent=msg;
  document.getElementById("toast").appendChild(el); setTimeout(()=>el.remove(),3000);
}

function switchAuth(mode){
  document.querySelectorAll(".tab").forEach(b=>{
    const selected=b.dataset.auth===mode;
    b.classList.toggle("active",selected);
    b.setAttribute("aria-selected",String(selected));
  });
  document.getElementById("loginForm").classList.toggle("hidden",mode!=="login");
  document.getElementById("registerForm").classList.toggle("hidden",mode!=="register");
  document.getElementById("authHeading").textContent=mode==="login"?"Good to have you here":"Create your wallet";
  document.getElementById("authSubheading").textContent=mode==="login"?"Sign in or create an account to get started.":"Set up your NexaPay demo account in a few quick steps.";
  const skipLink=document.getElementById("skipLink");
  skipLink.href=mode==="login"?"#loginUsername":"#regName";
  skipLink.textContent=mode==="login"?"Skip to sign in":"Skip to create account";
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>switchAuth(b.dataset.auth));
document.getElementById("regPassword").addEventListener("input",updatePasswordGuidance);
document.getElementById("newPassword").addEventListener("input",()=>updatePasswordGuidance("newPassword"));
document.getElementById("confirmNewPassword").addEventListener("input",e=>e.target.setCustomValidity(""));
document.getElementById("confirmWalletPin").addEventListener("input",e=>e.target.setCustomValidity(""));

document.getElementById("loginForm").onsubmit=e=>{
  e.preventDefault();
  const username=document.getElementById("loginUsername").value.trim().toLowerCase();
  const password=document.getElementById("loginPassword").value;
  const found=db.users.find(u=>u.username.toLowerCase()===username && u.password===password);
  if(!found) return toast("Invalid username or password.",true);
  currentUserId=found.id; saveSession(); showApp(); toast("Welcome back, "+found.name+"!");
};

document.getElementById("registerForm").onsubmit=e=>{
  e.preventDefault();
  const name=document.getElementById("regName").value.trim();
  const username=document.getElementById("regUsername").value.trim().toLowerCase();
  const password=document.getElementById("regPassword").value;
  const pin=document.getElementById("regPin").value;
  if(!name) return toast("Enter your full name.",true);
  if(!passwordIsStrong(password)){
    const passwordInput=document.getElementById("regPassword");
    passwordInput.setCustomValidity("Use 8–72 characters and include at least one letter and one number.");
    passwordInput.reportValidity();
    passwordInput.focus();
    return;
  }
  if(!/^[a-z0-9_]+$/.test(username)) return toast("Username can only use letters, numbers and underscore.",true);
  if(db.users.some(u=>u.username===username)) return toast("That username is already registered.",true);
  if(!/^\d{4}$/.test(pin)) return toast("PIN must be exactly 4 digits.",true);
  const newUser={id:uid("U"),name,username,password,pin,balance:0,savingsGoals:[],demoHoldings:[],inbox:[],transactions:[]};
  db.users.push(newUser); saveDB(); currentUserId=newUser.id; saveSession(); showApp();
  toast("Account created successfully!");
  e.target.reset();
  updatePasswordGuidance();
};

function showApp(){
  const activeUser=user();
  balanceHidden=Boolean(user()?.preferences?.hideBalanceByDefault);
  setBalanceHidden(balanceHidden);
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  const skipLink=document.getElementById("skipLink");
  skipLink.href="#mainContent";
  skipLink.textContent="Skip to main content";
  updateUI();
  const startPage=activeUser?.preferences?.startPage;
  showPage(["dashboard","transactions","grow"].includes(startPage)?startPage:"dashboard");
  resetInactivityTimer();
  document.getElementById("mainContent").focus();
}
function logout(){
  clearTimeout(inactivityTimer);inactivityTimer=null;
  document.title="NexaPay — Digital Wallet";
  currentUserId=null; saveSession(); document.getElementById("appScreen").classList.add("hidden");
  document.getElementById("authScreen").classList.remove("hidden"); switchAuth("login");
  document.getElementById("loginForm").reset();
  document.getElementById("registerForm").reset();
  updatePasswordGuidance();
  document.getElementById("profileSettingsForm").reset();
  document.getElementById("appPreferencesForm").reset();
  document.getElementById("sessionSettingsForm").reset();
  document.getElementById("passwordSettingsForm").reset();
  document.getElementById("pinSettingsForm").reset();
  document.getElementById("hideBalanceDefault").checked=false;
  document.getElementById("transactionSuccessAlerts").checked=true;
  document.getElementById("confirmNewPassword").setCustomValidity("");
  document.getElementById("confirmWalletPin").setCustomValidity("");
  updatePasswordGuidance("newPassword");
  ["addAmount","sendRecipient","sendAmount","withdrawAmount","loadPhone","loadAmount","billAccount","billAmount","bankAccountName","bankAccountNumber","bankAmount","growGoalName","growGoalTarget","growInvestmentAmount","confirmPin"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("loadNetwork").value="Globe";
  document.getElementById("billCategory").value="Electricity";
  document.getElementById("bankName").selectedIndex=0;
  updateBillers();
  document.getElementById("pinModal").classList.add("hidden");
  document.getElementById("receiptModal").classList.add("hidden");
  document.getElementById("transactionSearch").value="";
  document.getElementById("transactionFilter").value="all";
  clearAmountSelection();
  clearLoadSelection();
  inboxFilter="all";
  pendingAction=null; pinReturnFocus=null; receiptReturnFocus=null;
  balanceHidden=false;
  setBalanceHidden(false);
  document.getElementById("loginUsername").focus();
}
function resetInactivityTimer(){
  clearTimeout(inactivityTimer);inactivityTimer=null;
  const activeUser=user();
  if(!activeUser||document.getElementById("appScreen").classList.contains("hidden"))return;
  const minutes=Number(activeUser.preferences?.autoLogoutMinutes)||0;
  if(![5,15,30].includes(minutes))return;
  inactivityTimer=setTimeout(()=>{
    if(user()?.id!==activeUser.id)return;
    logout();
    toast("Signed out after "+minutes+" minutes without activity.");
  },minutes*60*1000);
}
document.getElementById("logoutBtn").onclick=logout;

function showPage(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  document.getElementById("page-"+page).classList.remove("hidden");
  const morePages=["inbox","load","bills","bank","withdraw","grow","transactions","profile","settings","terms"];
  document.querySelectorAll(".nav-item").forEach(n=>{
    const active=n.dataset.page===page||(n.dataset.page==="more"&&morePages.includes(page));
    n.classList.toggle("active",active);
    if(active)n.setAttribute("aria-current","page");else n.removeAttribute("aria-current");
  });
  const titles={dashboard:"Dashboard",add:"Add Money",load:"Buy Load",bills:"Pay Bills",bank:"Bank Transfer",send:"Send Money",withdraw:"Withdraw",inbox:"Inbox",grow:"Grow",qr:"My QR",transactions:"Transactions",profile:"My Profile",settings:"Settings",terms:"Terms & Conditions",more:"More"};
  document.getElementById("pageTitle").textContent=titles[page];
  document.title=titles[page]+" · NexaPay";
  if(page==="qr") generateQR();
  if(page==="transactions") renderTransactions();
  if(page==="settings") renderSettings();
  if(page==="inbox") renderInbox();
  if(page==="grow") renderGrow();
}
document.querySelectorAll(".nav-item").forEach(n=>n.onclick=()=>showPage(n.dataset.page));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>showPage(b.dataset.go));
document.querySelectorAll("[data-inbox-filter]").forEach(button=>button.onclick=()=>{
  inboxFilter=button.dataset.inboxFilter;
  renderInbox();
});
document.getElementById("markAllRead").onclick=()=>{
  const u=ensureInboxData();
  u.inbox.forEach(message=>message.read=true);
  saveDB();renderInbox();
};
document.getElementById("inboxList").addEventListener("click",e=>{
  const button=e.target.closest('[data-inbox-action="toggle-read"]');
  if(!button)return;
  const u=ensureInboxData(),message=u.inbox.find(item=>item.id===button.dataset.inboxId);
  if(!message)return toast("That inbox message is no longer available.",true);
  message.read=!message.read;saveDB();renderInbox();
});
document.addEventListener("pointerdown",resetInactivityTimer,{passive:true});
document.addEventListener("keydown",resetInactivityTimer);
document.addEventListener("scroll",resetInactivityTimer,{passive:true});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)resetInactivityTimer();});
document.getElementById("toggleBalance").onclick=()=>setBalanceHidden(!balanceHidden);
document.getElementById("transactionSearch").addEventListener("input",renderTransactions);
document.getElementById("transactionFilter").addEventListener("change",renderTransactions);
document.getElementById("profileSettingsForm").onsubmit=e=>{
  e.preventDefault();
  const name=document.getElementById("settingsName").value.trim();
  if(!name)return toast("Enter your full name.",true);
  user().name=name;saveDB();updateUI();
  document.getElementById("profileSaveStatus").textContent="Your profile name has been updated.";
  toast("Profile updated.");
};
document.getElementById("hideBalanceDefault").onchange=e=>{
  const u=user();u.preferences={...(u.preferences||{}),hideBalanceByDefault:e.target.checked};
  saveDB();setBalanceHidden(e.target.checked);
  toast(e.target.checked?"Balances will be hidden by default.":"Balances will be shown by default.");
};
document.getElementById("appPreferencesForm").onsubmit=e=>{
  e.preventDefault();
  const startPage=document.getElementById("defaultStartPage").value;
  if(!["dashboard","transactions","grow"].includes(startPage))return toast("Choose a valid start page.",true);
  const u=user();
  u.preferences={...(u.preferences||{}),startPage,transactionSuccessAlerts:document.getElementById("transactionSuccessAlerts").checked};
  saveDB();
  document.getElementById("appPreferencesStatus").textContent="Your app preferences have been saved.";
  toast("App preferences saved.");
};
document.getElementById("sessionSettingsForm").onsubmit=e=>{
  e.preventDefault();
  const minutes=Number(document.getElementById("autoLogoutMinutes").value);
  if(![0,5,15,30].includes(minutes))return toast("Choose a valid sign-out interval.",true);
  const u=user();
  u.preferences={...(u.preferences||{}),autoLogoutMinutes:minutes};
  saveDB();resetInactivityTimer();
  document.getElementById("sessionSettingsStatus").textContent=minutes?"Auto sign-out will run after "+minutes+" minutes of inactivity.":"Automatic sign-out is off.";
  toast("Session setting saved.");
};
document.getElementById("passwordSettingsForm").onsubmit=e=>{
  e.preventDefault();
  const u=user(),current=document.getElementById("currentPassword").value;
  const next=document.getElementById("newPassword").value,confirmation=document.getElementById("confirmNewPassword");
  if(current!==u.password)return toast("Your current password is incorrect.",true);
  if(!passwordIsStrong(next))return toast("Use 8–72 characters with at least one letter and one number.",true);
  if(next===current)return toast("Choose a new password that is different from your current one.",true);
  if(next!==confirmation.value){confirmation.setCustomValidity("Your passwords do not match.");confirmation.reportValidity();confirmation.focus();return;}
  confirmation.setCustomValidity("");u.password=next;saveDB();e.target.reset();updatePasswordGuidance("newPassword");
  document.getElementById("passwordSaveStatus").textContent="Your password has been updated.";
  if(u.id==="u_demo")document.getElementById("demoPasswordHint").textContent=next;
  toast("Password updated.");
};
document.getElementById("pinSettingsForm").onsubmit=e=>{
  e.preventDefault();
  const u=user(),current=document.getElementById("currentWalletPin").value;
  const next=document.getElementById("newWalletPin").value,confirmation=document.getElementById("confirmWalletPin");
  if(current!==u.pin)return toast("Your current wallet PIN is incorrect.",true);
  if(!/^\d{4}$/.test(next))return toast("Your new PIN must contain exactly 4 digits.",true);
  if(next===current)return toast("Choose a PIN that is different from your current one.",true);
  if(next!==confirmation.value){confirmation.setCustomValidity("Your PINs do not match.");confirmation.reportValidity();confirmation.focus();return;}
  confirmation.setCustomValidity("");u.pin=next;saveDB();e.target.reset();
  document.getElementById("pinSaveStatus").textContent="Your wallet PIN has been updated.";
  if(u.id==="u_demo")document.getElementById("demoPinHint").textContent=next;
  toast("Wallet PIN updated.");
};

function updateUI(){
  const u=user(); if(!u) return;
  ensureGrowData(u);
  ensureInboxData(u);
  const ini=initials(u.name);
  document.getElementById("sideName").textContent=u.name;
  document.getElementById("sideUsername").textContent="@"+u.username;
  document.getElementById("topName").textContent=u.name;
  document.getElementById("avatar").textContent=ini;
  document.getElementById("topAvatar").textContent=ini;
  document.getElementById("profileAvatar").textContent=ini;
  document.getElementById("profileName").textContent=u.name;
  document.getElementById("profileUsername").textContent="@"+u.username;
  document.getElementById("greetingName").textContent=u.name.trim().split(/\s+/)[0]||"there";
  renderBalances(u);
  renderMonthlySummary(u);
  document.getElementById("profileCount").textContent=u.transactions.length;
  renderRecent();
  renderTransactions();
  renderLimitUsage(u);
  renderGrow(u);
  renderInbox(u);
}
function renderSettings(){
  const u=user(); if(!u)return;
  const preferences=u.preferences||{};
  document.getElementById("settingsName").value=u.name;
  document.getElementById("hideBalanceDefault").checked=Boolean(u.preferences?.hideBalanceByDefault);
  document.getElementById("profileSettingsForm").reset();
  document.getElementById("settingsName").value=u.name;
  document.getElementById("appPreferencesForm").reset();
  document.getElementById("defaultStartPage").value=["dashboard","transactions","grow"].includes(preferences.startPage)?preferences.startPage:"dashboard";
  document.getElementById("transactionSuccessAlerts").checked=preferences.transactionSuccessAlerts!==false;
  document.getElementById("sessionSettingsForm").reset();
  document.getElementById("autoLogoutMinutes").value=[0,5,15,30].includes(Number(preferences.autoLogoutMinutes))?String(Number(preferences.autoLogoutMinutes)):"0";
  document.getElementById("passwordSettingsForm").reset();
  document.getElementById("pinSettingsForm").reset();
  document.getElementById("confirmNewPassword").setCustomValidity("");
  document.getElementById("confirmWalletPin").setCustomValidity("");
  updatePasswordGuidance("newPassword");
  document.querySelectorAll(".settings-status").forEach(status=>status.textContent="");
}
function renderInbox(u=user()){
  if(!u)return;
  ensureInboxData(u);
  const messages=u.inbox.slice().sort((a,b)=>{
    const aDate=new Date(a.date).getTime()||0,bDate=new Date(b.date).getTime()||0;
    return bDate-aDate;
  });
  const unreadCount=messages.filter(message=>!message.read).length;
  const badgeText=unreadCount>99?"99+":String(unreadCount);
  const navBadge=document.getElementById("navInboxBadge"),topBadge=document.getElementById("topInboxBadge"),moreBadge=document.getElementById("moreInboxBadge");
  [navBadge,topBadge,moreBadge].forEach(badge=>{
    badge.textContent=badgeText;
    badge.classList.toggle("hidden",unreadCount===0);
  });
  const inboxLabel=unreadCount?"Inbox, "+unreadCount+" unread "+(unreadCount===1?"message":"messages"):"Inbox, no unread messages";
  document.querySelector('[data-page="inbox"]').setAttribute("aria-label",inboxLabel);
  document.getElementById("inboxShortcut").setAttribute("aria-label",inboxLabel);
  document.getElementById("inboxShortcut").title=unreadCount?unreadCount+" unread messages":"Inbox";
  moreBadge.setAttribute("aria-label",unreadCount+" unread "+(unreadCount===1?"message":"messages"));
  document.getElementById("inboxSummary").textContent=messages.length
    ?unreadCount+" unread · "+messages.length+" total "+(messages.length===1?"message":"messages")
    :"Your latest wallet updates appear here.";
  document.getElementById("markAllRead").disabled=unreadCount===0;
  document.querySelectorAll("[data-inbox-filter]").forEach(button=>{
    const selected=button.dataset.inboxFilter===inboxFilter;
    button.classList.toggle("active",selected);
    button.setAttribute("aria-pressed",String(selected));
  });
  const visible=messages.filter(message=>{
    if(inboxFilter==="unread")return!message.read;
    return inboxFilter==="all"||message.category===inboxFilter;
  });
  const list=document.getElementById("inboxList");
  if(!visible.length){
    const copy=inboxFilter==="unread"?"You’re all caught up.":messages.length?"There are no messages in this section yet.":"No messages yet. Wallet updates will appear here.";
    list.innerHTML=`<div class="inbox-empty"><span aria-hidden="true">✉</span><b>${escapeHTML(copy)}</b><small>Messages from this demo stay in your browser.</small></div>`;
    return;
  }
  const categoryNames={wallet:"Wallet",grow:"Grow",account:"Account"};
  const icons={wallet:"↻",grow:"✦",account:"i"};
  list.innerHTML=visible.map(message=>{
    const category=categoryNames[message.category]?message.category:"account";
    const title=escapeHTML(message.title||"Wallet update"),body=escapeHTML(message.body||"");
    const date=new Date(message.date),dateLabel=Number.isNaN(date.getTime())?"Date unavailable":date.toLocaleString("en-PH");
    const id=escapeHTML(message.id),read=Boolean(message.read);
    return `<article class="inbox-message ${read?"":"unread"}"><span class="inbox-message-icon ${category}-message-icon" aria-hidden="true">${icons[category]}</span><div class="inbox-message-copy"><div class="inbox-message-title"><b>${title}</b><span class="inbox-category ${category}">${categoryNames[category]}</span>${read?"":"<span class='inbox-new'>NEW</span>"}</div><p>${body}</p><time datetime="${escapeHTML(message.date||"")}">${escapeHTML(dateLabel)}</time></div><button class="inbox-read-button" type="button" data-inbox-action="toggle-read" data-inbox-id="${id}" aria-label="Mark ${read?"unread":"read"}: ${title}">${read?"Mark unread":"Mark read"}</button></article>`;
  }).join("");
}
function renderRecent(){
  const box=document.getElementById("recentTransactions"); const u=user();
  if(!u.transactions.length){box.innerHTML='<p class="muted">No transactions yet.</p>';return;}
  box.innerHTML=u.transactions.slice().reverse().slice(0,5).map(tx=>txHTML(tx)).join("");
}
function renderMonthlySummary(u){
  const currentDate=new Date();
  const monthTransactions=u.transactions.filter(tx=>{
    const date=new Date(tx.date);
    return!Number.isNaN(date.getTime())&&date.getFullYear()===currentDate.getFullYear()&&date.getMonth()===currentDate.getMonth();
  });
  const credits=monthTransactions.filter(tx=>tx.type==="credit");
  const debits=monthTransactions.filter(tx=>tx.type==="debit");
  const total=items=>roundMoney(items.reduce((sum,tx)=>sum+(Number(tx.amount)||0),0));
  document.getElementById("monthLabel").textContent=currentDate.toLocaleDateString("en-PH",{month:"short",year:"numeric"});
  document.getElementById("monthInCount").textContent=credits.length+` ${credits.length===1?"credit":"credits"}`;
  document.getElementById("monthOutCount").textContent=debits.length+` ${debits.length===1?"debit":"debits"}`;
  document.getElementById("monthIn").textContent=balanceHidden?"••••••":peso(total(credits));
  document.getElementById("monthOut").textContent=balanceHidden?"••••••":peso(total(debits));
  renderWeeklyActivity(u.transactions);
}
function renderGrow(u=user()){
  if(!u)return;
  ensureGrowData(u);
  const hidden=balanceHidden;
  const showAmount=value=>hidden?"••••••":peso(value);
  const savingsTotal=roundMoney(u.savingsGoals.reduce((sum,goal)=>sum+(Number(goal.saved)||0),0));
  const investedTotal=roundMoney(u.demoHoldings.reduce((sum,holding)=>sum+(Number(holding.amount)||0),0));
  document.getElementById("growSavingsTotal").textContent=showAmount(savingsTotal);
  document.getElementById("growInvestedTotal").textContent=showAmount(investedTotal);
  document.getElementById("growWalletAvailable").textContent=showAmount(u.balance);
  document.getElementById("growWalletBalance").textContent=showAmount(u.balance);

  const goalsList=document.getElementById("growGoalsList");
  if(!u.savingsGoals.length){
    goalsList.innerHTML='<div class="grow-empty"><span aria-hidden="true">◎</span><b>Your first goal starts here</b><small>Create a goal above to start tracking your demo savings.</small></div>';
  }else{
    goalsList.innerHTML=u.savingsGoals.map(goal=>{
      const saved=Math.max(0,Number(goal.saved)||0),target=Math.max(1,Number(goal.target)||1);
      const progress=hidden?12:Math.min(100,saved/target*100);
      const progressText=hidden?"Amounts hidden":peso(saved)+" of "+peso(target);
      const goalId=escapeHTML(goal.id),goalName=escapeHTML(goal.name||"Savings goal");
      return `<article class="grow-goal"><div class="grow-goal-heading"><div><b>${goalName}</b><small>Target ${showAmount(target)}</small></div><strong>${showAmount(saved)}</strong></div><div class="grow-meter" role="progressbar" aria-label="Progress for ${goalName}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${hidden?0:Math.round(progress)}" aria-valuetext="${escapeHTML(progressText)}"><span style="width:${progress}%"></span></div><div class="grow-goal-controls"><label class="sr-only" for="grow-amount-${goalId}">Amount for ${goalName}</label><input id="grow-amount-${goalId}" data-grow-amount="${goalId}" type="number" min="1" max="1000000" step="0.01" inputmode="decimal" placeholder="Amount"><button type="button" class="grow-action-button" data-grow-action="deposit" data-goal-id="${goalId}" aria-label="Add money to ${goalName}">Add</button><button type="button" class="grow-action-button subtle" data-grow-action="withdraw" data-goal-id="${goalId}" aria-label="Take money out of ${goalName}">Take out</button></div></article>`;
    }).join("");
  }

  const holdingsList=document.getElementById("growHoldingsList");
  if(!u.demoHoldings.length){
    holdingsList.innerHTML='<div class="grow-empty compact"><span aria-hidden="true">↗</span><b>No paper positions yet</b><small>Choose a demo product above to try one.</small></div>';
  }else{
    holdingsList.innerHTML=u.demoHoldings.slice().reverse().map(holding=>{
      const id=escapeHTML(holding.id),product=escapeHTML(holding.product||"Demo position"),amount=roundMoney(holding.amount);
      return `<article class="grow-holding"><span class="holding-mark" aria-hidden="true">↗</span><span class="holding-copy"><b>${product}</b><small>Paper position · no price movement</small></span><strong>${showAmount(amount)}</strong><button type="button" class="grow-sell-button" data-grow-action="sell" data-holding-id="${id}" aria-label="Close ${product} position at contributed value">Close</button></article>`;
    }).join("");
  }
}
function renderWeeklyActivity(transactions){
  const today=new Date(),start=new Date(today.getFullYear(),today.getMonth(),today.getDate()-6);
  const days=Array.from({length:7},(_,index)=>{
    const date=new Date(start);date.setDate(start.getDate()+index);
    return{date,key:localDayKey(date),incoming:0,outgoing:0};
  });
  const byDay=new Map(days.map(day=>[day.key,day]));
  transactions.forEach(tx=>{
    const date=new Date(tx.date),day=Number.isNaN(date.getTime())?null:byDay.get(localDayKey(date));
    if(!day)return;
    const amount=Number(tx.amount)||0;
    if(tx.type==="credit")day.incoming+=amount;
    else if(tx.type==="debit")day.outgoing+=amount;
  });
  days.forEach(day=>{day.incoming=roundMoney(day.incoming);day.outgoing=roundMoney(day.outgoing);});
  const maxDaily=Math.max(0,...days.map(day=>day.incoming+day.outgoing));
  const activeDays=days.filter(day=>day.incoming||day.outgoing);
  const chart=document.getElementById("weeklyActivityChart");
  const dayName=day=>day.date.toLocaleDateString("en-PH",{weekday:"short"});
  if(balanceHidden){
    chart.setAttribute("aria-label",activeDays.length?"Wallet activity recorded on "+activeDays.map(dayName).join(", ")+" in the last seven days. Amounts are hidden.":"No wallet activity in the last seven days.");
  }else{
    const summary=days.map(day=>dayName(day)+": "+peso(day.incoming)+" in, "+peso(day.outgoing)+" out").join("; ");
    chart.setAttribute("aria-label","Wallet activity for the last seven days. "+summary);
  }
  chart.querySelector(".activity-bars").innerHTML=days.map(day=>{
    const incoming=balanceHidden?(day.incoming?30:0):(maxDaily?Math.max(3,day.incoming/maxDaily*82):0);
    const outgoing=balanceHidden?(day.outgoing?30:0):(maxDaily?Math.max(3,day.outgoing/maxDaily*82):0);
    const bars=(day.incoming?`<i class="activity-segment activity-in" style="height:${incoming}%"></i>`:"")+
      (day.outgoing?`<i class="activity-segment activity-out" style="height:${outgoing}%"></i>`:"");
    return `<div class="activity-day"><span class="activity-track">${bars}</span><small>${dayName(day)}</small></div>`;
  }).join("");
}
function txHTML(tx){
  const positive=tx.type==="credit"; return `<div class="tx">
    <div class="tx-icon">${positive?"↓":"↑"}</div>
    <div class="tx-info"><b>${escapeHTML(tx.title)}</b><small>${escapeHTML(tx.detail)}</small></div>
    <div class="tx-amount ${positive?"plus":"minus"}">${positive?"+":"-"}${peso(tx.amount)}</div>
  </div>`;
}
function filteredTransactions(){
  const u=user();
  const query=document.getElementById("transactionSearch").value.trim().toLowerCase();
  const filter=document.getElementById("transactionFilter").value;
  return u.transactions.slice().reverse().filter(tx=>{
    const date=new Date(tx.date).toLocaleString();
    const searchable=[tx.title,tx.detail,tx.type,String(tx.amount),peso(tx.amount),date].join(" ").toLowerCase();
    return(filter==="all"||tx.type===filter)&&(!query||searchable.includes(query));
  });
}
function renderTransactions(){
  const body=document.getElementById("transactionTable"), u=user(), matches=filteredTransactions();
  const resultCount=document.getElementById("transactionResultCount");
  const countLabel=count=>`${count} ${count===1?"transaction":"transactions"}`;
  resultCount.textContent=matches.length===u.transactions.length?countLabel(matches.length):`Showing ${countLabel(matches.length)} of ${countLabel(u.transactions.length)}`;
  if(!matches.length){
    const message=u.transactions.length?"No transactions match your search.":"No transactions yet.";
    body.innerHTML=`<tr><td colspan="4" class="muted">${message}</td></tr>`;return;
  }
  body.innerHTML=matches.map(tx=>`<tr>
    <td>${tx.type==="credit"?"<span class='plus'>CREDIT</span>":"<span class='minus'>DEBIT</span>"}</td>
    <td><b>${escapeHTML(tx.title)}</b><br><small>${escapeHTML(tx.detail)}</small></td>
    <td class="${tx.type==="credit"?"plus":"minus"}">${tx.type==="credit"?"+":"-"}${peso(tx.amount)}</td>
    <td>${new Date(tx.date).toLocaleString()}</td>
  </tr>`).join("");
}
function csvCell(value){
  let cell=String(value??"");
  if(/^[\s]*[=+\-@]/.test(cell))cell="'"+cell;
  return '"'+cell.replace(/"/g,'""')+'"';
}
document.getElementById("exportTransactions").onclick=()=>{
  const u=user(),transactions=filteredTransactions();
  if(!transactions.length)return toast("There are no transactions to export.",true);
  const rows=[["Transaction ID","Type","Description","Details","Amount (PHP)","Date (ISO 8601)"],...transactions.map(tx=>[
    tx.id,tx.type,tx.title,tx.detail,roundMoney(tx.amount),Number.isNaN(new Date(tx.date).getTime())?"":new Date(tx.date).toISOString()
  ])];
  const csv="\uFEFF"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link=document.createElement("a");
  link.href=url;link.download="nexapay-activity-"+u.username+"-"+localDayKey(new Date())+".csv";
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast("Transaction file downloaded.");
};
function addTx(type,title,detail,amount){
  user().transactions.push({id:uid("TX"),type,title,detail,amount,date:now()});
  const category=/savings goal|paper portfolio|paper position/i.test(title)?"grow":"wallet";
  addInboxMessage(title,peso(amount)+(type==="credit"?" credited to your wallet":" debited from your wallet")+(detail?" · "+detail:""),category);
}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function clearAmountSelection(){
  document.querySelectorAll(".amounts button").forEach(b=>{
    b.classList.remove("selected");
    b.setAttribute("aria-pressed","false");
  });
}
function clearLoadSelection(){
  document.querySelectorAll(".load-offers button").forEach(b=>b.setAttribute("aria-pressed","false"));
}
function updateBillers(){
  const category=document.getElementById("billCategory").value;
  const biller=document.getElementById("billBiller");
  biller.innerHTML=(DEMO_BILLERS[category]||[]).map(name=>`<option value="${name}">${name}</option>`).join("");
}
document.querySelectorAll(".amounts button").forEach(b=>b.onclick=()=>{
  document.getElementById("addAmount").value=b.dataset.amount;
  document.querySelectorAll(".amounts button").forEach(option=>{
    const selected=option===b;
    option.classList.toggle("selected",selected);
    option.setAttribute("aria-pressed",String(selected));
  });
});
document.getElementById("addAmount").addEventListener("input",clearAmountSelection);
document.getElementById("addMoneyBtn").onclick=()=>{
  const amount=amountFromField("addAmount");
  if(amount===null) return;
  pendingAction={kind:"add",amount};
  openPin("Add "+peso(amount)+" to your wallet?");
};
document.querySelectorAll(".load-offers button").forEach(button=>button.onclick=()=>{
  document.querySelectorAll(".load-offers button").forEach(option=>option.setAttribute("aria-pressed",String(option===button)));
  document.getElementById("loadAmount").value=button.dataset.loadAmount;
});
document.getElementById("loadAmount").addEventListener("input",clearLoadSelection);
document.getElementById("billCategory").addEventListener("change",updateBillers);
updateBillers();
document.getElementById("buyLoadBtn").onclick=()=>{
  const phone=document.getElementById("loadPhone").value.trim();
  if(!/^09\d{9}$/.test(phone))return toast("Enter a valid 11-digit Philippine mobile number starting with 09.",true);
  const amount=amountFromField("loadAmount");
  if(amount===null)return;
  if(!Number.isInteger(Number(document.getElementById("loadAmount").value)))return toast("Enter the load amount in whole pesos.",true);
  if(amount>user().balance)return toast("Insufficient balance.",true);
  pendingAction={kind:"buyLoad",amount,phone,network:document.getElementById("loadNetwork").value};
  openPin(`Buy ${peso(amount)} ${pendingAction.network} load for ${phone}?`);
};
document.getElementById("payBillBtn").onclick=()=>{
  const biller=document.getElementById("billBiller").value;
  const reference=document.getElementById("billAccount").value.trim();
  if(!reference)return toast("Enter the account or reference number from your bill.",true);
  const amount=amountFromField("billAmount");
  if(amount===null)return;
  if(amount>user().balance)return toast("Insufficient balance.",true);
  pendingAction={kind:"payBill",amount,biller,reference};
  openPin(`Pay ${peso(amount)} to ${biller} for reference ${reference}?`);
};
document.getElementById("bankTransferBtn").onclick=()=>{
  const bank=document.getElementById("bankName").value;
  const accountName=document.getElementById("bankAccountName").value.trim();
  const accountNumber=document.getElementById("bankAccountNumber").value.trim();
  if(!accountName)return toast("Enter the name on the destination account.",true);
  if(!/^\d{6,24}$/.test(accountNumber))return toast("Enter a 6–24 digit demo account number.",true);
  const amount=amountFromField("bankAmount");
  if(amount===null)return;
  if(amount>user().balance)return toast("Insufficient balance.",true);
  if(!checkOutgoingLimits(amount))return;
  pendingAction={kind:"bankTransfer",amount,bank,accountName,accountNumber};
  openPin(`Transfer ${peso(amount)} to ${bank}, ${accountName}, account ending ${accountNumber.slice(-4)}?`);
};
document.getElementById("sendMoneyBtn").onclick=()=>{
  const recipient=document.getElementById("sendRecipient").value.trim().replace(/^@/,"").toLowerCase();
  if(!recipient) return toast("Enter the recipient username.",true);
  const u=user();
  const target=db.users.find(x=>x.username===recipient);
  if(!target) return toast("Recipient does not exist.",true);
  if(target.id===u.id) return toast("You cannot send money to yourself.",true);
  const amount=amountFromField("sendAmount");
  if(amount===null) return;
  if(amount>u.balance) return toast("Insufficient balance.",true);
  if(!checkOutgoingLimits(amount)) return;
  pendingAction={kind:"send",amount,targetId:target.id};
  openPin(`Send ${peso(amount)} to @${target.username}?`);
};
document.getElementById("withdrawBtn").onclick=()=>{
  const amount=amountFromField("withdrawAmount");
  if(amount===null) return;
  if(amount>user().balance) return toast("Insufficient balance.",true);
  if(!checkOutgoingLimits(amount)) return;
  pendingAction={kind:"withdraw",amount};
  openPin("Withdraw "+peso(amount)+" from your wallet?");
};

document.getElementById("growGoalForm").onsubmit=e=>{
  e.preventDefault();
  const name=document.getElementById("growGoalName").value.trim();
  if(!name)return toast("Give your savings goal a name.",true);
  const target=amountFromField("growGoalTarget");
  if(target===null)return;
  const u=ensureGrowData();
  u.savingsGoals.unshift({id:uid("G"),name:name.slice(0,40),target,saved:0,createdAt:now()});
  saveDB();e.target.reset();updateUI();toast("Savings goal created.");
};
document.getElementById("growGoalsList").addEventListener("click",e=>{
  const button=e.target.closest("[data-grow-action]");
  if(!button)return;
  const u=ensureGrowData(),goal=u.savingsGoals.find(item=>item.id===button.dataset.goalId);
  if(!goal)return toast("That savings goal is no longer available.",true);
  const amountInput=[...document.querySelectorAll("[data-grow-amount]")].find(input=>input.dataset.growAmount===goal.id);
  if(button.dataset.growAction==="deposit"){
    const amount=amountFromInput(amountInput);
    if(amount===null)return;
    if(amount>u.balance)return toast("Insufficient wallet balance.",true);
    pendingAction={kind:"growDeposit",goalId:goal.id,amount};
    openPin("Move "+peso(amount)+" into “"+goal.name+"”?");
  }else if(button.dataset.growAction==="withdraw"){
    const amount=amountFromInput(amountInput);
    if(amount===null)return;
    if(amount>Number(goal.saved||0))return toast("That goal does not have enough saved yet.",true);
    pendingAction={kind:"growWithdraw",goalId:goal.id,amount};
    openPin("Move "+peso(amount)+" from “"+goal.name+"” back to your wallet?");
  }
});
document.getElementById("growInvestmentForm").onsubmit=e=>{
  e.preventDefault();
  const amount=amountFromField("growInvestmentAmount");
  if(amount===null)return;
  if(amount>user().balance)return toast("Insufficient wallet balance.",true);
  const product=document.getElementById("growProduct").value;
  const allowedProducts=["GFunds demo fund","GBonds demo bond","GStocks PH demo shares","GCrypto demo basket"];
  if(!allowedProducts.includes(product))return toast("Choose a demo product.",true);
  pendingAction={kind:"growInvest",amount,product};
  openPin("Add "+peso(amount)+" to your "+product.toLowerCase()+" paper position?");
};
document.getElementById("growHoldingsList").addEventListener("click",e=>{
  const button=e.target.closest('[data-grow-action="sell"]');
  if(!button)return;
  const holding=ensureGrowData().demoHoldings.find(item=>item.id===button.dataset.holdingId);
  if(!holding)return toast("That paper position is no longer available.",true);
  pendingAction={kind:"growSell",holdingId:holding.id,amount:roundMoney(holding.amount)};
  openPin("Return "+peso(holding.amount)+" to your wallet by closing this paper position?");
});
function amountFromInput(input){
  if(!input)return null;
  const amount=Number(input.value);
  if(!input.value.trim()||!Number.isFinite(amount)||amount<1){toast("Enter an amount of at least ₱1.00.",true);return null;}
  if(amount>MAX_TRANSACTION_AMOUNT){toast("The maximum demo transaction is ₱1,000,000.00.",true);return null;}
  return roundMoney(amount);
}

function openPin(message){
  pinReturnFocus=document.activeElement;
  document.getElementById("pinMessage").textContent=message;
  document.getElementById("confirmPin").value="";
  document.getElementById("pinModal").classList.remove("hidden");
  document.getElementById("confirmPin").focus();
}
function closePin(){
  document.getElementById("pinModal").classList.add("hidden");
  pendingAction=null;
  if(pinReturnFocus?.isConnected)pinReturnFocus.focus();
  pinReturnFocus=null;
}
document.getElementById("closeModal").onclick=closePin;
document.getElementById("confirmPinBtn").onclick=confirmPin;
document.getElementById("confirmPin").onkeydown=e=>{if(e.key==="Enter")confirmPin();};

function confirmPin(){
  if(!pendingAction) return;
  if(document.getElementById("confirmPin").value!==user().pin) return toast("Incorrect PIN.",true);
  const a=pendingAction, u=user(); let receipt;
  const walletDebit=["send","withdraw","bankTransfer","buyLoad","payBill","growDeposit","growInvest"].includes(a.kind);
  if(walletDebit&&a.amount>u.balance){toast("Your balance changed. Review the amount and try again.",true);closePin();updateUI();return;}
  if(a.kind==="growWithdraw"){
    const goal=ensureGrowData(u).savingsGoals.find(item=>item.id===a.goalId);
    if(!goal||a.amount>Number(goal.saved||0)){toast("The savings goal balance changed. Review the amount and try again.",true);closePin();updateUI();return;}
  }
  if(a.kind==="growSell"){
    const holding=ensureGrowData(u).demoHoldings.find(item=>item.id===a.holdingId);
    if(!holding||roundMoney(holding.amount)!==roundMoney(a.amount)){toast("That paper position changed. Review it and try again.",true);closePin();updateUI();return;}
  }
  const limitedOutgoing=a.kind==="send"||a.kind==="withdraw"||a.kind==="bankTransfer";
  if(limitedOutgoing&&!checkOutgoingLimits(a.amount)){closePin();return;}
  if(a.kind==="add"){
    u.balance=roundMoney(u.balance+a.amount); addTx("credit","Money added","Wallet top-up",a.amount);
    receipt={title:"Money Added",detail:"Wallet top-up",amount:a.amount,recipient:u.name};
    document.getElementById("addAmount").value="";
    clearAmountSelection();
  } else if(a.kind==="buyLoad"){
    u.balance=roundMoney(u.balance-a.amount);addTx("debit","Mobile load",a.network+" · "+a.phone,a.amount);
    receipt={title:"Mobile Load",detail:a.network+" prepaid load for "+a.phone,amount:a.amount,recipient:a.phone};
    document.getElementById("loadPhone").value="";document.getElementById("loadAmount").value="";clearLoadSelection();
  } else if(a.kind==="payBill"){
    u.balance=roundMoney(u.balance-a.amount);addTx("debit","Bill payment",a.biller+" · Ref "+a.reference,a.amount);
    receipt={title:"Bill Payment",detail:a.biller+" · Reference "+a.reference,amount:a.amount,recipient:a.biller};
    document.getElementById("billAccount").value="";document.getElementById("billAmount").value="";
  } else if(a.kind==="growDeposit"){
    const goal=ensureGrowData(u).savingsGoals.find(item=>item.id===a.goalId);
    if(!goal){toast("That savings goal is no longer available.",true);closePin();return;}
    u.balance=roundMoney(u.balance-a.amount);goal.saved=roundMoney((Number(goal.saved)||0)+a.amount);
    addTx("debit","Savings goal deposit","Goal · "+goal.name,a.amount);
    receipt={title:"Savings Goal Deposit",detail:"Demo savings · "+goal.name,amount:a.amount,recipient:u.name};
    const goalAmountInput=[...document.querySelectorAll("[data-grow-amount]")].find(input=>input.dataset.growAmount===goal.id);
    if(goalAmountInput)goalAmountInput.value="";
  } else if(a.kind==="bankTransfer"){
    const maskedAccount="•••• "+a.accountNumber.slice(-4),detail=a.bank+" · "+a.accountName+" · "+maskedAccount;
    u.balance=roundMoney(u.balance-a.amount);addTx("debit","Bank transfer",detail,a.amount);recordOutgoingUsage(a.amount);
    receipt={title:"Bank Transfer",detail,amount:a.amount,recipient:a.accountName};
    document.getElementById("bankAccountName").value="";document.getElementById("bankAccountNumber").value="";document.getElementById("bankAmount").value="";
  } else if(a.kind==="withdraw"){
    u.balance=roundMoney(u.balance-a.amount); addTx("debit","Cash withdrawal","Demo cash-out",a.amount);
    recordOutgoingUsage(a.amount);
    receipt={title:"Withdrawal",detail:"Demo cash-out",amount:a.amount,recipient:u.name};
    document.getElementById("withdrawAmount").value="";
  } else if(a.kind==="growWithdraw"){
    const goal=ensureGrowData(u).savingsGoals.find(item=>item.id===a.goalId);
    u.balance=roundMoney(u.balance+a.amount);goal.saved=roundMoney(Number(goal.saved)-a.amount);
    addTx("credit","Savings goal withdrawal","Goal · "+goal.name,a.amount);
    receipt={title:"Savings Goal Withdrawal",detail:"Demo savings · "+goal.name,amount:a.amount,recipient:u.name};
    const goalAmountInput=[...document.querySelectorAll("[data-grow-amount]")].find(input=>input.dataset.growAmount===goal.id);
    if(goalAmountInput)goalAmountInput.value="";
  } else if(a.kind==="growInvest"){
    u.balance=roundMoney(u.balance-a.amount);
    ensureGrowData(u).demoHoldings.push({id:uid("P"),product:a.product,amount:a.amount,createdAt:now()});
    addTx("debit","Paper portfolio contribution",a.product,a.amount);
    receipt={title:"Paper Portfolio Contribution",detail:a.product+" · demo position",amount:a.amount,recipient:u.name};
    document.getElementById("growInvestmentAmount").value="";
  } else if(a.kind==="growSell"){
    const holdings=ensureGrowData(u).demoHoldings;
    const holding=holdings.find(item=>item.id===a.holdingId);
    u.balance=roundMoney(u.balance+Number(holding.amount));
    addTx("credit","Paper position closed",holding.product+" · returned at contributed value",holding.amount);
    receipt={title:"Paper Position Closed",detail:holding.product+" · returned at contributed value",amount:holding.amount,recipient:u.name};
    u.demoHoldings=holdings.filter(item=>item.id!==a.holdingId);
  } else {
    const target=db.users.find(x=>x.id===a.targetId);
    u.balance=roundMoney(u.balance-a.amount); target.balance=roundMoney(target.balance+a.amount);
    addTx("debit","Sent to @"+target.username,"Transfer",a.amount);
    recordOutgoingUsage(a.amount);
    target.transactions.push({id:uid("TX"),type:"credit",title:"Received from @"+u.username,detail:"Transfer",amount:a.amount,date:now()});
    addInboxMessage("Money received",peso(a.amount)+" received from @"+u.username+".","wallet",target);
    receipt={title:"Money Sent",detail:"Transfer to @"+target.username,amount:a.amount,recipient:target.name};
    document.getElementById("sendAmount").value=""; document.getElementById("sendRecipient").value="";
  }
  saveDB(); updateUI(); closePin(); showReceipt(receipt);
  if(user().preferences?.transactionSuccessAlerts!==false)toast("Transaction completed.");
}
function showReceipt(r){
  receiptReturnFocus=document.activeElement;
  document.getElementById("receiptContent").innerHTML=`
    <div class="receipt-body">
      <div class="receipt-row"><span>Transaction</span><b>${escapeHTML(r.title)}</b></div>
      <div class="receipt-row"><span>Details</span><b>${escapeHTML(r.detail)}</b></div>
      <div class="receipt-row"><span>Amount</span><b>${peso(r.amount)}</b></div>
      <div class="receipt-row"><span>Account</span><b>@${escapeHTML(user().username)}</b></div>
      <div class="receipt-row"><span>Date</span><b>${new Date().toLocaleString()}</b></div>
      <div class="receipt-row"><span>Status</span><b class="plus">COMPLETED</b></div>
    </div>`;
  document.getElementById("receiptModal").classList.remove("hidden");
  document.getElementById("closeReceipt").focus();
}
function closeReceipt(){
  document.getElementById("receiptModal").classList.add("hidden");
  if(receiptReturnFocus?.isConnected)receiptReturnFocus.focus();
  receiptReturnFocus=null;
}
document.getElementById("closeReceipt").onclick=closeReceipt;
document.getElementById("closeReceipt2").onclick=closeReceipt;
document.getElementById("pinModal").addEventListener("click",e=>{if(e.target===e.currentTarget)closePin();});
document.getElementById("receiptModal").addEventListener("click",e=>{if(e.target===e.currentTarget)closeReceipt();});
document.addEventListener("keydown",e=>{
  const pinModal=document.getElementById("pinModal"), receiptModal=document.getElementById("receiptModal");
  const modal=!receiptModal.classList.contains("hidden")?receiptModal:!pinModal.classList.contains("hidden")?pinModal:null;
  if(!modal)return;
  if(e.key==="Escape"){
    e.preventDefault();
    if(modal===receiptModal)closeReceipt();else closePin();
    return;
  }
  if(e.key!=="Tab")return;
  const focusable=[...modal.querySelectorAll('button:not([disabled]), input:not([disabled])')].filter(el=>el.offsetParent!==null);
  if(!focusable.length)return;
  const first=focusable[0], last=focusable[focusable.length-1];
  if(!modal.contains(document.activeElement)){e.preventDefault();first.focus();}
  else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
});
document.getElementById("printReceipt").onclick=()=>{
  document.body.classList.add("printing-receipt");
  window.print();
};

function generateQR(){
  const u=user(); document.getElementById("qrUsername").textContent="@"+u.username;
  const box=document.getElementById("qrcode"); box.innerHTML="";
  if(window.QRCode){
    new QRCode(box,{text:"NexaPay|"+u.username,width:180,height:180,colorDark:"#17202a",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});
  }else box.innerHTML="<div class='notice'>QR library could not load. Use the username instead.</div>";
}
document.getElementById("downloadQR").onclick=()=>{
  const u=user(); const old=document.title; document.title="NexaPay QR - @"+u.username;
  document.body.classList.add("printing-qr");
  window.print(); document.title=old;
};
window.addEventListener("afterprint",()=>document.body.classList.remove("printing-receipt","printing-qr"));
document.getElementById("clearTransactions").onclick=()=>{
  if(!confirm("Clear your transaction history? This will not change your balance.")) return;
  user().transactions=[];
  document.getElementById("transactionSearch").value="";
  document.getElementById("transactionFilter").value="all";
  saveDB(); updateUI(); toast("Transaction history cleared.");
};

if(currentUserId && user()) showApp();
else document.getElementById("authScreen").classList.remove("hidden");

window.addEventListener("storage",e=>{
  const previousUserId=currentUserId;
  if(e.key===SESSION_KEY||e.key===null)currentUserId=localStorage.getItem(SESSION_KEY);
  if(e.key===DB_KEY||e.key===null)db=loadDB();
  if(currentUserId&&user()){
    if(currentUserId!==previousUserId)showApp();else updateUI();
    resetInactivityTimer();
  }else if(!document.getElementById("appScreen").classList.contains("hidden"))logout();
});
