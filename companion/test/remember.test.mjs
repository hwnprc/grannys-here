import {test} from 'node:test';
import assert from 'node:assert/strict';
import {conversation,advanceReturn,readStore} from '../public/vexo-data.js';
import {createLocatedMemory,reminderExcerpt,sendReturnNotification} from '../public/vexo-remember.js';
const now=1800000000000;
const startFix={lat:37.79,lon:-122.42,accuracy:10,timestamp:now-21000};
const endFix={...startFix,timestamp:now};
const recording=()=>conversation({source:'vexo',sourceId:'band-25:test-session',captureStartedAt:now-20000,originalText:'We talked about visiting the park with Alex on Sunday.'},now);
test('live words auto-save at contemporaneous place, with a departure baseline',()=>{
  const m=createLocatedMemory(recording(),{startFix,endFix,name:'The café'},now);
  assert.equal(m.place.association,'live-device-location');assert.equal(m.place.name,'The café');
  assert.equal(m.excerpt,m.conversation.originalText);assert.ok(m.reminder.includes(m.excerpt));
  assert.equal(m.state.phase,'waiting-departure');assert.equal(m.state.lastNotifiedAt,null);
  assert.equal(readStore(JSON.stringify({version:3,memories:[m]})).memories[0].place.association,'live-device-location');
});
test('auto-saved memory needs an observed exit and sustained return, then fires once',()=>{
  const m=createLocatedMemory(recording(),{startFix,endFix},now);
  let result=advanceReturn(m.state,m.place,{...endFix,lat:37.80,timestamp:now+1000},now+1000);
  assert.equal(result.notify,false);assert.equal(result.state.phase,'armed');
  result=advanceReturn(result.state,m.place,{...endFix,timestamp:now+2000},now+2000);
  assert.equal(result.notify,false);
  result=advanceReturn(result.state,m.place,{...endFix,timestamp:now+7000},now+7000);
  assert.equal(result.notify,true);
  result=advanceReturn(result.state,m.place,{...endFix,timestamp:now+8000},now+8000);
  assert.equal(result.notify,false);
});
test('stale, inaccurate or differently timed locations cannot auto-save',()=>{
  for(const changed of [{startFix:{...startFix,timestamp:now-120000}},{endFix:{...endFix,accuracy:400}},{endFix:{...endFix,timestamp:now-60000}}])
    assert.throws(()=>createLocatedMemory(recording(),{startFix,endFix,...changed},now));
  assert.throws(()=>createLocatedMemory({...recording(),source:'manual'},{startFix,endFix},now),/live band/);
});
test('movement during recording requires review even if user ends where they started',()=>{
  assert.throws(()=>createLocatedMemory(recording(),{startFix,endFix,samples:[{...endFix,lat:37.80,timestamp:now-10000}]},now),/moved/);
  assert.throws(()=>createLocatedMemory(recording(),{startFix,endFix:{...endFix,lat:37.80}},now),/moved/);
});
test('reminders contain only an exact bounded excerpt, never an invented topic',()=>{
  const text='A long real phrase. '.repeat(40);const excerpt=reminderExcerpt(text);
  assert.ok(text.includes(excerpt));assert.ok(excerpt.length<=280);
  const m=createLocatedMemory({...recording(),originalText:text},{startFix,endFix},now);
  assert.ok(m.reminder.length<=500);assert.throws(()=>reminderExcerpt('  '));
});
test('desktop reminders respect permission and preserve exact reminder content',()=>{
  const m=createLocatedMemory(recording(),{startFix,endFix},now);let sent,clicked=false;
  class FakeNotification{static permission='denied';constructor(title,options){sent={title,options,self:this};}close(){this.closed=true;}}
  assert.equal(sendReturnNotification(m,{NotificationType:FakeNotification}),false);assert.equal(sent,undefined);
  FakeNotification.permission='granted';assert.equal(sendReturnNotification(m,{NotificationType:FakeNotification,simulated:true,onClick:()=>{clicked=true;}}),true);
  assert.match(sent.title,/^DEMO/);assert.equal(sent.options.body,m.reminder);sent.self.onclick();assert.equal(clicked,true);assert.equal(sent.self.closed,true);
});
test('unsupported desktop notifications never break the in-page reminder flow',()=>{
  class Unsupported{static permission='granted';constructor(){throw new Error('unsupported');}}
  assert.equal(sendReturnNotification({},{NotificationType:null}),false);
  assert.equal(sendReturnNotification({place:{name:'Test'}},{NotificationType:Unsupported}),false);
});
