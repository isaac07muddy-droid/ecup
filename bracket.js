// ---- eKombe bracket engine (server-side) ----
// Pure functions. A "bracket" is a plain JSON object stored on the tournament row.

function makeCtx() { return { seq: 1 }; }
function mkMatch(ctx, round, slot, p1, p2) {
  return { id: 'm' + (ctx.seq++), round, slot, p1: p1 || null, p2: p2 || null, s1: null, s2: null, winner: null, status: 'pending' };
}
function nextPow2(n){ let p=1; while(p<n) p*=2; return p; }
function seedOrder(n){
  let rounds=Math.log2(n), seeds=[1,2];
  for(let r=1;r<rounds;r++){ const out=[], top=Math.pow(2,r+1)+1; for(const s of seeds){ out.push(s); out.push(top-s);} seeds=out; }
  return seeds;
}
const flat = rounds => rounds.reduce((a,r)=>a.concat(r),[]);

// ---------- SINGLE ELIMINATION ----------
function genSingle(ctx, players){
  const n=nextPow2(players.length), order=seedOrder(n);
  const slots=order.map(s=>players[s-1]||null);
  let rounds=[], cur=[];
  for(let i=0;i<n;i+=2) cur.push(mkMatch(ctx,0,i/2,slots[i],slots[i+1]));
  rounds.push(cur);
  let size=n/2;
  while(size>1){ let r=[]; for(let i=0;i<size/2;i++) r.push(mkMatch(ctx,rounds.length,i,null,null)); rounds.push(r); size/=2; }
  rounds[0].forEach(m=>{ if(m.p1&&!m.p2){m.winner=m.p1;m.s1=1;m.s2=0;m.status='done';} else if(!m.p1&&m.p2){m.winner=m.p2;m.s1=0;m.s2=1;m.status='done';} });
  return { type:'single', rounds };
}
function propagate(rounds){
  for(let r=0;r<rounds.length-1;r++){
    rounds[r].forEach((m,i)=>{ if(m.winner){ const nm=rounds[r+1][Math.floor(i/2)]; if(i%2===0) nm.p1=m.winner; else nm.p2=m.winner; } });
  }
}

// ---------- LEAGUE / ROUND ROBIN ----------
function genLeague(ctx, players){
  let ps=players.slice(); if(ps.length%2) ps.push(null);
  const n=ps.length, rounds=[];
  for(let r=0;r<n-1;r++){
    const rd=[];
    for(let i=0;i<n/2;i++){ const a=ps[i], b=ps[n-1-i]; if(a&&b) rd.push(mkMatch(ctx,r,i,a,b)); }
    rounds.push(rd); ps.splice(1,0,ps.pop());
  }
  return { type:'league', rounds, players:players.slice() };
}
function standings(players, rounds){
  const t={}; players.forEach(p=>t[p]={p,pl:0,w:0,d:0,l:0,gf:0,ga:0,pts:0});
  flat(rounds).forEach(m=>{ if(m.status==='done'){
    t[m.p1].pl++;t[m.p2].pl++;t[m.p1].gf+=m.s1;t[m.p1].ga+=m.s2;t[m.p2].gf+=m.s2;t[m.p2].ga+=m.s1;
    if(m.s1>m.s2){t[m.p1].w++;t[m.p2].l++;t[m.p1].pts+=3;}
    else if(m.s2>m.s1){t[m.p2].w++;t[m.p1].l++;t[m.p2].pts+=3;}
    else {t[m.p1].d++;t[m.p2].d++;t[m.p1].pts++;t[m.p2].pts++;}
  }});
  return Object.values(t).sort((a,b)=> b.pts-a.pts || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf || a.p.localeCompare(b.p));
}

// ---------- GROUPS + KNOCKOUT ----------
function genGroups(ctx, players){
  const gsize=4, ng=Math.ceil(players.length/gsize), groups=[];
  for(let g=0;g<ng;g++){
    const gp=players.slice(g*gsize,(g+1)*gsize);
    groups.push({ name:'Group '+String.fromCharCode(65+g), players:gp, rounds:genLeague(ctx,gp).rounds });
  }
  return { type:'groups', groups, knockout:null };
}

