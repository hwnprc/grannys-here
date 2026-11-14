import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VexoCapture,checkSpeechConnection} from '../public/vexo-capture.js';
import {Band,SimTransport} from '../vexo-open-kit/js/src/index.js';
import {BAND_NUMBER} from '../public/config.js';
function fixture(onComplete){let sim,speechCallbacks,packets=0;const capture=new VexoCapture({onComplete,connectBand:async number=>{assert.equal(number,BAND_NUMBER);sim=new SimTransport(number,{autoTap:false});return Band.connect(number,{transport:sim});},createSpeech:()=>({start(cb){speechCallbacks=cb;cb.onState('listening');},packet(){packets++;},stop(){speechCallbacks.onState('off');}})});return {capture,get sim(){return sim;},get speech(){return speechCallbacks;},get packets(){return packets;}};}
test('confirmed band number is used with real SDK simulator',async()=>{const f=fixture();await f.capture.connect();try{assert.equal(f.capture.band.number,BAND_NUMBER);assert.equal(f.capture.state.connection,'connected');assert.equal(f.capture.state.audioPackets,0);assert.equal(f.capture.state.recording,'off');}finally{await f.capture.disconnect();}});
test('consent and key required before microphone starts',async()=>{const f=fixture();await f.capture.connect();try{await assert.rejects(f.capture.start({key:'test-only',consent:false}),/permission/);await assert.rejects(f.capture.start({key:'',consent:true}),/Deepgram key/);assert.equal(f.capture.state.recording,'off');}finally{await f.capture.disconnect();}});
test('SDK simulated audio reaches speech adapter and final transcript retains provenance',async()=>{const f=fixture();await f.capture.connect();try{await f.capture.start({key:'test-only-not-a-credential',consent:true});await new Promise(r=>setTimeout(r,140));assert.ok(f.packets>0);f.speech.onText({text:'A distinctive simulated test sentence.',final:true,end:1});await f.capture.stop();const c=f.capture.getConversation();assert.equal(c.originalText,'A distinctive simulated test sentence.');assert.equal(c.occurredAt,null);assert.match(c.sourceId,new RegExp(`^band-${BAND_NUMBER}:`));assert.equal(c.segments.length,1);assert.ok(c.captureStartedAt);assert.equal(f.capture.state.recording,'off');}finally{await f.capture.disconnect();}});
test('no audio or no transcript cannot be represented as a band conversation',()=>{const f=fixture();assert.throws(()=>f.capture.getConversation(),/No transcribed/);});
test('completion delivers final words once despite repeated stop and disconnect',async()=>{
  const completed=[];const f=fixture(c=>completed.push(c));await f.capture.connect('serial');
  try{assert.equal(f.capture.state.transport,'serial');await f.capture.start({key:'test-only',consent:true});await new Promise(r=>setTimeout(r,140));f.speech.onText({text:'Remember this actual final test sentence.',final:true});await Promise.all([f.capture.stop(),f.capture.stop()]);await f.capture.stop();assert.equal(completed.length,1);assert.equal(completed[0].originalText,'Remember this actual final test sentence.');}
  finally{await f.capture.disconnect();}assert.equal(completed.length,1);
});
test('empty recording completion supplies no conversation to auto-save',async()=>{const completed=[];const f=fixture(c=>completed.push(c));await f.capture.connect();try{await f.capture.start({key:'test-only',consent:true});await f.capture.stop();assert.deepEqual(completed,[null]);}finally{await f.capture.disconnect();}});
test('wrong reported band disconnects immediately',async()=>{let disconnected=false;const c=new VexoCapture({connectBand:async()=>({number:BAND_NUMBER+1,disconnect:async()=>{disconnected=true;}})});await assert.rejects(c.connect(),/expected band/);assert.equal(disconnected,true);assert.equal(c.state.connection,'disconnected');});
test('transcription errors stop the microphone and preserve final text',async()=>{const f=fixture();await f.capture.connect();try{await f.capture.start({key:'test-only',consent:true});f.speech.onText({text:'Kept before failure.',final:true,end:1});f.speech.onError('closed');await f.capture.stop();assert.equal(f.capture.state.recording,'off');assert.equal(f.capture.state.text,'Kept before failure.');assert.match(f.capture.state.message,/Deepgram/);}finally{await f.capture.disconnect();}});
test('LED feedback is refused while recording',async()=>{const f=fixture();await f.capture.connect();try{await f.capture.start({key:'test-only',consent:true});await assert.rejects(f.capture.identify(),/Stop recording/);}finally{await f.capture.disconnect();}});
test('cancelling during speech connection never starts the microphone',async()=>{let cb;const c=new VexoCapture({connectBand:async n=>Band.connect(n,{transport:new SimTransport(n,{autoTap:false})}),createSpeech:()=>({start(callbacks){cb=callbacks;},stop(){cb.onState('off');}})});await c.connect();const starting=c.start({key:'test-only',consent:true});const rejection=assert.rejects(starting,/cancelled/);await c.stop();await rejection;assert.equal(c.state.recording,'off');await c.disconnect();});
test('speech connection check authenticates and closes without sending audio',async()=>{
  let stopped=0,packets=0,cb;
  await checkSpeechConnection({key:'test-only',createSpeech:()=>({start(callbacks){cb=callbacks;cb.onState('listening');},stop(){stopped++;cb.onState('off');},packet(){packets++;}})});
  assert.equal(stopped,1);assert.equal(packets,0);
});
test('speech connection check rejects a refused credential without exposing it',async()=>{
  const secret='test-only-not-a-key';let stopped=false;
  await assert.rejects(checkSpeechConnection({key:secret,createSpeech:()=>({start(cb){cb.onError(secret);},stop(){stopped=true;}})}),e=>/rejected/.test(e.message)&&!e.message.includes(secret));
  assert.equal(stopped,true);
});
test('speech connection check times out and closes a stalled connection',async()=>{
  let stopped=false;
  await assert.rejects(checkSpeechConnection({key:'test-only',timeoutMs:15,createSpeech:()=>({start(){},stop(){stopped=true;}})}),/did not respond/);
  assert.equal(stopped,true);
});
test('short voice test stops automatically and retains the final transcript',async()=>{
  let finish;const completed=new Promise(r=>finish=r);const f=fixture(finish);await f.capture.connect();
  try{await f.capture.start({key:'test-only',consent:true,maxDurationMs:250});await new Promise(r=>setTimeout(r,100));f.speech.onText({text:'A short voice check.',final:true});const c=await completed;assert.equal(c.originalText,'A short voice check.');assert.equal(f.capture.state.recording,'off');assert.match(f.capture.state.message,/Microphone off/);}
  finally{await f.capture.disconnect();}
});
test('voice test cannot bypass consent or extend the recording limit',async()=>{
  const f=fixture();await f.capture.connect();
  try{await assert.rejects(f.capture.start({key:'test-only',consent:false,maxDurationMs:15000}),/permission/);await assert.rejects(f.capture.start({key:'test-only',consent:true,maxDurationMs:120001}),/duration/);assert.equal(f.capture.state.recording,'off');}
  finally{await f.capture.disconnect();}
});
