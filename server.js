// ================= eKombe backend =================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const store = require('./store');
const B = require('./bracket');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'ekombe-dev-secret-change-me';
const PAYMENTS_LIVE = false; // flip on once Selcom pass-through is wired
// FREE-ONLY LAUNCH: no money changes hands. All tournaments are free, no fees recorded.
// The pass-through payment code below stays in place, dormant. Set to false (and register
// your business + wire Selcom) to enable paid tournaments later.
const FREE_ONLY = true;

// ---- currency + pass-through fee config (USD base -> local) ----
const CUR = {
  TZ:{code:'TSh',rate:2500}, KE:{code:'KSh',rate:130}, UG:{code:'USh',rate:3800},
  NG:{code:'₦',rate:1500}, GH:{code:'₵',rate:15}, ZA:{code:'R',rate:18},
  US:{code:'$',rate:1}, GB:{code:'£',rate:0.79}, EU:{code:'€',rate:0.92},
  IN:{code:'₹',rate:83}, BR:{code:'R$',rate:5.1}, OT:{code:'$',rate:1}
};
const roundFee = v => v>=100?Math.round(v/10)*10 : v>=1?Math.round(v) : Math.round(v*100)/100;
const creationFee = c => roundFee(0.10 * (CUR[c]||CUR.OT).rate);
const PRIZE_CUT = 0.10;
const curCode = c => (CUR[c]||CUR.OT).code;

// ---- helpers ----
function sign(u){ return jwt.sign({ id:u.id, email:u.email }, JWT_SECRET, { expiresIn:'30d' }); }
function auth(req,res,next){
  const h=req.headers.authorization||'';
  const tok=h.startsWith('Bearer ')?h.slice(7):null;
  if(!tok) return res.status(401).json({error:'not signed in'});
  try{ req.uid=jwt.verify(tok, JWT_SECRET).id; next(); }
  catch(e){ res.status(401).json({error:'session expired'}); }
}
const publicUser = u => ({ id:u.id, name:u.name, email:u.email, country:u.country, phone:u.phone, wins:u.wins, losses:u.losses, played:u.played });
function tx(user_id, tournament_id, type, amount, currency){
  store.addTx({ user_id, tournament_id, type, amount, currency, status: PAYMENTS_LIVE?'success':'pending' });
}
function shape(t){
  const out = Object.assign({}, t);
  out.paid = !!t.paid;
  out.bracket = t.bracket ? (typeof t.bracket==='string'?JSON.parse(t.bracket):t.bracket) : null;
  out.players = store.players(t.id);
  out.currency = curCode(t.country);
  if(out.bracket && t.format==='league') out.standings = B.standings(out.bracket.players, out.bracket.rounds);
  return out;
}

// ================= AUTH =================
app.post('/api/register', (req,res)=>{
  const { name,email,password,country,phone } = req.body||{};
  if(!name||!email||!password) return res.status(400).json({error:'name, email and password are required'});
  if(String(password).length<6) return res.status(400).json({error:'password must be at least 6 characters'});
  if(store.userByEmail(email)) return res.status(409).json({error:'an account with this email already exists'});
  const hash=bcrypt.hashSync(String(password),10);
  const u=store.createUser({ name, email, password:hash, country, phone });
  res.json({ token:sign(u), user:publicUser(u) });
});

app.post('/api/login', (req,res)=>{
  const { email,password } = req.body||{};
  const u=store.userByEmail(email);
  if(!u || !bcrypt.compareSync(String(password||''), u.password)) return res.status(401).json({error:'wrong email or password'});
  res.json({ token:sign(u), user:publicUser(u) });
});

app.get('/api/me', auth, (req,res)=>{
  const u=store.userById(req.uid);
  if(!u) return res.status(404).json({error:'user not found'});
  res.json({ user:publicUser(u) });
});

// ================= TOURNAMENTS =================
app.get('/api/tournaments', (req,res)=> res.json(store.listTournaments().map(shape)));

app.get('/api/tournaments/:id', (req,res)=>{
  const t=store.tournament(req.params.id);
  if(!t) return res.status(404).json({error:'not found'});
  res.json(shape(t));
});

app.post('/api/tournaments', auth, (req,res)=>{
  let { name,format,size,paid,entry } = req.body||{};
  if(!name||!format) return res.status(400).json({error:'name and format required'});
  if(FREE_ONLY){ paid=0; entry=0; }               // free-only launch
  const u=store.userById(req.uid);
  const t=store.createTournament({ name, format, size:size||8, paid:paid?1:0, entry:entry||0, country:u.country, owner_id:u.id });
  store.addRegistration(t.id, u.id, u.name, paid?'held':'none'); // creator auto-joins
  if(!FREE_ONLY) tx(u.id, t.id, 'creation_fee', creationFee(u.country), curCode(u.country)); // pass-through
  res.json(shape(t));
});

app.post('/api/tournaments/:id/join', auth, (req,res)=>{
  const t=store.tournament(req.params.id);
  if(!t) return res.status(404).json({error:'not found'});
  if(t.status!=='open') return res.status(400).json({error:'tournament already started'});
  if(store.players(t.id).length>=t.size) return res.status(400).json({error:'tournament is full'});
  const u=store.userById(req.uid);
  if(store.regByUser(t.id,u.id)) return res.status(409).json({error:'already joined'});
  store.addRegistration(t.id, u.id, u.name, t.paid?'held':'none');
  if(t.paid) tx(u.id, t.id, 'entry_hold', t.entry, curCode(t.country)); // HELD until end
  res.json(shape(t));
});

