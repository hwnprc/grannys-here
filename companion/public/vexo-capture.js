import {Band} from '../vexo-open-kit/js/src/index.js';
import {deepgramLink} from '../vexo-open-kit/dashboard/speech/deepgram.js';
import {BAND_NUMBER} from './config.js';
import {conversation} from './vexo-data.js';

// Authenticate the actual speech connection without enabling the band microphone.
export async function checkSpeechConnection({key,createSpeech=deepgramLink,timeoutMs=10000}={}) {
  if(!key?.trim())throw new Error('Enter your Deepgram key first.');
  const speech=createSpeech({key:key.trim()});
  await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;clearTimeout(timer);
      try{speech.stop();}catch{}
      if(error)reject(new Error(error));else resolve();
    };
    const timer=setTimeout(()=>finish('Deepgram did not respond. Check your connection and try again.'),timeoutMs);
    try{speech.start({
      onState:state=>{if(state==='listening')finish();else if(state==='off')finish('Deepgram closed before connecting. Check the key and try again.');},
      onError:()=>finish('Deepgram rejected the connection. Check the key, project credit and internet connection.'),
      onText:()=>{}
    });}catch{finish('Deepgram could not connect. Check the key and try again.');}
  });
}

export class VexoCapture {
  constructor({connectBand=(number,options)=>Band.connect(number,options),createSpeech=deepgramLink,onChange=()=>{},onComplete=()=>{}}={}) {
    this.connectBand=connectBand;this.createSpeech=createSpeech;this.onChange=onChange;this.onComplete=onComplete;
    this.band=null;this.speech=null;this.session=null;this.stopping=null;this.stopSpeechResolve=null;
    this.state={connection:'disconnected',recording:'off',audioPackets:0,lastPacketAt:null,lastTranscriptAt:null,battery:null,text:'',interim:'',message:'Band not connected'};
  }
  emit(patch={}) {Object.assign(this.state,patch);this.onChange({...this.state});}
  async connect(transport='ble') {
    if(this.band||this.state.connection==='connecting')throw new Error('Disconnect the current session first.');
    if(!['ble','serial'].includes(transport))throw new Error('Unsupported connection type.');
    this.emit({connection:'connecting',message:'Pick your own band in the browser chooser.'});
    try {
      const band=await this.connectBand(BAND_NUMBER,{transport,autoReconnect:false});
      if(band.number!==BAND_NUMBER){await band.disconnect();throw new Error('The device did not report the expected band number. Disconnected.');}
      this.band=band;
      band.on('battery',b=>this.emit({battery:b.percent}));
      band.on('audio',a=>{
        if(!this.session||this.state.recording!=='listening')return;
        if(!(a.opus instanceof Uint8Array)||!a.opus.length)return;
        this.session.audioPackets++;this.speech?.packet(a.opus);
        const time=Date.now();this.state.audioPackets=this.session.audioPackets;this.state.lastPacketAt=time;
        if(this.session.audioPackets===1||this.session.audioPackets%25===0)this.emit();
      });
      band.on('disconnect',()=>{
        this.band=null;this.emit({connection:'disconnected',battery:null,message:'Band disconnected. Reconnect and start a new recording.'});
        void this.stop().catch(()=>{});
      });
      band.on('stream-taken',()=>{this.emit({message:'Another program took the band stream. Close it, then reconnect here.'});void this.stop().catch(()=>{});});
      await band.configure({battery:true,events:true});
      this.emit({connection:'connected',transport,message:`Connected to ${band.name}. Microphone is off.`});
    } catch(e) {if(this.band){const old=this.band;this.band=null;await old.disconnect().catch(()=>{});}this.emit({connection:'disconnected',message:e.message});throw e;}
  }
  async identify() {if(!this.band)throw new Error('Connect your band first.');if(this.state.recording!=='off')throw new Error('Stop recording before changing the light.');await this.band.identify();}
  validateStart({key,consent}) {
    if(!consent)throw new Error('Obtain everyone’s permission before recording and sending audio to Deepgram.');
    if(!this.band)throw new Error('Connect your band first.');
    if(this.state.recording!=='off')throw new Error('A recording is already active.');
    if(!key?.trim())throw new Error('Enter your team’s Deepgram key in the private field. You can use manual text without a key.');
  }
  async start({key,consent,maxDurationMs=120000}) {
    this.validateStart({key,consent});
    if(!Number.isFinite(maxDurationMs)||maxDurationMs<=0||maxDurationMs>120000)throw new Error('Recording duration must be between 1 and 120000 milliseconds.');
    this.session={id:crypto.randomUUID(),startedAt:Date.now(),audioPackets:0,segments:[]};
    this.emit({recording:'starting',audioPackets:0,lastPacketAt:null,lastTranscriptAt:null,text:'',interim:'',message:'Opening transcription. The microphone is still off.'});
    const speech=this.createSpeech({key:key.trim()});this.speech=speech;
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{reject(new Error('Transcription did not connect. Check your key and internet connection.'));},10000);
        this.cancelStart=()=>{clearTimeout(timer);reject(new Error('Recording start cancelled. Microphone off.'));};
        speech.start({
          onState:status=>{
            if(status==='listening'){clearTimeout(timer);this.cancelStart=null;resolve();}
            if(status==='off'){clearTimeout(timer);this.stopSpeechResolve?.();if(this.state.recording==='starting')reject(new Error('Transcription closed before it started.'));}
          },
          onError:()=>{
            clearTimeout(timer);const error=new Error('Deepgram could not continue. Check your team’s key, credit and internet connection.');
            if(this.state.recording==='starting')reject(error);
            else {this.emit({message:error.message});void this.stop().catch(()=>{});}
            this.stopSpeechResolve?.();
          },
          onText:result=>{
            if(!this.session||typeof result.text!=='string')return;
            if(result.final){this.session.segments.push({text:result.text,endSeconds:Number.isFinite(result.end)?result.end:null,receivedAt:Date.now()});this.emit({text:this.session.segments.map(x=>x.text).join(' '),interim:'',lastTranscriptAt:Date.now()});}
            else this.emit({interim:result.text});
          }
        });
      });
      if(!this.band||this.speech!==speech)throw new Error('Band disconnected before recording began.');
      this.emit({recording:'listening',message:'Recording — audio is being sent to Deepgram. The band light is blue.'});
      await this.band.configure({audio:true});
      this.limitTimer=setTimeout(()=>{void this.stop().catch(()=>{});},maxDurationMs);
    } catch(e) {await this.stop();throw e;}
  }
  async stop() {
    if(this.stopping)return this.stopping;
    if(this.state.recording==='off')return;
    this.stopping=this.finish();
    try {await this.stopping;} finally {this.stopping=null;}
  }
  async finish() {
    clearTimeout(this.limitTimer);this.cancelStart?.();this.cancelStart=null;this.emit({recording:'stopping',interim:''});
    try {await this.band?.configure({audio:false,micLevel:false});} catch { // Disconnect stops streams in firmware.
      if(this.band){const old=this.band;this.band=null;await old.disconnect().catch(()=>{});this.emit({connection:'disconnected',message:'Disconnected to stop the microphone.'});}
    }
    const speech=this.speech;
    if(speech)await new Promise(resolve=>{let done=false;const end=()=>{if(done)return;done=true;clearTimeout(timeout);resolve();};const timeout=setTimeout(end,1800);this.stopSpeechResolve=end;speech.stop();});
    this.stopSpeechResolve=null;this.speech=null;
    this.emit({recording:'off',interim:'',message:this.state.message.startsWith('Recording —')?'Recording finished. Microphone off.':this.state.message});
    if(this.session&&!this.session.completed){
      this.session.completed=true;let result=null;
      try{result=this.getConversation();}catch{} // Empty/failed sessions never become saved conversations.
      await this.onComplete(result);
    }
  }
  getConversation() {
    if(this.state.recording!=='off')throw new Error('Stop recording before using the conversation.');
    if(!this.session?.audioPackets||!this.state.text.trim())throw new Error('No transcribed band conversation yet. Speak near the band and try again.');
    return conversation({source:'vexo',sourceId:`band-${BAND_NUMBER}:${this.session.id}`,originalText:this.state.text,segments:this.session.segments,captureStartedAt:this.session.startedAt,timeBasis:'live capture; audio event times are computer receipt times',occurredAt:null});
  }
  async disconnect() {await this.stop();const band=this.band;this.band=null;await band?.disconnect();this.emit({connection:'disconnected',recording:'off',battery:null,message:'Band disconnected. Microphone off.'});}
}
