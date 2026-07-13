/* ===== Extracted core backend logic from Saaphzone OCEMS portal =====
   These are the exact functions the portal uses for its data model,
   CPCB grading engine, persistence, and real-data ingestion.
   Edit here to understand/modify behaviour, then paste back into the
   <script> section of saaphzone_ocems_v2.html (search by function name).
   ================================================================= */

let DATA_CFG = {
  mode: 'simulation',          // 'simulation' | 'live' | 'off'
  apiBase: '',                 // e.g. 'https://dashboard.saaphzone.com/api'
  apiKey: '',                  // sent as header: Authorization: Bearer <key>
  pollSeconds: 30,             // how often to fetch in 'live' mode
  simSeconds: 4                // simulator tick interval
};

const DB_KEY='saaphzone_ocems_v2';

const CFG_KEY='saaphzone_ocems_cfg';


/* ---- gradeParameter ---- */
function gradeParameter(p){
  const def=PARAMS[p.key]||{};
  const isEtp=def.type==='etp';
  if(p.connHrs>=168) return 'purple';
  if(p.redCount30>1) return 'purple';
  if(isEtp && p.y30>=192) return 'purple';
  if(def.ph && (p.phVal<4||p.phVal>12)) return 'purple';
  if(p.stableHrs>=168) return 'purple';
  if(p.excStreak>=8) return 'red';
  if(p.y30>=54) return 'red';
  if(p.connHrs>=96) return 'red';
  if(p.y30conn>=18) return 'red';
  if(p.stableHrs>=144) return 'red';
  if(p.excStreak>=4) return 'orange';
  if(p.y30>=27) return 'orange';
  if(p.connHrs>=48) return 'orange';
  if(p.y30conn>=12) return 'orange';
  if(p.stableHrs>=72) return 'orange';
  if(p.yToday>=2) return 'yellow';
  if(p.connFailHrsToday>=4) return 'yellow';
  if(p.stableHrs>=48) return 'yellow';
  return 'green';
}


/* ---- rollup ---- */
function rollup(params,connectivity,enabled){
  if(enabled===false) return 'grey';
  if(connectivity==='grey') return 'grey';
  let worst=connectivity==='delay'?'delay':'green';
  params.forEach(p=>{if(RANK[p.signal]>RANK[worst])worst=p.signal;});
  return worst;
}


/* ---- triggerReason ---- */
function triggerReason(p){
  const s=p.signal;
  if(s==='green') return 'Within limits';
  if(s==='delay') return 'Data delayed';
  if(s==='grey') return 'Offline';
  const b=[];
  if(p.excStreak>=8)b.push('8 consecutive exceedances');
  else if(p.excStreak>=4)b.push('4 consecutive exceedances');
  else if(p.yToday>=2)b.push(p.yToday+' exceedances today');
  if(p.y30>=54)b.push(p.y30+' warnings/30d (15%)');
  else if(p.y30>=27)b.push(p.y30+' warnings/30d (7.5%)');
  if(p.connHrs>=48)b.push('conn-fail '+p.connHrs+'h');
  if(p.stableHrs>=48)b.push('frozen sensor '+Math.round(p.stableHrs)+'h');
  if(PARAMS[p.key]&&PARAMS[p.key].ph&&(p.phVal<4||p.phVal>12))b.push('pH out of 4–12');
  return b.join(' · ')||'Exceedance';
}


/* ---- serviceStatus ---- */
function serviceStatus(c){
  const expiry=(c&&typeof c==='object')?c.expiry:c;
  if(c&&typeof c==='object'&&c.suspended)
    return {code:'suspended',label:'Suspended',color:'var(--st-grey)',hex:'#8a978d',days:expiry?Math.ceil((expiry-Date.now())/DAY):null};
  if(!expiry)return {code:'none',label:'Not set',color:'var(--st-grey)',hex:'#8a978d',days:null};
  const days=Math.ceil((expiry-Date.now())/DAY);
  if(days<0)  return {code:'expired', label:'Expired',      color:'var(--st-red)',   hex:'#e23b2e', days};
  if(days<=7) return {code:'week',    label:'≤ 1 week',     color:'var(--st-red)',   hex:'#e23b2e', days};
  if(days<=15)return {code:'d15',     label:'≤ 15 days',    color:'var(--st-orange)',hex:'#e8722b', days};
  if(days<=30)return {code:'m1',      label:'≤ 1 month',    color:'var(--st-orange)',hex:'#e8722b', days};
  if(days<=60)return {code:'m2',      label:'≤ 2 months',   color:'var(--st-yellow)',hex:'#f5c518', days};
  return {code:'ok',label:'Active',color:'var(--st-green)',hex:'#1fa971',days};
}


