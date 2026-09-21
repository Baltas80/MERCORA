import { spawn } from 'node:child_process';
import { createSessionToken, hashSessionToken, sessionCookie } from './session.js';
import { hashPassword, verifyPassword } from './password.js';

const SESSION_MAX_AGE=60*60*24*7;
const USERNAME_RE=/^[a-z0-9][a-z0-9_-]{2,31}$/;

function assertUsername(value){
  const username=String(value||'').trim().toLowerCase();
  if(!USERNAME_RE.test(username)) throw new Error('username must be 3-32 lowercase letters, numbers, _ or -');
  return username;
}
function assertPassword(value){
  if(typeof value!=='string'||value.length<12||value.length>256) throw new Error('password must contain 12-256 characters');
  return value;
}
function connection(databaseUrl){
  if(!databaseUrl) throw new Error('database is not configured');
  let url;try{url=new URL(databaseUrl);}catch{throw new Error('database configuration is invalid');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname) throw new Error('database configuration is invalid');
  const database=decodeURIComponent(url.pathname.replace(/^\//,''));
  if(!database) throw new Error('database configuration is invalid');
  return {
    args:['-X','-q','-At','-v','ON_ERROR_STOP=1','--host',url.hostname,'--port',url.port||'5432','--username',decodeURIComponent(url.username),'--dbname',database],
    env:{...process.env,PGAPPNAME:'mercora-auth',PGPASSWORD:decodeURIComponent(url.password||'')}
  };
}
function runner(file,args,options={}){
  return new Promise(resolve=>{
    const child=spawn(file,args,{cwd:options.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:options.env||process.env});
    const out=[];const err=[];
    child.stdout.on('data',c=>out.push(c));child.stderr.on('data',c=>err.push(c));
    child.on('error',e=>resolve({ok:false,code:null,stdout:'',stderr:e.message}));
    child.on('close',code=>resolve({ok:code===0,code,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')}));
  });
}
function parseRow(stdout){
  const value=String(stdout||'').trim();if(!value)return null;
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?(parsed[0]||null):parsed;}catch{throw new Error('database returned invalid authentication JSON');}
}
function cleanError(text){
  return String(text||'').split(/\r?\n/).filter(line=>!/(password|secret|token|private.?key|mnemonic|authorization|database_url)/i.test(line)).join(' ').slice(0,1200);
}
export function createAuthApi({databaseUrl=process.env.DATABASE_URL,runner:exec=runner}={}){
  async function query(statement,variables={}){
    const c=connection(databaseUrl),args=[...c.args];
    for(const [key,value] of Object.entries(variables))args.push('-v',key+'='+String(value));
    args.push('-c',statement);
    const result=await exec('psql',args,{env:c.env});
    if(!result.ok)throw new Error(cleanError(result.stderr||result.stdout||'database operation failed'));
    return result.stdout;
  }
  async function createSession(accountId){
    const token=createSessionToken(),tokenHash=hashSessionToken(token);
    const row=parseRow(await query(
      "INSERT INTO sessions(account_id,token_hash,expires_at) VALUES (:'account_id'::uuid,:'token_hash',now()+interval '7 days') RETURNING id,expires_at",
      {account_id:accountId,token_hash:tokenHash}
    ));
    return {token,cookie:sessionCookie(token,SESSION_MAX_AGE),expiresAt:row?.expires_at||null};
  }
  async function register({username,password}={}){
    const user=assertUsername(username),pass=assertPassword(password),passwordHash=await hashPassword(pass);
    const row=parseRow(await query(
      "INSERT INTO accounts(username,password_hash,status) VALUES (:'username',:'password_hash','active') ON CONFLICT(username) DO NOTHING RETURNING id,username,status,created_at",
      {username:user,password_hash:passwordHash}
    ));
    if(!row){const error=new Error('username is already registered');error.code='CONFLICT';throw error;}
    return {account:row,session:await createSession(row.id)};
  }
  async function login({username,password}={}){
    const user=assertUsername(username),pass=assertPassword(password);
    const row=parseRow(await query(
      "SELECT id,username,password_hash,status,created_at FROM accounts WHERE username=:'username' LIMIT 1",
      {username:user}
    ));
    if(!row||!(await verifyPassword(pass,row.password_hash))){const error=new Error('invalid username or password');error.code='AUTH_FAILED';throw error;}
    if(row.status!=='active'){const error=new Error('account is not active');error.code='ACCOUNT_BLOCKED';throw error;}
    delete row.password_hash;
    return {account:row,session:await createSession(row.id)};
  }
  async function me(token){
    if(typeof token!=='string'||token.length<40)return null;
    const tokenHash=hashSessionToken(token);
    const row=parseRow(await query(
      "SELECT a.id,a.username,a.status,a.created_at,s.expires_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=:'token_hash' AND s.revoked_at IS NULL AND s.expires_at>now() LIMIT 1",
      {token_hash:tokenHash}
    ));
    if(!row)return null;
    await query("UPDATE sessions SET last_seen_at=now() WHERE token_hash=:'token_hash' AND revoked_at IS NULL",{token_hash:tokenHash});
    return row;
  }
  async function logout(token){
    if(typeof token!=='string'||token.length<40)return;
    const tokenHash=hashSessionToken(token);
    await query("UPDATE sessions SET revoked_at=now() WHERE token_hash=:'token_hash' AND revoked_at IS NULL",{token_hash:tokenHash});
  }
  return Object.freeze({register,login,me,logout});
}
