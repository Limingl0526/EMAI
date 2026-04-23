// gameEngine_clean.js
// V3.17: Police Buff (Police = SWAT = Traffic)
// Police units now count as SWAT and Traffic for requirements and efficiency.

let TIME_SCALE = 1; 
let AI_MODE = 'ASSIST'; 
let IS_EXPERIMENT = false; 
let eventIndex = 0; 

// AI 频率控制
let AI_FREQ_MODE = 'EVENT'; 
let aiInterval = null;      

export function setTimeScale(scale) {
  TIME_SCALE = Math.max(0.1, Math.min(100, Number(scale) || 1));
  return TIME_SCALE;
}
export function getTimeScale() { return TIME_SCALE; }
export function setAIMode(mode) { AI_MODE = mode; }

export function setExperimentMode(isExp) {
    IS_EXPERIMENT = isExp;
    eventIndex = 0; 
    console.log(`🧪 Experiment Mode: ${isExp ? "ON (Fixed Sequence)" : "OFF (Random)"}`);
}

export function setAIFrequency(mode) {
    AI_FREQ_MODE = mode;
    if (aiInterval) {
        clearInterval(aiInterval);
        aiInterval = null;
    }
    if (mode !== 'EVENT') {
        const ms = Number(mode);
        aiInterval = setInterval(() => {
            runAICycle();
        }, ms);
        console.log(`⏰ AI Frequency set to Timer: ${ms}ms`);
    } else {
        console.log(`⚡ AI Frequency set to EVENT Trigger`);
    }
}

// --- Geo Helpers ---
function toRad(deg) { return (deg * Math.PI) / 180; }
function haversineM(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aLat = toRad(a.lat);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.sin(dLat/2)**2 + Math.cos(aLat)*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2)));
}
function moveTowards(current, target, maxDistM) {
  const dist = haversineM(current, target);
  if (dist <= maxDistM) return { lat: target.lat, lng: target.lng, reached: true };
  const ratio = maxDistM / dist;
  return { lat: current.lat + (target.lat - current.lat) * ratio, lng: current.lng + (target.lng - current.lng) * ratio, reached: false };
}
function preprocessPath(path) {
  if (!Array.isArray(path) || path.length < 2) return { path: path||[], cumDistM: [0], totalDistM: 0 };
  const cum = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineM({lat:path[i-1][0], lng:path[i-1][1]}, {lat:path[i][0], lng:path[i][1]});
    cum.push(total);
  }
  return { path, cumDistM: cum, totalDistM: total };
}
function getPosOnPath(route, t) {
  if (!route || !route.path || route.path.length === 0) return null;
  const safeT = Math.max(0, Math.min(1, t));
  const targetDist = route.totalDistM * safeT;
  let lo = 0, hi = route.cumDistM.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (route.cumDistM[mid] <= targetDist) lo = mid;
    else hi = mid - 1;
  }
  const idx = lo;
  if (idx >= route.path.length - 1) {
    const p = route.path[route.path.length - 1];
    return { lat: p[0], lng: p[1] };
  }
  const dStart = route.cumDistM[idx];
  const dEnd = route.cumDistM[idx + 1];
  const segmentT = (dEnd - dStart) > 0.01 ? (targetDist - dStart) / (dEnd - dStart) : 0;
  const p0 = route.path[idx];
  const p1 = route.path[idx + 1];
  return { lat: p0[0] + (p1[0] - p0[0]) * segmentT, lng: p0[1] + (p1[1] - p0[1]) * segmentT };
}
function getTrafficFactor(gameTimeMs) {
  const h = new Date(gameTimeMs).getHours();
  if (h >= 7 && h < 9) return 1.4; 
  if (h >= 16 && h < 19) return 1.5;
  if (h >= 23 || h < 5) return 0.8;
  return 1.0;
}

export const ATLANTA_COORDS = [33.7490, -84.3880];
export const COLORS = { Police: '#0056b3', Fire: '#d32f2f', Medic: '#e0e0e0', SWAT: '#7000b3', Hazmat: '#32CD32', Traffic: '#FFD700' };
export const ROUTING_SERVICE_URL = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';