// dev/demo helper: fill with bot players so you can test brackets solo
app.post('/api/tournaments/:id/bots', auth, (req,res)=>{
  const t=store.tournament(req.params.id);
  if(!t) return res.status(404).json({error:'not found'});
  const BOTS=['Kibwana','Zawadi','Juma','Neema','Baraka','Amani','Rehema','Tumaini','Saidi','Furaha','Mwas','Otieno','Wanjiru','Mutua','Achieng'];
  const existing=new Set(store.players(t.id));
  for(const b of BOTS){ if(store.players(t.id).length>=t.size) break; if(existing.has(b)) continue; store.addRegistration(t.id,null,b,'none'); }
  res.json(shape(t));
});

app.post('/api/tournaments/:id/start', auth, (req,res)=>{
  const t=store.tournament(req.params.id);
  if(!t) return res.status(404).json({error:'not found'});
  if(t.owner_id!==req.uid) return res.status(403).json({error:'only the organizer can start'});
  if(t.status!=='open') return res.status(400).json({error:'already started'});
  const ps=store.players(t.id);
  if(ps.length<2) return res.status(400).json({error:'need at least 2 players'});
  if(t.format==='double' && ![4,8,16].includes(ps.length)) return res.status(400).json({error:'double elim needs exactly 4, 8 or 16 players'});
  if(t.format==='groups' && ps.length<8) return res.status(400).json({error:'groups need 8+ players'});
  const bracket=B.generate(t.format, ps);
  store.updateTournament(t.id, { bracket, status:'live' });
  res.json(shape(store.tournament(t.id)));
});

app.post('/api/tournaments/:id/report', auth, (req,res)=>{
  const { matchId, s1, s2, pkWinner } = req.body||{};
  const t=store.tournament(req.params.id);
  if(!t) return res.status(404).json({error:'not found'});
  if(t.status!=='live') return res.status(400).json({error:'tournament is not live'});
  const bracket=t.bracket;
  const m=B.findMatch(bracket, matchId);
  if(!m) return res.status(404).json({error:'match not found'});
  const p1=m.p1, p2=m.p2;
  let result;
  try{ result=B.report(bracket, matchId, Number(s1), Number(s2), pkWinner); }
  catch(e){ return res.status(400).json({error:e.message}); }
  const winner=m.winner, loser=(winner===p1)?p2:p1;
  bumpStat(t.id, winner, true); bumpStat(t.id, loser, false);

  let payout=null;
  if(result.champion){
    store.updateTournament(t.id, { status:'done', champion:result.champion });
    if(t.paid) payout=doPayout(t, bracket);
  }
  store.updateTournament(t.id, { bracket });
  res.json({ tournament: shape(store.tournament(t.id)), champion: result.champion, payout });
});

function bumpStat(tid, name, win){
  const reg=store.regByName(tid, name);
  if(reg && reg.user_id) store.addResult(reg.user_id, win);
}

// PASS-THROUGH payout: distribute held entry fees to podium, keep 10% cut. No stored balances.
function podium(t, b){
  if(b.type==='league'){ const st=B.standings(b.players,b.rounds); return [st[0]&&st[0].p, st[1]&&st[1].p, st[2]&&st[2].p]; }
  let final;
  if(b.type==='single') final=b.rounds[b.rounds.length-1][0];
  else if(b.type==='double') final=b.gf[0];
  else if(b.type==='groups') final=b.knockout && b.knockout.rounds[b.knockout.rounds.length-1][0];
  if(!final) return [t.champion,null,null];
  const runner = final.winner===final.p1?final.p2:final.p1;
  return [final.winner, runner, null];
}
function doPayout(t, b){
  const pool = t.entry * store.players(t.id).length;
  const cut = Math.round(pool*PRIZE_CUT);
  const dist = pool - cut;
  const [first,second,third] = podium(t,b);
  const shares = third ? [0.6,0.3,0.1] : second ? [0.667,0.333,0] : [1,0,0];
  const names=[first,second,third], distributed=[]; const cur=curCode(t.country);
  tx(t.owner_id, t.id, 'prizepool_cut', cut, cur);
  names.forEach((nm,i)=>{
    if(!nm||shares[i]<=0) return;
    const amt=Math.round(dist*shares[i]);
    const reg=store.regByName(t.id,nm);
    tx(reg?reg.user_id:null, t.id, 'prize_payout', amt, cur);
    distributed.push({ place:i+1, name:nm, amount:amt });
  });
  return { pool, cut, currency:cur, distributed, live:PAYMENTS_LIVE };
}

// ================= EXTRAS =================
app.get('/api/leaderboard', (req,res)=>{
  res.json(store.topPlayers(100).map((r,i)=>({ rank:i+1, name:r.name, country:r.country,
    wins:r.wins, losses:r.losses, played:r.played, pts:r.wins*3, winrate:r.played?Math.round(r.wins/r.played*100):0 })));
});
app.get('/api/transactions/me', auth, (req,res)=> res.json(store.txByUser(req.uid)));
app.get('/api/config', (req,res)=> res.json({ freeOnly:FREE_ONLY, paymentsLive:PAYMENTS_LIVE, prizeCutPct:PRIZE_CUT*100, currencies:CUR,
  note:'Free-only launch: no money changes hands. Pass-through payments are built but dormant (set FREE_ONLY=false + wire Selcom to enable).' }));

const PORT=process.env.PORT||3000;
app.listen(PORT, ()=>console.log('eKombe backend running on http://localhost:'+PORT));