/* ---- ingestReadings ---- */
function ingestReadings(readings){
  if(!Array.isArray(readings)||!readings.length)return {applied:0};
  let applied=0,touched={};
  readings.forEach(r=>{
    let site=null,p=null;
    if(r.pid){
      for(const s of STATE.sites){const hit=(s.params||[]).find(x=>x.pid===r.pid);if(hit){site=s;p=hit;break;}}
    }
    if(!p&&r.siteId){
      site=STATE.sites.find(s=>s.id===r.siteId);
      if(site)p=(site.params||[]).find(x=>x.key===r.param);
    }
    if(!site||!p)return; // unknown channel — skip
    const v=+r.value;if(isNaN(v))return;
    const n=PARAMS[p.key]||{limit:p.limit};
    const prev=p.signal;
    p.value=+v.toFixed(2);
    if(n.ph){p.phVal=p.value;}
    p.history.push(p.value);if(p.history.length>24)p.history.shift();
    const lim=n.limit||p.limit;
    const over=n.ph?(p.value>lim||p.value<(n.min||6.5)):(p.value>lim);
    if(over){p.excStreak++;p.yToday++;p.y30++;}else p.excStreak=Math.max(0,p.excStreak-1);
    // real data arriving means the channel is connected
    p.connFailHrsToday=0;p.connHrs=0;
    p.signal=gradeParameter(p);
    site.connectivity='live';site.running=true;
    site.lastData=r.ts?fmtTime(new Date(r.ts)):'just now';
    touched[site.id]=site;
    if(RANK[p.signal]>RANK[prev]&&['yellow','orange','red','purple'].includes(p.signal)){
      STATE.alerts.unshift({id:'ALT-'+rid(),site:site.name,siteId:site.id,param:p.key,
        level:p.signal,reason:triggerReason(p),time:Date.now()});
      if(STATE.alerts.length>120)STATE.alerts.pop();
      const sess=STATE.session;
      if(sess&&(sess.role!=='industry'||sess.siteId===site.id))
        toast(`${SIG_LABEL[p.signal]} · ${site.name} — ${p.key} ${p.value}${p.unit}`,(p.signal==='red'||p.signal==='purple')?'crit':'alert');
    }
    applied++;
  });
  Object.values(touched).forEach(s=>{s.signal=rollup(s.params,s.running?'green':'grey',s.enabled);});
  if(applied){save();refreshLiveViews();}
  return {applied};
}


/* ---- pidFor ---- */
function pidFor(siteId,key){
  const suffix=(PARAMS[key]&&PARAMS[key].pid)?PARAMS[key].pid.replace(/^P-/,''):key.toUpperCase().replace(/[^A-Z0-9]/g,'');
  return (siteId?siteId.toUpperCase()+'-':'')+suffix;
}


/* ---- seedParam ---- */
function seedParam(key,scenario,siteId){
  const n=PARAMS[key];if(!n)return null;
  let base=n.ph?7.4:n.limit*0.55;
  let p={key,pid:pidFor(siteId,key),unit:n.unit,limit:n.limit,min:n.min,value:n.ph?base:+base.toFixed(1),
    yToday:0,y30:0,y30conn:0,connHrs:0,connFailHrsToday:0,stableHrs:0,excStreak:0,
    redCount30:0,phVal:n.ph?base:null,history:[]};
  for(let i=0;i<24;i++){let v=n.ph?7.2+Math.sin(i/3)*0.4:n.limit*(0.45+Math.random()*0.25);p.history.push(+v.toFixed(1));}
  if(scenario==='yellow'&&Math.random()<0.5){p.yToday=2;p.value=+(n.limit*1.15).toFixed(1);if(n.ph)p.phVal=p.value;}
  if(scenario==='orange'&&Math.random()<0.5){p.y30=29;p.excStreak=4;p.value=+(n.limit*1.3).toFixed(1);if(n.ph)p.phVal=p.value;}
  if(scenario==='red'&&Math.random()<0.45){p.y30=56;p.excStreak=8;p.value=+(n.limit*1.5).toFixed(1);if(n.ph)p.phVal=p.value;}
  if(scenario==='purple'&&key==='pH'){p.phVal=3.6;p.value=3.6;p.redCount30=2;}
  if(scenario==='stable'&&Math.random()<0.4){p.stableHrs=52;}
  p.signal=gradeParameter(p);
  return p;
}