const UNIT_PROFILE = {
  Police:  { prep: 0,  speed: 1.3, clear: 5,  isPatrol: true },
  Medic:   { prep: 0,  speed: 1.2, clear: 15, isPatrol: false },
  Fire:    { prep: 0,  speed: 1.0, clear: 20, isPatrol: false },
  SWAT:    { prep: 0,  speed: 1.15,clear: 30, isPatrol: false },
  Hazmat:  { prep: 0,  speed: 0.9, clear: 35, isPatrol: false },
  Traffic: { prep: 0,  speed: 1.1, clear: 2,  isPatrol: true },
};

// V3.16 Settings: Short Duration, Long Timeout
export const SCENARIOS = [
  { type: "TRAFFIC STOP", severity: "Low", req: ["Traffic"], duration: 75, timeout: 600, color: COLORS.Traffic, icon: "👮", reasoning: "Speeding violation." }, 
  { type: "MEDICAL ALARM", severity: "Low", req: ["Medic"], duration: 100, timeout: 480, color: COLORS.Medic, icon: "🤒", reasoning: "Elderly fall." }, 
  { type: "TRASH FIRE", severity: "Medium", req: ["Fire"], duration: 125, timeout: 600, color: COLORS.Fire, icon: "🔥", reasoning: "Dumpster fire." }, 
  { type: "MVA MAJOR", severity: "High", req: ["Traffic", "Medic", "Fire"], duration: 300, timeout: 900, color: COLORS.Traffic, icon: "💥", reasoning: "Multi-vehicle collision." }, 
  { type: "DOMESTIC DISPUTE", severity: "Medium", req: ["Police", "Police"], duration: 200, timeout: 690, color: COLORS.Police, icon: "📢", reasoning: "Noise complaint." }, 
  { type: "BANK HEIST", severity: "Critical", req: ["SWAT", "Police", "Police"], duration: 500, timeout: 1200, color: COLORS.SWAT, icon: "🔫", reasoning: "Armed suspects." }, 
  { type: "CHEM SPILL", severity: "High", req: ["Hazmat", "Fire", "Police"], duration: 625, timeout: 1500, color: COLORS.Hazmat, icon: "☣️", reasoning: "Toxic leak." }, 
  { type: "HIGH-RISE INFERNO", severity: "Critical", req: ["Fire", "Fire", "Medic", "Medic", "Police", "Traffic"], duration: 1000, timeout: 1800, color: COLORS.Fire, icon: "🏢", reasoning: "Massive structure fire." } 
];

const FIXED_SEQUENCE = [
    { type: "TRAFFIC STOP", offLat: 0.01, offLng: 0.01 },
    { type: "MEDICAL ALARM", offLat: -0.02, offLng: 0.02 },
    { type: "DOMESTIC DISPUTE", offLat: 0.03, offLng: -0.01 }, 
    { type: "TRASH FIRE", offLat: -0.01, offLng: -0.03 },
    { type: "TRAFFIC STOP", offLat: 0.04, offLng: 0.04 },
    { type: "MVA MAJOR", offLat: 0.00, offLng: 0.00 }, 
    { type: "MEDICAL ALARM", offLat: -0.04, offLng: -0.02 },
    { type: "DOMESTIC DISPUTE", offLat: 0.02, offLng: 0.05 },
    { type: "BANK HEIST", offLat: -0.03, offLng: 0.03 }, 
    { type: "TRAFFIC STOP", offLat: 0.05, offLng: -0.05 },
    { type: "CHEM SPILL", offLat: 0.01, offLng: -0.04 }, 
    { type: "MEDICAL ALARM", offLat: -0.02, offLng: 0.01 },
    { type: "TRASH FIRE", offLat: 0.03, offLng: 0.02 },
    { type: "DOMESTIC DISPUTE", offLat: -0.01, offLng: -0.02 },
    { type: "HIGH-RISE INFERNO", offLat: 0.02, offLng: 0.00 }, 
    { type: "TRAFFIC STOP", offLat: -0.05, offLng: 0.05 },
    { type: "MVA MAJOR", offLat: 0.04, offLng: -0.03 },
    { type: "MEDICAL ALARM", offLat: -0.03, offLng: -0.04 },
    { type: "DOMESTIC DISPUTE", offLat: 0.01, offLng: 0.03 },
    { type: "BANK HEIST", offLat: -0.02, offLng: 0.02 }, 
    { type: "TRASH FIRE", offLat: 0.05, offLng: -0.01 },
    { type: "TRAFFIC STOP", offLat: -0.04, offLng: 0.04 },
    { type: "CHEM SPILL", offLat: 0.00, offLng: -0.05 }, 
    { type: "MEDICAL ALARM", offLat: 0.03, offLng: 0.01 },
    { type: "DOMESTIC DISPUTE", offLat: -0.01, offLng: 0.02 },
    { type: "MVA MAJOR", offLat: 0.02, offLng: -0.02 },
    { type: "TRAFFIC STOP", offLat: -0.03, offLng: 0.00 },
    { type: "HIGH-RISE INFERNO", offLat: 0.04, offLng: 0.04 }, 
    { type: "MEDICAL ALARM", offLat: -0.02, offLng: -0.03 },
    { type: "TRASH FIRE", offLat: 0.01, offLng: 0.05 }
];