// ---------- DOUBLE ELIMINATION (4/8/16) ----------
function genDouble(ctx, players){
  const n=nextPow2(players.length);
  const wb=genSingle(ctx, players).rounds;
  let sizes = n===4?[1,1] : n===8?[2,2,1,1] : n===16?[4,4,2,2,1,1] : [1];
  const lb=sizes.map((sz,ri)=>{ const r=[]; for(let i=0;i<sz;i++) r.push(mkMatch(ctx,ri,i,null,null)); return r; });
  const gf=[mkMatch(ctx,0,0,null,null)];
  return { type:'double', wb, lb, gf, n };
}
function advanceDouble(b){
  propagate(b.wb);
  const losers=[]; flat(b.wb).forEach(m=>{ if(m.status==='done'){ const l=m.winner===m.p1?m.p2:m.p1; if(l) losers.push(l);} });
  let li=0;
  b.lb[0].forEach(m=>{ if(!m.p1&&losers[li])m.p1=losers[li++]; if(!m.p2&&losers[li])m.p2=losers[li++]; });
  for(let r=0;r<b.lb.length-1;r++){
    b.lb[r].forEach((m,i)=>{ if(m.winner){ const nm=b.lb[r+1][Math.floor(i/2)]||b.lb[r+1][0]; if(nm){ if(!nm.p1)nm.p1=m.winner; else if(!nm.p2)nm.p2=m.winner; } } });
  }
  flat(b.lb).forEach(m=>{ if(!m.p1&&losers[li])m.p1=losers[li++]; if(!m.p2&&losers[li])m.p2=losers[li++]; });
  const wbF=b.wb[b.wb.length-1][0], lbF=b.lb[b.lb.length-1][0];
  if(wbF.status==='done') b.gf[0].p1=wbF.winner;
  if(lbF.status==='done') b.gf[0].p2=lbF.winner;
}

// ---------- PUBLIC API ----------
function generate(format, players){
  const ctx=makeCtx();
  if(format==='single') return genSingle(ctx,players);
  if(format==='league') return genLeague(ctx,players);
  if(format==='groups') return genGroups(ctx,players);
  if(format==='double') return genDouble(ctx,players);
  throw new Error('unknown format '+format);
}

function findMatch(b, matchId){
  let all=[];
  if(b.type==='single'||b.type==='league') all=flat(b.rounds);
  else if(b.type==='groups'){ b.groups.forEach(g=>all=all.concat(flat(g.rounds))); if(b.knockout) all=all.concat(flat(b.knockout.rounds)); }
  else if(b.type==='double'){ all=flat(b.wb).concat(flat(b.lb)).concat(b.gf); }
  return all.find(m=>m.id===matchId);
}

// apply a confirmed result, advance the bracket, return champion name or null
function report(b, matchId, s1, s2, pkWinner){
  const m=findMatch(b, matchId);
  if(!m) throw new Error('match not found');
  if(!m.p1||!m.p2) throw new Error('match not ready');
  if(m.status==='done') throw new Error('already reported');
  let winner = s1>s2 ? m.p1 : s2>s1 ? m.p2 : (pkWinner===m.p2 ? m.p2 : m.p1);
  m.s1=s1; m.s2=s2; m.winner=winner; m.status='done';

  let champion=null;
  if(b.type==='single'){ propagate(b.rounds); const f=b.rounds[b.rounds.length-1][0]; if(f.status==='done') champion=f.winner; }
  else if(b.type==='league'){ const done=flat(b.rounds).every(x=>x.status==='done'); if(done) champion=standings(b.players,b.rounds)[0].p; }
  else if(b.type==='groups'){
    const allGroupsDone=b.groups.every(g=>flat(g.rounds).every(x=>x.status==='done'));
    if(allGroupsDone && !b.knockout){
      const adv=[]; b.groups.forEach(g=>{ const st=standings(g.players,g.rounds); adv.push(st[0].p, st[1].p); });
      const ctx=makeCtx(); ctx.seq = 10000; // avoid id collision
      b.knockout=genSingle(ctx, adv);
    }
    if(b.knockout){ propagate(b.knockout.rounds); const f=b.knockout.rounds[b.knockout.rounds.length-1][0]; if(f.status==='done') champion=f.winner; }
  }
  else if(b.type==='double'){
    advanceDouble(b);
    const gf=b.gf[0]; if(gf.status==='done') champion=gf.winner;
  }
  return { champion };
}

// which players won/lost this match (for stats + payout)
module.exports = { generate, report, standings, findMatch };
