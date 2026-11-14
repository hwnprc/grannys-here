import {DEFAULTS} from './config.js';
import {createMemory,sampleProblem,distanceMeters,advanceReturn} from './vexo-data.js';

// An extractive preview: every word remains checkable against the saved transcript.
export function reminderExcerpt(text) {
  const excerpt=text.trim().slice(0,280);
  if(!excerpt)throw new Error('No transcribed words to remember yet.');
  const boundary=excerpt.lastIndexOf(' ');
  return text.trim().length>280&&boundary>180?excerpt.slice(0,boundary):excerpt;
}

export function createLocatedMemory(c,{startFix,endFix,samples=[],name=''},now=Date.now()) {
  if(c.source!=='vexo'||!c.sourceId||!Number.isFinite(c.captureStartedAt))throw new Error('Automatic saving needs a fresh live band recording.');
  const startProblem=sampleProblem(startFix,c.captureStartedAt);
  const endProblem=sampleProblem(endFix,now);
  if(startProblem||endProblem)throw new Error(startProblem||endProblem);
  if(endFix.timestamp<c.captureStartedAt||now-c.captureStartedAt>180000)throw new Error('Location did not match this recording’s time. Review the place manually.');
  for(const p of [endFix,...samples]){
    if(sampleProblem(p,p.timestamp)||p.timestamp<startFix.timestamp||p.timestamp>endFix.timestamp+1000||distanceMeters(startFix,p)+startFix.accuracy+p.accuracy>DEFAULTS.radius)
      throw new Error('Your location moved or was too uncertain during recording. Review the place manually.');
  }
  const excerpt=reminderExcerpt(c.originalText);
  const memory=createMemory(c,{...startFix,name:name.trim()||'This place',capturedAt:startFix.timestamp,
    coordinateSource:'companion-device',confirmed:true,excerpt,
    reminder:`Last time you were here, you were talking about this: “${excerpt}”`,radius:DEFAULTS.radius},now);
  memory.place.association='live-device-location';
  memory.place.recordingEndFix=endFix;
  memory.state=advanceReturn(memory.state,memory.place,endFix,now,{radius:memory.radius}).state;
  return memory;
}

export function sendReturnNotification(memory,{NotificationType=globalThis.Notification,simulated=false,onClick=()=>{}}={}) {
  if(!NotificationType||NotificationType.permission!=='granted')return false;
  try{
    const notification=new NotificationType(`${simulated?'DEMO · ':''}Welcome back to ${memory.place.name}`,{
      body:memory.reminder,tag:`before-i-forget:${simulated?'demo:':''}${memory.id}`
    });
    notification.onclick=()=>{notification.close();onClick();};
    return true;
  }catch{return false;} // In-page reminders continue when desktop notifications are unavailable.
}
