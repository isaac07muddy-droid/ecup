// ---- eKombe data store ----
// Persistence has two modes, chosen automatically:
//   • DATABASE_URL set  -> PostgreSQL (permanent; survives restarts/sleep)  [Phase 2]
//   • otherwise         -> local JSON file (simple; resets on restart)      [dev/Phase 1]
// The whole dataset is kept in memory and saved as one JSON document, so every
// store method below stays synchronous and unchanged between the two modes.
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_PATH || path.join(__dirname, 'ekombe-data.json');
const USE_DB = !!process.env.DATABASE_URL;
let pool = null;
const evMem = new Map(); let evSeq = 0; // evidence store for local (file) mode

let data = { users:[], tournaments:[], registrations:[], transactions:[], battles:[], seq:0 };

function ensureShape(){
  data.users=data.users||[]; data.tournaments=data.tournaments||[];
  data.registrations=data.registrations||[]; data.transactions=data.transactions||[];
  data.battles=data.battles||[]; data.resetCodes=data.resetCodes||{}; data.seq=data.seq||0;
}

// Load existing data before the server starts accepting requests.
async function init(){
  if(USE_DB){
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({ connectionString:url, ssl: local ? false : { rejectUnauthorized:false } });
    await pool.query('CREATE TABLE IF NOT EXISTS kv_store (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS evidence (id SERIAL PRIMARY KEY, kind TEXT, ref_id INT, uploader TEXT, mime TEXT NOT NULL, image TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())');
    const r = await pool.query("SELECT data FROM kv_store WHERE id='ekombe'");
    if(r.rows.length){ data = r.rows[0].data; }
    else { await pool.query("INSERT INTO kv_store(id,data) VALUES('ekombe',$1)", [JSON.stringify(data)]); }
    ensureShape();
    console.log('eKombe store: PostgreSQL connected — data is permanent.');
  } else {
    try { if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE,'utf8')); }
    catch(e){ console.error('store load failed, starting fresh', e.message); }
    ensureShape();
    console.log('eKombe store: local file — data resets when the server restarts.');
  }
}

let saveTimer=null;
function persist(){
  if(USE_DB){
    pool.query("INSERT INTO kv_store(id,data) VALUES('ekombe',$1) ON CONFLICT (id) DO UPDATE SET data=$1",
      [JSON.stringify(data)]).catch(e=>console.error('DB save failed:', e.message));
  } else {
    try { fs.writeFileSync(FILE, JSON.stringify(data)); } catch(e){ console.error('file save failed:', e.message); }
  }
}
function save(){ // debounce bursts
  if(saveTimer) return;
  saveTimer=setTimeout(()=>{ saveTimer=null; persist(); }, 150);
}
function saveNow(){ if(saveTimer){clearTimeout(saveTimer);saveTimer=null;} persist(); }
const id = () => ++data.seq;

