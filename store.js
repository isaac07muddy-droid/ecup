// ---- eKombe data store (pure-JS, zero native deps) ----
// Persists to a single JSON file. Simple and dependency-free so `npm install`
// never needs a compiler. For large scale, swap this module for PostgreSQL
// (the shapes below map directly to tables).
const fs = require('fs');
const path = require('path');

const FILE = process.env.DB_PATH || path.join(__dirname, 'ekombe-data.json');

let data = { users:[], tournaments:[], registrations:[], transactions:[], seq:0 };
try { if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE,'utf8')); } catch(e){ console.error('store load failed, starting fresh', e.message); }

let saveTimer=null;
function save(){
  // debounce writes a touch to avoid hammering disk under bursts
  if(saveTimer) return;
  saveTimer=setTimeout(()=>{ saveTimer=null; fs.writeFileSync(FILE, JSON.stringify(data)); }, 30);
}
function saveNow(){ if(saveTimer){clearTimeout(saveTimer);saveTimer=null;} fs.writeFileSync(FILE, JSON.stringify(data)); }
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
  topPlayers(limit){ return data.users.slice().sort((a,b)=> b.wins-a.wins || a.played-b.played).slice(0,limit); },

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

  // ---- transactions (pass-through ledger) ----
  addTx({user_id,tournament_id,type,amount,currency,status}){
    data.transactions.push({ id:id(), user_id:user_id||null, tournament_id:tournament_id||null, type, amount,
      currency:currency||'TZS', status:status||'pending', created_at:new Date().toISOString() });
    save();
  },
  txByUser(uid){ return data.transactions.filter(t=>t.user_id===uid).sort((a,b)=>b.id-a.id).slice(0,100); },

  saveNow
};

module.exports = store;