let incidents = [];
let units = [];
let gameCurrentTimeMs = Date.now();
let lastRealTickTime = Date.now();
export let gameState = { baseScore: 0, resolvedCount: 0, activeCount: 0, currentScore: 0 };

async function sendBackendLog(actionType, content) {
    try {
        await fetch("http://127.0.0.1:5000/api/log/", {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: actionType, message: content })
        });
    } catch (e) { console.error("Log failed", e); }
}

export function initGame(config = {}) {
  fetch("http://127.0.0.1:5000/api/session/new/", { method: "POST", mode: "cors" })
      .then(() => console.log("🆕 Backend Session Reset"))
      .catch(e => console.error("Failed to reset backend session", e));

  eventIndex = 0; 

  const counts = config.units || {};
  units = [];
  Object.keys(counts).forEach(type => {
    const n = Number(counts[type]) || 0;
    const prof = UNIT_PROFILE[type];
    for(let i=1; i<=n; i++) {
      const homeLat = ATLANTA_COORDS[0] + (Math.random()-0.5)*0.1;
      const homeLng = ATLANTA_COORDS[1] + (Math.random()-0.5)*0.1;
      units.push({
        id: `${type.charAt(0)}-${i}`,
        type, lat: homeLat, lng: homeLng, homeLat, homeLng,
        efficiency: parseFloat((0.8 + Math.random()*0.4).toFixed(2)),
        driverSkill: parseFloat((0.9 + Math.random()*0.2).toFixed(2)),
        baseSpeed: prof.speed, prepTime: prof.prep, clearTime: prof.clear, isPatrol: prof.isPatrol,
        status: "Idle", assignedTo: null,
        patrolTarget: null, route: null, travelState: null, timerStart: null,
      });
    }
  });
  incidents = [];
  gameCurrentTimeMs = new Date().setHours(7, 30, 0, 0);
  lastRealTickTime = Date.now();
  gameState = { baseScore: 0, resolvedCount: 0, activeCount: 0, currentScore: 0 };
  
  setTimeout(() => runAICycle(), 1000); 
  
  return getGameState();
}

function generateIncId() { return "INC-" + Math.floor(Math.random() * 10000).toString().padStart(4, '0'); }

