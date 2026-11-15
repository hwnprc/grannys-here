import {BAND_NUMBER,STORAGE_KEY,DEFAULTS} from './config.js';
import {SOURCES,conversation,createMemory,readStore,newReturnState,resumeReturnState,advanceReturn,snoozeReturn,sampleProblem} from './vexo-data.js';
import {VexoCapture,checkSpeechConnection} from './vexo-capture.js';
import {createLocatedMemory,reminderExcerpt,sendReturnNotification} from './vexo-remember.js';
const $=id=>document.getElementById(id);
const fmt=t=>t===null||t===undefined?'Unknown':new Date(t).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
let store={version:3,memories:[]},storageReady=true,selected=null,anchor=null,watchId=null,watchRunning=false,key='',activeReminder=null,editingId=null;
const demoStates=new Map();const reminders=[];let demoTimers=new Set();
let liveContext=null,quickBusy=false,saving=false,startRequest=0;
let keyChecking=false,keyVerified=false,keyCheckRequest=0,voiceTest=false;
function notice(message,error=false){$('notice').textContent=message;$('notice').className=`notice${error?' error':''}`;$('notice').hidden=false;}
const action=fn=>async event=>{try{await fn(event);}catch(e){notice(e.message||'Something went wrong. Please try again.',true);}};
try{store=readStore(localStorage.getItem(STORAGE_KEY));}catch(e){storageReady=false;notice(e.message,true);}
function persist(){if(!storageReady)throw new Error('Saved data is unavailable. Export it before changing this browser’s storage.');localStorage.setItem(STORAGE_KEY,JSON.stringify(store));}
function setSource(source){for(const b of document.querySelectorAll('[data-source]')){const active=b.dataset.source===source;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$(`source-${b.dataset.source}`).hidden=!active;}}
for(const b of document.querySelectorAll('[data-source]')){
  b.addEventListener('click',()=>setSource(b.dataset.source));
  b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-source]')];const next=tabs[(tabs.indexOf(b)+(e.key==='ArrowRight'?1:2))%3];setSource(next.dataset.source);next.focus();});
}
function useConversation(c){selected=c;anchor=null;$('memory-form').reset();$('source-badge').textContent=SOURCES[c.source];$('original').textContent=c.originalText;$('excerpt').value=c.originalText.slice(0,10000);$('conversation-meta').textContent=`Conversation date: ${fmt(c.occurredAt)} · Imported: ${fmt(c.receivedAt)}${c.captureStartedAt?` · Live capture started: ${fmt(c.captureStartedAt)} (computer clock)`:''}`;$('editor-empty').hidden=true;$('memory-form').hidden=false;$('anchor-status').textContent='Manual coordinates have unknown accuracy. Use current location at the actual place for GPS reminders.';}
$('use-manual').addEventListener('click',action(()=>{const raw=$('manual-date').value;useConversation(conversation({source:'manual',originalText:$('manual-text').value,occurredAt:raw?new Date(raw).getTime():null}));notice('Manual conversation loaded. Choose an excerpt and confirm the place.');}));
$('load-demo').addEventListener('click',action(()=>{useConversation(conversation({source:'demo',sourceId:'granny-park-v1',originalText:'"Oh, we went every Sunday. Every single Sunday after church I\'d take her down to the lake in the park, the one with the little bridge and the boats you can rent. She was maybe six, seven. She always wanted to feed the ducks, and I always told her not to get too close to the edge, and she never listened, not once. We\'d walk all the way around and she\'d be asleep on my shoulder before we got to the car. The leaves would be down by October and the whole path went gold."',occurredAt:null}));$('person').value='your daughter';$('place-name').value='Stow Lake, Golden Gate Park';$('excerpt').value='She always wanted to feed the ducks, and I always told her not to get too close to the edge, and she never listened, not once.';$('reminder').value='You used to come here with your daughter every Sunday. Would you like to hear that story?';$('latitude').value='37.7701';$('longitude').value='-122.4752';anchor={accuracy:null,capturedAt:null,coordinateSource:'demo-place'};$('anchor-status').textContent='Demo coordinates for Stow Lake. Use the labelled simulation after saving; these are not your GPS location.';notice('Granny\'s story loaded. Review the words and confirm the place to keep it.');}));
const capture=new VexoCapture({onComplete:completeRecording,onChange:s=>{
  $('band-badge').textContent=s.connection==='connected'?'Band connected':s.connection==='connecting'?'Connecting…':'Not connected';$('band-badge').className=`badge ${s.connection==='connected'?'connected':''}`;
  $('connect').hidden=s.connection==='connected';$('connect').disabled=s.connection==='connecting';$('connect-usb').hidden=s.connection==='connected';$('connect-usb').disabled=s.connection==='connecting';$('disconnect').hidden=s.connection!=='connected';
  $('identify').disabled=s.connection!=='connected'||s.recording!=='off';
  const busy=s.recording!=='off'||quickBusy||saving;
  const ready=s.connection==='connected'&&keyVerified&&$('consent').checked&&!keyChecking;
  $('start').disabled=!ready||busy;$('test-voice').disabled=!ready||busy;$('stop').disabled=!quickBusy&&!['listening','starting'].includes(s.recording);
  $('set-key').disabled=busy||keyChecking;$('check-key').disabled=busy||keyChecking||!key;
  $('recording-readiness').textContent=busy?'Recording in progress. Use Stop at any time.':s.connection!=='connected'?'1. Connect band 25.':keyChecking?'Checking Deepgram. The microphone stays off.':!keyVerified?'2. Add your Deepgram key and check the connection.':!$('consent').checked?'3. Confirm recording consent below, then choose Test my voice.':'Ready. Test my voice checks audio for 15 seconds without needing location.';
  $('stop').textContent=voiceTest?'Stop test':$('auto-save').checked?'Stop & save':'Stop';
  $('transport').textContent=s.connection==='connected'?(s.transport==='serial'?'Connected over USB':'Connected over Bluetooth'):'Connect over Bluetooth or USB';
  $('auto-save').disabled=s.recording!=='off'||quickBusy||saving;$('quick-place').disabled=$('auto-save').disabled;
  $('device-status').textContent=s.message;$('battery').textContent=s.battery===null?'Battery not received':`Battery ${s.battery}%`;
  $('live-transcript').textContent=s.text||'Your words will appear here.';$('interim').textContent=s.interim;
  $('recording-status').textContent=s.recording==='listening'?(voiceTest?'VOICE TEST — Speak near band 25 now. Audio goes to Deepgram. Stops automatically after 15 seconds.':'RECORDING — Audio is being sent to Deepgram. Stop at any time.'):s.recording==='starting'?'Connecting to Deepgram. Microphone off.':s.recording==='stopping'?'Stopping microphone and collecting final words…':'Microphone off. Up to 2 minutes per recording. Audio is not saved.';
  $('recording-status').className=`small ${s.recording==='listening'?'recording':''}`;
  $('use-capture').disabled=s.recording!=='off'||!s.text||!s.audioPackets;
  $('receipt').textContent=`Audio received: ${s.audioPackets} packets${s.lastPacketAt?` · Last packet: ${fmt(s.lastPacketAt)}`:''} · Transcript: ${s.lastTranscriptAt?fmt(s.lastTranscriptAt):'none'}`;
}});
$('band-name').textContent=`Vexo-HACK-${String(BAND_NUMBER).padStart(2,'0')}`;
$('connect').addEventListener('click',action(async()=>{await capture.connect();notice('Band 25 connected. Ready to record when you choose.');}));$('connect-usb').addEventListener('click',action(async()=>{await capture.connect('serial');notice('Band 25 connected over USB. Ready to record when you choose.');}));$('disconnect').addEventListener('click',action(()=>capture.disconnect()));$('identify').addEventListener('click',action(()=>capture.identify()));
async function checkKey(){
  const request=++keyCheckRequest;keyChecking=true;keyVerified=false;
  $('key-status').textContent='Checking Deepgram without recording audio…';capture.emit();
  try{
    await checkSpeechConnection({key});if(request!==keyCheckRequest)return;
    keyVerified=true;$('key-status').textContent='Deepgram connection verified. Key stays in this tab only.';
    notice('Deepgram connected successfully. Confirm recording consent, then choose Test my voice.');
  }catch(e){if(request===keyCheckRequest){$('key-status').textContent=e.message;notice(e.message,true);}}
  finally{if(request===keyCheckRequest){keyChecking=false;capture.emit();}}
}
$('set-key').addEventListener('click',action(async()=>{key=$('api-key').value.trim();$('api-key').value='';await checkKey();}));
$('check-key').addEventListener('click',action(checkKey));
$('forget-key').addEventListener('click',action(async()=>{keyCheckRequest++;keyChecking=false;keyVerified=false;await capture.stop();key='';$('api-key').value='';$('key-status').textContent='Key forgotten. Transcription stopped.';capture.emit();}));
$('consent').addEventListener('change',()=>capture.emit());
$('test-voice').addEventListener('click',action(async()=>{
  capture.validateStart({key,consent:$('consent').checked});voiceTest=true;
  try{await capture.start({key,consent:$('consent').checked,maxDurationMs:15000});}
  catch(e){voiceTest=false;capture.emit();throw e;}
}));
$('auto-save').addEventListener('change',()=>{$('start').textContent=$('auto-save').checked?'Record & remember here':'Start transcription';$('stop').textContent=$('auto-save').checked?'Stop & save':'Stop';});
$('start').addEventListener('click',action(startRecording));
$('stop').addEventListener('click',action(async()=>{startRequest++;await capture.stop();}));
$('use-capture').addEventListener('click',action(()=>{useConversation(capture.getConversation());notice('Live band transcript loaded. Review the excerpt and confirm where the conversation happened.');}));
function locationFix(p){return{lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};}
function geolocationError(e){return e.code===1?'Location permission was denied. You can enter coordinates manually and use the labelled demo simulation.':e.code===3?'Location request timed out. Move somewhere with a clearer signal and try again.':'Your device could not determine its location. Try again or enter coordinates manually.';}
async function freshLocation(){
  if(!navigator.geolocation)throw new Error('Location is unavailable in this browser.');
  try{const p=locationFix(await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0})));const problem=sampleProblem(p);if(problem)throw new Error(problem);return p;}
  catch(e){throw new Error(e.code?geolocationError(e):e.message);}
}
function clearCaptureLocation(context){if(context?.watchId!==undefined)navigator.geolocation.clearWatch(context.watchId);}
async function startRecording(){
  capture.validateStart({key,consent:$('consent').checked});
  if(!$('auto-save').checked)return capture.start({key,consent:$('consent').checked});
  if(!storageReady)throw new Error('Saved data is unavailable. Resolve storage before recording a new memory.');
  const request=++startRequest;quickBusy=true;capture.emit();
  try{
    $('quick-status').textContent='Finding this device’s location before recording…';
    const startFix=await freshLocation();
    if(request!==startRequest||document.hidden)throw new Error('Recording cancelled. The microphone stayed off.');
    const context={startFix,samples:[],name:$('quick-place').value,problem:null};liveContext=context;
    context.watchId=navigator.geolocation.watchPosition(raw=>{const p=locationFix(raw);if(p.timestamp>=startFix.timestamp)context.samples.push(p);},e=>{context.problem=geolocationError(e);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    await capture.start({key,consent:$('consent').checked});
    $('quick-status').textContent='Speak near band 25. Stop when finished; your words and this place will be saved together.';
  }catch(e){clearCaptureLocation(liveContext);liveContext=null;$('quick-status').textContent=`${e.message} You can use Test my voice to check audio without location.`;throw e;}
  finally{quickBusy=false;capture.emit();}
}
async function completeRecording(c){
  const context=liveContext;liveContext=null;
  if(voiceTest){
    voiceTest=false;
    if(c){useConversation(c);$('quick-status').textContent='Voice test complete. Check your words below. To save a location memory, use Record & remember here or confirm the place in the editor.';notice('Live band audio was transcribed by Deepgram. Check that the words match what you said.');}
    else {$('quick-status').textContent=capture.state.audioPackets?'Band audio arrived, but no final words were transcribed. Try again and speak close to the band.':'No band audio arrived. Check the USB connection, then try again.';notice($('quick-status').textContent,true);}
    capture.emit();return;
  }
  if(!context)return;
  clearCaptureLocation(context);saving=true;capture.emit();
  try{
    if(!c)throw new Error('No final transcribed words arrived. Nothing was saved.');
    $('quick-status').textContent='Checking the location and saving your memory…';
    if(context.problem)throw new Error(context.problem);
    if(document.hidden)throw new Error('Recording paused when the page was hidden. Review the place before saving.');
    const endFix=await freshLocation();
    if(document.hidden)throw new Error('Page hidden before location could be checked. Review the place before saving.');
    const memory=createLocatedMemory(c,{...context,endFix});
    if(store.memories.some(m=>m.conversation.sourceId===c.sourceId))throw new Error('This recording is already saved.');
    const previous=store.memories;store.memories=[...previous,memory];
    try{persist();}catch(e){store.memories=previous;throw e;}
    renderMemories();startWatch(true);
    $('quick-status').textContent='Saved here. Leave this area and return to see your reminder. Keep this page visible and take this device with you.';
    notice('Memory saved automatically. Return reminders are on.');
  }catch(e){
    if(c){useConversation(c);$('excerpt').value=reminderExcerpt(c.originalText);$('reminder').value=`Last time you were here, you were talking about this: “${$('excerpt').value}”`;$('place-name').value=context.name;}
    $('quick-status').textContent=c?'Your transcript is ready for review. Confirm its place to save it.':'No memory saved.';
    notice(e.message,true);
  }finally{saving=false;capture.emit();}
}
$('current-place').addEventListener('click',action(async()=>{
  if(!navigator.geolocation)throw new Error('Location is unavailable in this browser.');
  $('current-place').disabled=true;
  try{const raw=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));const fix=locationFix(raw);const problem=sampleProblem(fix);if(problem)throw new Error(problem);$('latitude').value=fix.lat;$('longitude').value=fix.lon;anchor={accuracy:fix.accuracy,capturedAt:fix.timestamp,coordinateSource:'current-device'};$('place-confirm').checked=false;$('anchor-status').textContent=`Location from this device · ±${Math.round(fix.accuracy)} m · ${fmt(fix.timestamp)}. Confirm the conversation actually happened here.`;}catch(e){throw new Error(e.code?geolocationError(e):e.message);}finally{$('current-place').disabled=false;}
}));
for(const id of ['latitude','longitude'])$(id).addEventListener('input',()=>{anchor=null;$('place-confirm').checked=false;$('anchor-status').textContent='Manually entered coordinates · Accuracy unknown. GPS reminders need a measured place anchor.';});
$('memory-form').addEventListener('submit',action(e=>{
  e.preventDefault();if(!selected)throw new Error('Choose a conversation first.');
  const memory=createMemory(selected,{name:$('place-name').value,lat:Number($('latitude').value),lon:Number($('longitude').value),...anchor,accuracy:anchor?.accuracy??null,person:$('person').value,excerpt:$('excerpt').value,reminder:$('reminder').value,confirmed:$('place-confirm').checked,radius:Number($('radius').value)});
  const duplicate=store.memories.some(m=>selected.sourceId&&m.conversation.source===selected.source&&m.conversation.sourceId===selected.sourceId&&m.excerpt===memory.excerpt&&m.place.lat===memory.place.lat&&m.place.lon===memory.place.lon);
  if(duplicate)throw new Error('That conversation excerpt is already saved at this place.');
  const previous=store.memories;store.memories=[...previous,memory];try{persist();}catch(e){store.memories=previous;throw e;}
  renderMemories();selected=null;$('memory-form').hidden=true;$('editor-empty').hidden=false;$('source-badge').textContent='Choose a conversation';notice('Memory saved. It will not alert now—first establish your position, leave, and return.');$('memories').scrollIntoView({behavior:'smooth'});
}));
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function button(text,fn,className='text-button'){const node=element('button',text,className);node.type='button';node.addEventListener('click',action(fn));return node;}
function renderMemories(){
  $('nav-count').textContent=store.memories.length;$('export').disabled=!store.memories.length;$('memories-empty').hidden=store.memories.length>0;
  const fragment=document.createDocumentFragment();
  for(const m of store.memories){const card=element('article',undefined,'memory-card');card.dataset.memory=m.id;card.append(element('span',SOURCES[m.conversation.source],'badge'),element('h3',m.place.name),element('p',m.reminder,'reminder-copy'));
    const details=element('details');details.append(element('summary','See the original words'),element('blockquote',m.excerpt),element('p',`Conversation date: ${fmt(m.conversation.occurredAt)} · Received: ${fmt(m.conversation.receivedAt)}`,'small'));
    if(m.person)details.append(element('p',`Confirmed person: ${m.person}`,'small'));
    details.append(element('p',`Coordinates: ${m.place.lat.toFixed(5)}, ${m.place.lon.toFixed(5)} · Radius ${m.radius} m · Place accuracy: ${m.place.accuracy===null?'unknown':`±${Math.round(m.place.accuracy)} m`}`,'small'));
    const originalDetails=element('details');originalDetails.append(element('summary','Full original transcript'),element('pre',m.conversation.originalText));details.append(originalDetails);card.append(details);
    const status=element('p',watchRunning&&m.conversation.source!=='demo'?m.state.status:'GPS reminders paused','small');status.dataset.realStatus=m.id;card.append(status);
    const actions=element('div',undefined,'card-actions');actions.append(button('Edit reminder',()=>{editingId=m.id;$('edit-reminder').value=m.reminder;$('edit-dialog').showModal();}),button('Delete',()=>deleteMemory(m.id)));card.append(actions);
    const demo=element('details',undefined,'demo-controls');demo.append(element('summary','Test a simulated return'));
    demo.append(element('p','Simulated location — demo only. Does not change GPS reminder state.'));
    const controls=element('div',undefined,'button-row');controls.append(button('1. At place',()=>simulate(m.id,'inside'),'secondary'),button('2. Leave',()=>simulate(m.id,'outside'),'secondary'),button('3. Return',()=>simulate(m.id,'return'),'secondary'));
    const ds=element('p',demoStates.get(m.id)?.status||'Begin with “At place”.');ds.dataset.demoStatus=m.id;demo.append(controls,ds);card.append(demo);fragment.append(card);
  }
  $('memory-list').replaceChildren(fragment);
  const canWatch=store.memories.some(m=>m.conversation.source!=='demo'&&Number.isFinite(m.place.accuracy)&&m.place.accuracy<=DEFAULTS.maxAccuracy);
  $('watch').disabled=!watchRunning&&!canWatch;
  if(!watchRunning&&!canWatch)$('watch-status').textContent='First record a conversation and save its measured location. Then return reminders become available.';
}
function deleteMemory(id){if(!confirm('Delete this saved memory and its stored transcript from this browser?'))return;const old=store.memories;store.memories=old.filter(m=>m.id!==id);try{persist();}catch(e){store.memories=old;throw e;}demoStates.delete(id);for(let i=reminders.length-1;i>=0;i--)if(reminders[i].id===id)reminders.splice(i,1);if(activeReminder?.id===id){activeReminder=null;$('return-dialog').close();}renderMemories();notice('Memory deleted from this browser.');}
$('edit-form').addEventListener('submit',action(e=>{e.preventDefault();const m=store.memories.find(x=>x.id===editingId);const text=$('edit-reminder').value.trim();if(!m||!text)throw new Error('Enter a reminder.');const old=m.reminder;m.reminder=text;try{persist();}catch(e){m.reminder=old;throw e;}$('edit-dialog').close();renderMemories();notice('Reminder updated. The original transcript is unchanged.');}));$('cancel-edit').addEventListener('click',()=>$('edit-dialog').close());
function enqueueReminder(m,simulated=false){if(activeReminder?.id===m.id&&activeReminder.simulated===simulated)return;reminders.push({id:m.id,simulated});sendReturnNotification(m,{simulated,onClick:()=>{window.focus();$('memories').scrollIntoView();}});showNextReminder();}
function showNextReminder(){if(activeReminder)return;const next=reminders.shift();if(!next)return;const m=store.memories.find(x=>x.id===next.id);if(!m)return showNextReminder();activeReminder=next;$('return-mode').textContent=next.simulated?'SIMULATED LOCATION — DEMO ONLY':'WELCOME BACK';$('return-place').textContent=m.place.name;$('return-message').textContent=m.reminder;$('return-excerpt').textContent=`“${m.excerpt}”`;$('return-meta').textContent=`${SOURCES[m.conversation.source]} · Conversation date: ${fmt(m.conversation.occurredAt)}`;$('return-dialog').showModal();}
function closeReminder(snooze=false){if(activeReminder&&snooze){const m=store.memories.find(x=>x.id===activeReminder.id);if(m){if(activeReminder.simulated)demoStates.set(m.id,snoozeReturn(demoStates.get(m.id)||newReturnState()));else {m.state=snoozeReturn(m.state);persist();}}}activeReminder=null;$('return-dialog').close();updateStatuses();showNextReminder();}
$('close-return').addEventListener('click',()=>closeReminder());$('dismiss-return').addEventListener('click',()=>closeReminder());$('snooze-return').addEventListener('click',action(()=>closeReminder(true)));$('return-dialog').addEventListener('cancel',e=>{e.preventDefault();closeReminder();});
function updateStatuses(){for(const m of store.memories){const status=document.querySelector(`[data-real-status="${m.id}"]`);if(status)status.textContent=m.conversation.source==='demo'?'Fictional memory · GPS reminders disabled':watchRunning?m.state.status:'GPS reminders paused';const ds=document.querySelector(`[data-demo-status="${m.id}"]`);if(ds)ds.textContent=demoStates.get(m.id)?.status||'Begin with “At place”.';}}
function stopWatch(message='Location reminders paused. Fresh observations will be required when you resume.'){if(watchId!==null)navigator.geolocation.clearWatch(watchId);watchId=null;watchRunning=false;for(const m of store.memories)m.state=resumeReturnState(m.state);$('watch').textContent='Enable location reminders';$('watch-title').textContent='Return reminders are paused';$('watch-status').textContent=message;updateStatuses();}
function startWatch(preserveState=false){
  if(watchRunning)return;
  if(!navigator.geolocation)throw new Error('Location is unavailable in this browser.');
  if(!store.memories.some(m=>m.conversation.source!=='demo'&&m.place.accuracy!==null))throw new Error('Save a real or manually entered conversation with a measured location first. Demo memories use the simulation controls.');
  if(!preserveState)for(const m of store.memories)m.state=resumeReturnState(m.state);
  watchRunning=true;$('watch').textContent='Pause reminders';$('watch-title').textContent='Waiting for your location…';
  watchId=navigator.geolocation.watchPosition(raw=>{
    const p=locationFix(raw),problem=sampleProblem(p);$('watch-title').textContent=problem||'Location reminders are on';$('watch-status').textContent=problem||`Current accuracy ±${Math.round(p.accuracy)} m · Updated ${fmt(p.timestamp)} · Keep this page open.`;
    for(const m of store.memories){if(m.conversation.source==='demo')continue;const result=advanceReturn(m.state,m.place,p,Date.now(),{radius:m.radius});m.state=result.state;if(result.notify)enqueueReminder(m);}
    try{persist();}catch(e){stopWatch('Storage is unavailable. Reminders paused.');notice(e.message,true);}updateStatuses();
  },error=>{stopWatch(geolocationError(error));notice(geolocationError(error),true);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
}
$('watch').addEventListener('click',action(()=>watchRunning?stopWatch():startWatch()));
function notificationStatus(){const permission=globalThis.Notification?.permission;$('notification-status').textContent=permission==='granted'?'Desktop notifications enabled. They include the reminder text; keep this page visible for location tracking.':permission==='denied'?'Desktop notifications are blocked in browser settings. In-page reminders still work.':permission?'Optional: show your reminder text in a desktop notification.':'Desktop notifications are unavailable here. In-page reminders still work.';$('notifications').disabled=!permission||permission==='granted';}
$('notifications').addEventListener('click',action(async()=>{await Notification.requestPermission();notificationStatus();}));
function simulate(id,step){
  const m=store.memories.find(x=>x.id===id);if(!m)return;
  for(const item of [...demoTimers])if(item.id===id){clearTimeout(item.timer);demoTimers.delete(item);}
  const p={...m.place,accuracy:0};const fix={lat:p.lat,lon:p.lon,accuracy:0,timestamp:Date.now()};
  if(step==='outside'){fix.lat=p.lat<=89?p.lat+0.02:p.lat-0.02;}
  const apply=sample=>{if(!store.memories.some(x=>x.id===id))return;const state=demoStates.get(id)||newReturnState();const result=advanceReturn(state,p,sample,sample.timestamp,{radius:m.radius});demoStates.set(id,result.state);updateStatuses();if(result.notify)enqueueReminder(m,true);};
  apply(fix);
  if(step==='return'&&demoStates.get(id)?.phase==='returning'){const pending={id,timer:null};pending.timer=setTimeout(()=>{demoTimers.delete(pending);apply({...fix,timestamp:Date.now()});},DEFAULTS.dwellMs+100);demoTimers.add(pending);}
}
$('export').addEventListener('click',action(()=>{const data={...store,exportedAt:new Date().toISOString(),notes:'Contains private conversation and place information. Keep it somewhere you trust.'};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='before-i-forget-memories.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Your memories were exported as JSON. Keep the file private.');}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){startRequest++;if(liveContext)liveContext.problem='Recording paused when the page was hidden. Review the place before saving.';if(watchRunning)stopWatch('Paused while this page was hidden. Enable again when you are ready.');for(const t of demoTimers)clearTimeout(t.timer);demoTimers.clear();demoStates.clear();void capture.stop().catch(()=>{});}});
window.addEventListener('pagehide',()=>{key='';void capture.disconnect().catch(()=>{});});
renderMemories();setSource('band');notificationStatus();capture.emit();
if(location.protocol==='file:'){
  for(const id of ['connect','connect-usb','api-key','set-key','check-key','start','test-voice','current-place','watch'])$(id).disabled=true;
  setSource('demo');
  $('device-status').textContent='Offline preview. Run npm start and open localhost for hardware and GPS.';
  notice('Offline preview — explore the fictional demo or paste text. For band capture and GPS, run npm start and open http://localhost:3000.');
}
