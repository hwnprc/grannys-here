import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://api.deepgram.com; media-src 'self' blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
export function safeFile(pathname) {
  let decoded; try { decoded=decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) return null;
  const relative = decoded==='/' ? 'public/vexo.html' : decoded.startsWith('/vexo-open-kit/js/src/') || decoded==='/vexo-open-kit/dashboard/speech/deepgram.js' ? decoded.slice(1) : `public/${decoded.slice(1)}`;
  if (relative.split('/').some(part=>part.startsWith('.'))) return null;
  if (!MIME[extname(relative)]) return null;
  const full=resolve(ROOT, relative);
  return full.startsWith(ROOT.endsWith(sep)?ROOT:ROOT+sep)?full:null;
}
export async function handleRequest(req,res) {
  const headers={'Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Permissions-Policy':'geolocation=(self), bluetooth=(self), microphone=()','Cross-Origin-Resource-Policy':'same-origin'};
  const send=(code,data,type='text/plain; charset=utf-8')=>{res.writeHead(code,{...headers,'Content-Type':type});res.end(req.method==='HEAD'?undefined:data);};
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')) return send(403,'This app only accepts localhost requests.');
  if (!['GET','HEAD'].includes(req.method)) return send(405,'Method not allowed.');
  let url; try {url=new URL(req.url,`http://${req.headers.host}`);} catch {return send(400,'Invalid request.');}
  if (url.pathname==='/api/health') return send(200,JSON.stringify({ok:true,app:'Before I Forget',mode:'local-only'}),MIME['.json']);
  const file=safeFile(url.pathname); if(!file) return send(404,'Not found.');
  try {return send(200,await readFile(file),MIME[extname(file)]);} catch {return send(404,'Not found.');}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||3000);
  if(!Number.isInteger(port)||port<1||port>65535) throw new Error('PORT must be between 1 and 65535.');
  const server=http.createServer((req,res)=>{handleRequest(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('Unable to serve this request.');});});
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is busy. Run PORT=3001 npm start.`:`Server could not start (${e.code}).`);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Before I Forget — http://localhost:${port}\nLocal only. Band identity is configured in public/config.js.`));
}