export function triggerScenario() {
  if(incidents.filter(i=>i.status!=='Resolved' && i.status!=='Expired').length >= 12) return; 
  
  let scTemplate = null;
  let lat = 0;
  let lng = 0;

  if (IS_EXPERIMENT) {
      if (eventIndex >= FIXED_SEQUENCE.length) {
          console.log("🚫 All fixed events triggered.");
          return;
      }
      const fixedEvent = FIXED_SEQUENCE[eventIndex];
      scTemplate = SCENARIOS.find(s => s.type === fixedEvent.type);
      lat = ATLANTA_COORDS[0] + fixedEvent.offLat;
      lng = ATLANTA_COORDS[1] + fixedEvent.offLng;
      eventIndex++;
  } else {
      scTemplate = SCENARIOS[Math.floor(Math.random()*SCENARIOS.length)];
      lat = ATLANTA_COORDS[0] + (Math.random()-0.5)*0.15;
      lng = ATLANTA_COORDS[1] + (Math.random()-0.5)*0.15;
  }

  if (!scTemplate) return;

  const newInc = {
    id: generateIncId(),
    type: scTemplate.type, 
    severity: scTemplate.severity, 
    req: [...scTemplate.req], 
    color: scTemplate.color, 
    icon: scTemplate.icon, 
    reasoning: scTemplate.reasoning,
    totalWorkload: scTemplate.duration, 
    timeout: scTemplate.timeout, 
    currentProgress: 0, lat, lng, startTime: gameCurrentTimeMs,
    status: "Active", assignedUnits: [], currentSpeed: 0
  };
  incidents.push(newInc);
  console.log(`🚨 New Incident ${newInc.id} (${IS_EXPERIMENT ? 'Fixed #' + eventIndex : 'Random'})`);
  
  const logMsg = `Type=${newInc.type}, Severity=${newInc.severity}, Loc=(Lat:${newInc.lat.toFixed(4)}, Lng:${newInc.lng.toFixed(4)})`;
  sendBackendLog("EVENT_SPAWN", logMsg);
  
  if (AI_FREQ_MODE === 'EVENT') {
      runAICycle();
  }
}

export function stopGameSession() {
    const finalScore = gameState.baseScore;
    const resolved = gameState.resolvedCount;
    
    const msg = `FinalScore=${finalScore}, ResolvedCount=${resolved}`;
    sendBackendLog("SESSION_END", msg);
    
    console.log("🛑 SESSION ENDED: " + msg);
}