/* ---- buildSeed ---- */
function buildSeed(){
  // per-site demo expiry offsets (days) so each notification colour is represented
  const SVC_OFFSETS={
    'ESK-4417':{dtc:300,amcGas:52,amcWater:120,amcSpm:12,cmcGas:200,cmcWater:6,cmcSpm:-5},
    'KRK-0392':{dtc:25,amcGas:75,amcWater:14,amcSpm:200,cmcGas:40,cmcWater:300,cmcSpm:90},
    'NCW-0288':{dtc:400,amcGas:250,amcWater:180,amcSpm:150,cmcGas:220,cmcWater:160,cmcSpm:100},
    'GTM-0511':{dtc:5,amcGas:-2,amcWater:9,amcSpm:58,cmcGas:13,cmcWater:29,cmcSpm:120},
    'YSD-0623':{dtc:70,amcGas:130,amcWater:210,amcSpm:33,cmcGas:19,cmcWater:240,cmcSpm:300},
    'ATP-0705':{dtc:48,amcGas:11,amcWater:140,amcSpm:6,cmcGas:80,cmcWater:170,cmcSpm:26},
    'DPF-0819':{dtc:190,amcGas:59,amcWater:16,amcSpm:250,cmcGas:100,cmcWater:8,cmcSpm:130},
    'MSR-0940':{dtc:14,amcGas:33,amcWater:-10,amcSpm:70,cmcGas:150,cmcWater:22,cmcSpm:4},
  };
  const sites=SEED_SITES.map(s=>{
    const params=s.params.map(k=>seedParam(k,s.scenario,s.id)).filter(Boolean);
    const connectivity=s.scenario==='delay'?'delay':'live';
    return {...s,params,connectivity,enabled:true,running:true,
      passcode:'1234',lastData:connectivity==='delay'?'4h 12m ago':'just now',
      services:seedServices(SVC_OFFSETS[s.id]),catalogue:clonePackages(),
      signal:rollup(params,connectivity==='delay'?'delay':'green',true)};
  });
  const alerts=[];
  sites.forEach(s=>s.params.forEach(p=>{
    if(!['green','delay'].includes(p.signal))
      alerts.push({id:'ALT-'+rid(),site:s.name,siteId:s.id,param:p.key,level:p.signal,
        reason:triggerReason(p),time:Date.now()-Math.random()*6*3600*1000});
  }));
  alerts.sort((a,b)=>b.time-a.time);
  const complaints=[
    {id:'CMP-'+rid(),siteId:'KRK-0392',site:'KRKA Pulp & Paper',cat:'Calibration',
     msg:'COD analyzer reading drifting after last service — please recalibrate.',
     status:'progress',by:'Dr. S. Rao',time:Date.now()-2*86400000},
    {id:'CMP-'+rid(),siteId:'ATP-0705',site:'Apex Thermal Power Stn.',cat:'Connectivity',
     msg:'Data feed delayed since morning, GPRS modem may be down.',
     status:'open',by:'Er. M. Iyer',time:Date.now()-6*3600000},
  ];
  const reqs=[
    {id:'REQ-'+rid(),siteId:'NCW-0288',site:'Northern Cement Works',type:'Calibration Report',
     status:'pending',by:'Er. A. Sethi',time:Date.now()-86400000,note:'Quarterly calibration due.'},
    {id:'REQ-'+rid(),siteId:'ESK-4417',site:'Escorts Kubota Limited',type:'Equipment Health Report',
     status:'approved',by:'Er. R. Malhotra',time:Date.now()-3*86400000,
     approvedBy:'Sh. Chandan',approvedTime:Date.now()-2*86400000,note:'ESP + bag filter health check.'},
  ];
  const users=[
    {id:'U1',name:'Administrator',role:'admin',login:'admin'},
    {id:'U2',name:'Sh. Chandan',role:'engineer',login:'chandan',mobile:'9818536015'},
  ];
  const creds={adminPass:'admin',engPass:'service',engLogin:'chandan',engName:'Sh. Chandan',engMobile:'9818536015',
    salesLogin:'sales',salesPass:'sales',salesName:'Sales Team',salesMobile:'',recoveryMobile:'9882810053'};
  return {sites,alerts,complaints,reqs,users,creds,packages:clonePackages(),session:null};
}


