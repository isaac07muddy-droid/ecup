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

let data = { users:[], tournaments:[], registrations:[], transactions:[], battles:[], seq:0 };

function ensureShape(){
  data.users=data.users||[]; data.tournaments=data.tournaments||[];
  data.registrations=data.registrations||[]; data.transactions=data.transactions||[];
  data.battles=data.battles||[]; data.seq=data.seq||0;
}

// Load existing data before the server starts accepting requests.
async function init(){
  if(USE_DB){
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({ connectionString:url, ssl: local ? false : { rejectUnauthorized:false } });
    await pool.query('CREATE TABLE IF NOT EXISTS kv_store (id TEXT PRIMARY KEY, data JSONB NOT NULL)');
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
      country:country||'TZ', phone:phone||null, wins:0, losses:0, played:0, created_at:new Date().toISOString() };
    data.users.push(u); save(); return u;
  },
  userByEmail(email){ return data.users.find(u=>u.email===String(email||'').toLowerCase()); },
  userById(uid){ return data.users.find(u=>u.id===uid); },
  addResult(uid, win){ const u=this.userById(uid); if(!u) return; u.played++; if(win)u.wins++; else u.losses++; save(); },
  setPassword(uid, hash){ const u=this.userById(uid); if(u){ u.password=hash; save(); } return u; },
  topPlayers(limit){ return data.users.slice().sort((a,b)=> b.wins-a.wins || a.played-b.played).slice(0,limit); },
  allUsers(){ return data.users.slice(); },

  // ---- tournaments ----
  createTournament(t){
    const row={ id:id(), name:t.name, format:t.format, size:t.size||8, paid:t.paid?1:0, entry:t.entry||0,
      country:t.country||'TZ', status:'open', champion:null, owner_id:t.owner_id, bracket:null, created_at:new Date().toISOString() };
    data.tournaments.push(row); save(); return row;
  },
  listTournaments(){ return data.tournaments.slice().sort((a,b)=>b.id-a.id); },
  tournament(tid){ return data.tournaments.find(t=>t.id===Number(tid)); },
  updateTournament(tid, patch){ const t=this.tournament(tid); if(t){ Object.assign(t,patch); save(); } return t; },

  // ---- registrations ----
  addRegistration(tid,uid,display,paid_status){
    data.registrations.push({ id:id(), tournament_id:Number(tid), user_id:uid, display_name:display, paid_status });
    save();
  },
  regs(tid){ return data.registrations.filter(r=>r.tournament_id===Number(tid)); },
  players(tid){ return this.regs(tid).map(r=>r.display_name); },
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

  init, saveNow
};

module.exports = store;
