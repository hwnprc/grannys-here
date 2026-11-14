import {DEFAULTS} from './config.js';
export const SOURCES=Object.freeze({vexo:'Vexo band · live capture',manual:'Manually entered',demo:'Fictional demo'});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const coordinatesValid=p=>!!p&&finite(p.lat)&&finite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
export function distanceMeters(a,b) {
  if(!coordinatesValid(a)||!coordinatesValid(b)) throw new Error('Invalid coordinates.');
  const rad=x=>x*Math.PI/180; const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
}
export function sampleProblem(p,now=Date.now(),settings=DEFAULTS) {
  if(!coordinatesValid(p)) return 'Invalid location coordinates';
  if(!finite(p.timestamp)||p.timestamp>now+1000||now-p.timestamp>settings.maxAgeMs) return 'Waiting for a fresh location';
  if(!finite(p.accuracy)||p.accuracy<0||p.accuracy>settings.maxAccuracy) return 'Waiting for better location accuracy';
  return null;
}
export function newReturnState() {return {phase:'need-presence',pendingSince:null,lastSampleAt:null,lastNotifiedAt:null,snoozeUntil:0,status:'Visit this place once to establish your position'};}
export function resumeReturnState(state={}) {return {...newReturnState(),lastNotifiedAt:state.lastNotifiedAt??null,snoozeUntil:state.snoozeUntil||0};}
export function snoozeReturn(state,now=Date.now(),minutes=10) {return {...state,phase:'waiting-departure',pendingSince:null,snoozeUntil:now+minutes*60000,status:'Snoozed. Leave and return after the snooze ends'};}
export function advanceReturn(previous,place,sample,now=Date.now(),overrides={}) {
  const cfg={...DEFAULTS,...overrides};
  if(![cfg.radius,cfg.exitBuffer,cfg.maxAccuracy,cfg.dwellMs,cfg.maxAgeMs,cfg.maxGapMs].every(finite)||cfg.radius<=0||cfg.exitBuffer<0||cfg.dwellMs<0) throw new Error('Invalid return settings.');
  let state={...previous}; const no=(status)=>({state:{...state,pendingSince:null,phase:state.phase==='returning'?'armed':state.phase,status},notify:false});
  if(!coordinatesValid(place)) return no('This place needs valid coordinates');
  if(!finite(place.accuracy)||place.accuracy<0||place.accuracy>cfg.maxAccuracy) return no('Confirm a better place anchor before using GPS reminders');
  const problem=sampleProblem(sample,now,cfg); if(problem) return no(problem);
  if(state.lastSampleAt!==null&&sample.timestamp<=state.lastSampleAt) return no('Waiting for a newer location');
  const longGap=state.lastSampleAt!==null&&sample.timestamp-state.lastSampleAt>cfg.maxGapMs;
  if(longGap&&state.phase==='returning') {state.phase='armed';state.pendingSince=null;}
  state.lastSampleAt=sample.timestamp;
  const d=distanceMeters(place,sample), uncertainty=place.accuracy+sample.accuracy;
  const inside=d+uncertainty<=cfg.radius, outside=d-uncertainty>=cfg.radius+cfg.exitBuffer;
  if(!inside&&!outside) return no('Near the boundary — waiting for a clearer location');
  if(state.phase==='need-presence') {
    if(inside) {state.phase='waiting-departure';state.status='At this place. Waiting for you to leave';}
    else state.status='Visit this place once before return reminders are armed';
  } else if(outside) {
    state.phase='armed';state.pendingSince=null;state.status='You have left. Ready for your return';
  } else if(state.phase==='armed'||state.phase==='returning') {
    if(now<state.snoozeUntil) return no('Snoozed — waiting for a later visit');
    if(state.pendingSince===null) {state.pendingSince=sample.timestamp;state.phase='returning';state.status='You are back. Confirming your location…';}
    if(sample.timestamp-state.pendingSince>=cfg.dwellMs) {
      state.phase='notified';state.pendingSince=null;state.lastNotifiedAt=now;state.status='Memory recalled. Leave again to re-arm';
      return {state,notify:true,distance:d};
    }
  } else {state.status=state.phase==='notified'?'Memory recalled. Leave again to re-arm':'At this place. Waiting for you to leave';}
  return {state,notify:false,distance:d};
}
function limited(text,max,label) {if(typeof text!=='string'||!text.trim()||text.length>max)throw new Error(`${label} is required (up to ${max} characters).`);return text.trim();}
export function conversation(input,now=Date.now()) {
  if(!Object.hasOwn(SOURCES,input.source))throw new Error('Unknown conversation source.');
  const occurredAt=input.occurredAt??null;
  if(occurredAt!==null&&(!finite(occurredAt)||occurredAt>now+1000))throw new Error('Check the conversation date. Leave it empty if unknown.');
  return {id:input.id||crypto.randomUUID(),source:input.source,sourceId:input.sourceId??null,occurredAt,receivedAt:now,originalText:limited(input.originalText,50000,'Conversation'),segments:Array.isArray(input.segments)?input.segments:[],captureStartedAt:input.captureStartedAt??null,timeBasis:input.timeBasis??'unknown'};
}
// Real source IDs deduplicate only within the same source. Manual entries without IDs remain separate.
export function addConversation(list,item) {const existing=item.sourceId?list.find(x=>x.source===item.source&&x.sourceId===item.sourceId):null;return {items:existing?list:[...list,item],item:existing||item,duplicate:!!existing};}
export function createMemory(c,input,now=Date.now()) {
  if(!input.confirmed)throw new Error('Confirm that this conversation happened at the chosen place.');
  const excerpt=limited(input.excerpt,10000,'Supporting excerpt');
  if(!c.originalText.includes(excerpt))throw new Error('The excerpt must come directly from the original conversation.');
  if(!coordinatesValid(input))throw new Error('Enter valid latitude and longitude.');
  if(input.accuracy!==null&&(!finite(input.accuracy)||input.accuracy<0))throw new Error('Place accuracy is invalid.');
  const radius=Number(input.radius??DEFAULTS.radius);if(!finite(radius)||radius<50||radius>1000)throw new Error('Radius must be between 50 and 1,000 metres.');
  return {id:crypto.randomUUID(),conversation:c,excerpt,reminder:limited(input.reminder,500,'Reminder'),person:(input.person||'').trim().slice(0,120),createdAt:now,radius,place:{id:crypto.randomUUID(),name:limited(input.name,100,'Place name'),lat:input.lat,lon:input.lon,accuracy:input.accuracy,capturedAt:input.capturedAt??null,association:'manually-confirmed',coordinateSource:input.coordinateSource||'manual'},state:newReturnState()};
}
export function readStore(raw) {
  if(!raw)return {version:3,memories:[]};
  const data=JSON.parse(raw);
  if(data.version!==3||!Array.isArray(data.memories))throw new Error('Unrecognised saved data. Existing data has been kept unchanged.');
  if(data.memories.some(m=>typeof m?.id!=='string'||!/^[a-f0-9-]{36}$/i.test(m.id)||!m.place||!coordinatesValid(m.place)||!(m.place.accuracy===null||(finite(m.place.accuracy)&&m.place.accuracy>=0))||!finite(m.radius)||m.radius<50||m.radius>1000||typeof m.place.name!=='string'||!m.conversation||!Object.hasOwn(SOURCES,m.conversation.source)||typeof m.conversation.originalText!=='string'||typeof m.reminder!=='string'||typeof m.excerpt!=='string'||!m.conversation.originalText.includes(m.excerpt)))throw new Error('Saved data could not be read safely. It has been kept unchanged.');
  return {version:3,memories:data.memories.map(m=>({...m,state:resumeReturnState(m.state)}))};
}