/* ---- save ---- */
function save(){
  try{
    const slim={
      sites:STATE.sites.map(s=>({...s,params:s.params.map(p=>({...p,history:p.history.slice(-24)}))})),
      alerts:STATE.alerts.slice(0,120),complaints:STATE.complaints,reqs:STATE.reqs,
      users:STATE.users,creds:STATE.creds,packages:STATE.packages,params:PARAMS,session:STATE.session,savedAt:Date.now()
    };
    localStorage.setItem(DB_KEY,JSON.stringify(slim));
  }catch(e){/* storage may be blocked (e.g. artifact sandbox) — run in-memory */}
}


/* ---- load ---- */
function load(){
  try{
    const raw=localStorage.getItem(DB_KEY);
    if(!raw) return false;
    const d=JSON.parse(raw);
    if(d.params)PARAMS=d.params;
    STATE.sites=d.sites||[];STATE.alerts=d.alerts||[];STATE.complaints=d.complaints||[];
    STATE.reqs=d.reqs||[];STATE.users=d.users||[];
    STATE.packages=d.packages||clonePackages();
    STATE.creds=d.creds||{adminPass:'admin',engPass:'service',engLogin:'chandan',engName:'Sh. Chandan',engMobile:'9818536015',
      salesLogin:'sales',salesPass:'sales',salesName:'Sales Team',salesMobile:'',recoveryMobile:'9882810053'};
    if(!STATE.creds.engLogin)STATE.creds.engLogin='chandan';
    if(!STATE.creds.engName)STATE.creds.engName='Sh. Chandan';
    if(!STATE.creds.engMobile)STATE.creds.engMobile='9818536015';
    if(!STATE.creds.salesLogin)STATE.creds.salesLogin='sales';
    if(!STATE.creds.salesPass)STATE.creds.salesPass='sales';
    if(!STATE.creds.salesName)STATE.creds.salesName='Sales Team';
    STATE.sites.forEach(s=>s.params&&s.params.forEach(p=>{if(!p.pid)p.pid=pidFor(s.id,p.key);}));
    STATE.sites.forEach(s=>{if(!s.services)s.services=seedServices({dtc:365,amcGas:365,amcWater:365,amcSpm:365,cmcGas:365,cmcWater:365,cmcSpm:365});});
    STATE.sites.forEach(s=>{if(!s.catalogue)s.catalogue=JSON.parse(JSON.stringify(STATE.packages||DEFAULT_PACKAGES));});
    STATE.session=null; // always require fresh login
    return STATE.sites.length>0;
  }catch(e){return false;}
}


/* ---- initData ---- */
function initData(){
  if(!load()){ STATE=buildSeed(); save(); }
}


/* ---- pollLiveData ---- */
function pollLiveData(){
  if(DATA_CFG.mode!=='live'||!DATA_CFG.apiBase)return;
  if(typeof fetch!=='function'){console.warn('fetch unavailable in this environment');return;}
  try{
    const url=DATA_CFG.apiBase.replace(/\/$/,'')+'/readings?since='+(lastPollTs||0);
    const headers={'Accept':'application/json'};
    if(DATA_CFG.apiKey)headers['Authorization']='Bearer '+DATA_CFG.apiKey;
    const res=await fetch(url,{headers});
    if(!res.ok){console.warn('poll failed',res.status);return;}
    const data=await res.json();
    const readings=data.readings||data||[];
    if(readings.length){lastPollTs=Date.now();ingestReadings(readings);}
  }catch(e){console.warn('poll error',e.message);}
}