const store = {
  // ---- users ----
  createUser({name,email,password,country,phone}){
    const u={ id:id(), name, email:email.toLowerCase(), password,
      country:country||'TZ', phone:phone||null, avatar:null, wins:0, losses:0, played:0, created_at:new Date().toISOString() };
    data.users.push(u); save(); return u;
  },
  userByEmail(email){ return data.users.find(u=>u.email===String(email||'').toLowerCase()); },
  userById(uid){ return data.users.find(u=>u.id===uid); },
  addResult(uid, win){ const u=this.userById(uid); if(!u) return; u.played++; if(win)u.wins++; else u.losses++; save(); },
  setPassword(uid, hash){ const u=this.userById(uid); if(u){ u.password=hash; save(); } return u; },
  setAvatar(uid, evidenceId){ const u=this.userById(uid); if(u){ u.avatar=evidenceId; save(); } return u; },
  // ---- password-reset codes (short-lived) ----
  setResetCode(email, hash, expires){ data.resetCodes[String(email).toLowerCase()]={hash,expires,tries:0}; save(); },
  getResetCode(email){ return data.resetCodes[String(email).toLowerCase()]||null; },
  bumpResetTries(email){ const r=data.resetCodes[String(email).toLowerCase()]; if(r){ r.tries++; save(); } },
  clearResetCode(email){ delete data.resetCodes[String(email).toLowerCase()]; save(); },
  topPlayers(limit){ return data.users.slice().sort((a,b)=> b.wins-a.wins || a.played-b.played).slice(0,limit); },
  allUsers(){ return data.users.slice(); },

  // ---- tournaments ----
  createTournament(t){
    const row={ id:id(), name:t.name, format:t.format, size:t.size||8, paid:t.paid?1:0, entry:t.entry||0,
      country:t.country||'TZ', status:'open', champion:null, owner_id:t.owner_id, logo:t.logo||null, bracket:null, created_at:new Date().toISOString() };
    data.tournaments.push(row); save(); return row;
  },
  listTournaments(){ return data.tournaments.slice().sort((a,b)=>b.id-a.id); },
  tournament(tid){ return data.tournaments.find(t=>t.id===Number(tid)); },
  updateTournament(tid, patch){ const t=this.tournament(tid); if(t){ Object.assign(t,patch); save(); } return t; },

  // ---- registrations ----
  addRegistration(tid,uid,display,paid_status,status){
    data.registrations.push({ id:id(), tournament_id:Number(tid), user_id:uid, display_name:display, paid_status, status:status||'approved' });
    save();
  },
  regs(tid){ return data.registrations.filter(r=>r.tournament_id===Number(tid)); },
  players(tid){ return this.regs(tid).filter(r=>r.status!=='pending').map(r=>r.display_name); }, // approved only
  pendingRegs(tid){ return this.regs(tid).filter(r=>r.status==='pending'); },
  approveReg(tid,uid){ const r=this.regByUser(tid,uid); if(r){ r.status='approved'; save(); } return r; },
  removeReg(tid,uid){ data.registrations=data.registrations.filter(r=>!(r.tournament_id===Number(tid)&&r.user_id===uid)); save(); },
  regByName(tid,name){ return data.registrations.find(r=>r.tournament_id===Number(tid) && r.display_name===name); },
  regByUser(tid,uid){ return data.registrations.find(r=>r.tournament_id===Number(tid) && r.user_id===uid); },

  // ---- battles (free 1v1 quick matches) ----
  createBattle({host_id, host_name, country}){
    const b={ id:id(), host_id, host_name, opp_id:null, opp_name:null, status:'open',
      winner_id:null, winner_name:null, s1:null, s2:null, country:country||'TZ', created_at:new Date().toISOString() };
    data.battles.push(b); save(); return b;
  },
  listBattles(){ return data.battles.slice().sort((a,b)=>b.id-a.id); },
  battle(bid){ return data.battles.find(b=>b.id===Number(bid)); },
  updateBattle(bid,patch){ const b=this.battle(bid); if(b){ Object.assign(b,patch); save(); } return b; },

  // ---- transactions (pass-through ledger) ----
  addTx({user_id,tournament_id,type,amount,currency,status}){
    data.transactions.push({ id:id(), user_id:user_id||null, tournament_id:tournament_id||null, type, amount,
      currency:currency||'TZS', status:status||'pending', created_at:new Date().toISOString() });
    save();
  },
  txByUser(uid){ return data.transactions.filter(t=>t.user_id===uid).sort((a,b)=>b.id-a.id).slice(0,100); },

  // ---- evidence (match-proof screenshots; stored outside the main blob) ----
  async saveEvidence({kind,ref_id,uploader,mime,image}){
    if(USE_DB){
      const r=await pool.query("INSERT INTO evidence(kind,ref_id,uploader,mime,image) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [kind||'match', ref_id||null, uploader||null, mime, image]);
      return r.rows[0].id;
    }
    const id=++evSeq; evMem.set(id,{mime,image}); return id;
  },
  async getEvidence(id){
    if(USE_DB){
      const r=await pool.query("SELECT mime,image FROM evidence WHERE id=$1",[Number(id)]);
      return r.rows[0]||null;
    }
    return evMem.get(Number(id))||null;
  },

  init, saveNow
};

module.exports = store;