async function getRoute(uLat, uLng, tLat, tLng) {
  try {
    const url = `${ROUTING_SERVICE_URL}${uLng},${uLat};${tLng},${tLat}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json();
    if(data.code !== 'Ok') throw new Error('No Route');
    const r = data.routes[0];
    return { geo: preprocessPath(r.geometry.coordinates.map(c=>[c[1],c[0]])), duration: r.duration };
  } catch(e) {
    const dist = haversineM({lat:uLat,lng:uLng}, {lat:tLat,lng:tLng});
    const path = [[uLat, uLng], [uLat, tLng], [tLat, tLng]];
    return { geo: preprocessPath(path), duration: (dist * 1.4) / 15 };
  }
}

export async function dispatchUnitBackend(uid, iid) {
  const u = units.find(x=>x.id===uid);
  const inc = incidents.find(x=>x.id===iid);
  if(!u || !inc || inc.status === 'Expired') return;

  sendBackendLog("DISPATCH_ACTION", `Sent ${uid} to ${iid} (${inc.type})`);

  if(u.status === 'Returning') u.status = "Responding"; 
  else { u.status = "Preparing"; u.timerStart = gameCurrentTimeMs; }
  
  u.assignedTo = inc.id;
  u.patrolTarget = null; u.route = null;
  u.travelState = null; 
  
  const routeData = await getRoute(u.lat, u.lng, inc.lat, inc.lng);
  u.route = routeData.geo;
  u.travelState = { baseDuration: routeData.duration, startTime: (u.status==="Responding" ? gameCurrentTimeMs : null) };
  
  if(!inc.assignedUnits.includes(uid)) inc.assignedUnits.push(uid);
}

export function setUnitRTB(u) {
  if(u.status === 'Idle' && !u.isPatrol && haversineM(u, {lat:u.homeLat, lng:u.homeLng}) > 50) { startReturnTrip(u); return; }
  u.status = "Clearing"; u.timerStart = gameCurrentTimeMs;
}

async function startReturnTrip(u) {
  u.status = "Returning"; u.assignedTo = null;
  if(u.isPatrol) { u.status = "Idle"; u.patrolTarget = null; return; }
  u.travelState = null; 
  const routeData = await getRoute(u.lat, u.lng, u.homeLat, u.homeLng);
  u.route = routeData.geo;
  u.travelState = { baseDuration: routeData.duration, startTime: gameCurrentTimeMs };
}

export function getGameState() {
  const realNow = Date.now();
  const dt = Math.min((realNow - lastRealTickTime) / 1000, 0.5); 
  const dtGame = dt * TIME_SCALE;
  lastRealTickTime = realNow;
  gameCurrentTimeMs += dtGame * 1000;
  const traffic = getTrafficFactor(gameCurrentTimeMs);

  units.forEach(u => {
    if(u.status === "Idle") {
       if(u.isPatrol) {
          if(!u.patrolTarget || haversineM(u, u.patrolTarget) < 20) {
              u.patrolTarget = { lat: u.lat + (Math.random()-0.5)*0.01, lng: u.lng + (Math.random()-0.5)*0.01 };
          }
          const move = moveTowards(u, u.patrolTarget, 8 * dtGame);
          u.lat = move.lat; u.lng = move.lng;
       } else if(haversineM(u, {lat:u.homeLat, lng:u.homeLng}) > 100) startReturnTrip(u);
    }
    else if(u.status === "Preparing") {
       if((gameCurrentTimeMs - u.timerStart)/1000 >= u.prepTime && u.travelState) {
           u.status = "Responding"; 
           u.travelState.startTime = gameCurrentTimeMs;
       }
    }
    else if((u.status === "Responding" || u.status === "Returning") && u.travelState && u.travelState.startTime) {
       const speedMult = (u.baseSpeed * u.driverSkill) / traffic;
       const expectedDuration = u.travelState.baseDuration / speedMult;
       const elapsed = (gameCurrentTimeMs - u.travelState.startTime)/1000;
       const t = expectedDuration > 0 ? Math.min(1, elapsed / expectedDuration) : 1;
       const pos = getPosOnPath(u.route, t);
       if(pos) { u.lat = pos.lat; u.lng = pos.lng; }
       if(t >= 1) {
           if(u.status === "Responding") u.status = "On Scene";
           else { u.status = "Idle"; u.lat = u.homeLat; u.lng = u.homeLng; }
       }
    }
    else if(u.status === "Clearing") {
        if((gameCurrentTimeMs - u.timerStart)/1000 >= u.clearTime) startReturnTrip(u);
    }
  });

  const activeIncidents = incidents.filter(i => i.status !== 'Resolved' && i.status !== 'Expired');
  gameState.activeCount = activeIncidents.length;
  gameState.currentScore = gameState.baseScore - (gameState.activeCount * 100);

  incidents.forEach(inc => {
      // 1. 超时检查
      if (inc.status === 'Active') {
          const elapsed = (gameCurrentTimeMs - inc.startTime) / 1000;
          if (elapsed > inc.timeout) {
              inc.status = 'Expired';
              gameState.baseScore -= 2000; 
              sendBackendLog("EVENT_EXPIRED", `Incident ${inc.id} Expired. Score Penalized.`);
              inc.assignedUnits.forEach(uid => setUnitRTB(units.find(x=>x.id===uid)));
          }
      }

      if(inc.status === 'Expired' || inc.status === 'Resolved') return;

      // 2. 进度与效率计算
      const unitsOnScene = inc.assignedUnits.map(uid => units.find(u=>u.id===uid)).filter(u => u && (u.status === "On Scene" || u.status === "Working"));
      
      if(unitsOnScene.length > 0) inc.status = "InProgress";
      
      let totalPower = 0;
      if(inc.status === "InProgress") {
          // 🔴 核心修改：能力构建 (Police = Universal)
          const capabilitiesOnScene = new Set();
          unitsOnScene.forEach(u => {
              capabilitiesOnScene.add(u.type);
              if (u.type === 'Police') {
                  capabilitiesOnScene.add('SWAT');
                  capabilitiesOnScene.add('Traffic');
              }
          });

          // 检查是否缺失必要能力
          const reqTypes = new Set(inc.req); 
          let missingReq = false;
          reqTypes.forEach(t => { if(!capabilitiesOnScene.has(t)) missingReq = true; });

          // 计算功率
          unitsOnScene.forEach(u => {
              u.status = "Working";
              let effMult = 0.2; 
              // Native match
              if (inc.req.includes(u.type)) effMult = 1.0;
              // 🔴 Police Buff
              else if (u.type === 'Police' && (inc.req.includes('SWAT') || inc.req.includes('Traffic'))) effMult = 1.0;

              totalPower += u.efficiency * effMult;
          });

          // 缺类型惩罚
          if(missingReq) totalPower *= 0.1;

          inc.currentProgress += totalPower * dtGame;
      }
      inc.currentSpeed = totalPower;

      if(inc.currentProgress >= inc.totalWorkload) {
          inc.status = "Resolved";
          gameState.resolvedCount++;
          const actualDuration = (gameCurrentTimeMs - inc.startTime)/1000;
          gameState.baseScore += (500 + Math.floor(Math.max(0, inc.totalWorkload * 1.5 - actualDuration)));
          inc.assignedUnits.forEach(uid => setUnitRTB(units.find(x=>x.id===uid)));
      }
  });

  return { units, incidents: incidents.filter(i=>i.status!=='Resolved' && i.status!=='Expired'), gameState, gameTime: gameCurrentTimeMs };
}
export function findBestUnit(inc) {
    const available = units.filter(u => u.status === 'Idle' && inc.req.includes(u.type));
    if(available.length === 0) return null;
    available.sort((a,b) => haversineM(a, inc) - haversineM(b, inc));
    return available[0];
}

const BRAIN_URL = "http://127.0.0.1:5000/api/dispatch/";

export async function runAICycle() {
    if (AI_MODE === 'HUMAN') return;

    const state = getGameState();
    const idleUnits = state.units.filter(u => u.status === 'Idle');
    const activeIncidents = state.incidents.filter(i => i.status === 'Active' || i.status === 'InProgress');
    
    if (activeIncidents.length === 0) return;

    const payload = {
        timestamp: new Date().toISOString(),
        units: idleUnits.map(u => ({ id: u.id, type: u.type, lat: u.lat, lng: u.lng })),
        incidents: activeIncidents.map(i => ({ id: i.id, type: i.type, req: i.req, lat: i.lat, lng: i.lng }))
    };

    try {
        const response = await fetch(BRAIN_URL, {
            method: "POST", mode: "cors", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`Backend Error: ${response.status}`);
        const result = await response.json();
        
        let bubbleHtml = "";
        
        const title = AI_MODE === 'AUTO' ? '🎙️ Central (AI Pilot)' : '💡 Co-Pilot Suggestion';
        const reasoningText = result.reasoning || "No reasoning provided.";
        
        bubbleHtml += `<div class="bubble-header">${title}</div>`;
        bubbleHtml += `<div class="bubble-text">${reasoningText}</div>`;

        if (result.commands && Array.isArray(result.commands) && result.commands.length > 0) {
            result.commands.forEach(cmdStr => {
                const parts = cmdStr.split(' ');
                if (parts.length >= 6 && parts[0] === '/send') {
                    const uId = parts[2]; 
                    const iId = parts[5]; 
                    
                    const targetInc = activeIncidents.find(i => i.id === iId);
                    const incName = targetInc ? targetInc.type : "INCIDENT";
                    
                    bubbleHtml += `
                    <div class="action-block">
                        <div>
                            <span class="action-target">${uId}</span>
                            <span class="action-arrow">➔</span> 
                            <span class="action-id">${incName} <span style="font-weight:normal;opacity:0.7">#${String(iId).slice(-4)}</span></span>
                        </div>
                        <div style="font-size:0.7rem; color:#888;">${AI_MODE === 'AUTO' ? 'SENT' : 'REC'}</div>
                    </div>`;

                    if (AI_MODE === 'AUTO') {
                        dispatchUnitBackend(uId, iId);
                    }
                }
            });
        }

        if (window.lastAIReasoning !== JSON.stringify(result)) {
            window.lastAIReasoning = JSON.stringify(result);
            if(window.logToChat) window.logToChat(null, bubbleHtml, 'ai');
        }

    } catch (err) { console.error("⚠️ AI Connection Failed:", err); }
}