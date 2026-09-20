// Dedicated disposable database and independent psql backends. Unix /tmp sockets
// only: this helper intentionally cannot be pointed at the production project.
const {spawn,spawnSync}=require('node:child_process');
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
function createHarness(prefix){
 const bin=process.env.JKCREW_PG_BIN,socket=process.env.JKCREW_PG_SOCKET,port=process.env.JKCREW_PG_PORT||'55439';
 assert(bin&&path.isAbsolute(bin),'Supply the temporary PostgreSQL binary directory');
 assert(socket&&/^\/(?:private\/)?tmp\//.test(socket),'Only a /tmp Unix socket is allowed');assert(/^[a-z_]+$/.test(prefix));
 const database=`jkcrew_${prefix}_${process.pid}`,psql=path.join(bin,'psql'),connections=[];
 const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-p',port,'-U',os.userInfo().username];
 function batch(sql,db=database){const result=spawnSync(psql,[...args,'-d',db],{input:sql,encoding:'utf8',maxBuffer:8e6});if(result.status!==0)throw Error(result.stderr||result.error?.message||`psql exit ${result.status}`);return result.stdout.trim();}
 batch(`create database ${database};`,'postgres');
 class Connection{
  constructor(name){this.name=`${database}_${name}`;this.proc=spawn(psql,[...args,'-d',database],{env:{...process.env,PGAPPNAME:this.name}});this.buffer='';this.errors='';this.counter=0;this.pending=null;this.closed=false;this.proc.stdout.setEncoding('utf8');this.proc.stderr.setEncoding('utf8');this.proc.stdout.on('data',text=>{this.buffer+=text;this.drain();});this.proc.stderr.on('data',text=>{this.errors+=text;});this.proc.on('error',error=>this.fail(error));this.proc.on('exit',code=>{this.closed=true;this.fail(Error(this.errors||`psql exited ${code}`));});connections.push(this);}
  fail(error){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}}
  drain(){if(!this.pending)return;const at=this.buffer.indexOf(this.pending.marker);if(at<0)return;const value=this.buffer.slice(0,at).trim();this.buffer=this.buffer.slice(at+this.pending.marker.length).replace(/^\r?\n/,'');const {resolve,timer}=this.pending;clearTimeout(timer);this.pending=null;resolve(value);}
  query(sql){assert(!this.pending,'One query at a time per connection');if(this.closed)return Promise.reject(Error('Connection closed'));const marker=`__jkcrew_${++this.counter}__`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.proc.kill();this.fail(Error(`Timed out: ${this.name}`));},12000);this.pending={marker,resolve,reject,timer};this.proc.stdin.write(`${sql}\n\\echo ${marker}\n`);});}
  async close(){if(this.closed)return;this.proc.stdin.write('rollback;\n\\q\n');await new Promise(resolve=>this.proc.once('exit',resolve));}
 }
 const control=new Connection('control');
 return {database,batch,connect:name=>new Connection(name),control,
  adapter:{async exec(sql){return batch(sql.replace(/create role (anon|authenticated|service_role)( bypassrls)?;/g,(_,name,extra='')=>`do $$begin if not exists(select 1 from pg_roles where rolname='${name}') then create role ${name}${extra};end if;end$$;`));}},
  async waitLock(conn){const deadline=Date.now()+5000;while(Date.now()<deadline){if(await control.query(`select coalesce((select wait_event_type='Lock' from pg_stat_activity where application_name=${literal(conn.name)}),false);`)==='t')return;await new Promise(r=>setTimeout(r,25));}throw Error(`${conn.name} did not overlap on a real PostgreSQL lock`);},
  count:()=>connections.length,
  async close(){await Promise.all(connections.map(c=>c.close().catch(()=>{})));batch(`drop database if exists ${database} with (force);`,'postgres');}
 };
}
const json=text=>JSON.parse(text.trim().split('\n').filter(Boolean).at(-1));
module.exports={createHarness,literal,json};
