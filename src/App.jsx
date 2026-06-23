import { useState, useEffect } from "react";
import { doc, setDoc, onSnapshot, getDoc } from "firebase/firestore";
import { db, DATA_DOC } from "./firebase";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

const KEC_COLOR = "#8b5cf6";
const KEC_BG    = "#f5f3ff";
const KEC_TEAMS_DEFAULT = ["Kalisari","Cijantung","Kp. Gedong","Baru","Pekayon"];

function generateKecMatches(teams, cat, rotate = 0) {
  const n = teams.length;
  // indeks tim, dengan "bye" (-1) bila ganjil
  const idx = teams.map((_, i) => i);
  if (n % 2 === 1) idx.push(-1);
  const slots = idx.length;
  const half = slots / 2;
  // rotasi awal untuk variasi urutan (acak ulang)
  const arr = idx.slice();
  const fixed = arr[0];
  let rest = arr.slice(1);
  for (let r = 0; r < (rotate % rest.length + rest.length) % rest.length; r++)
    rest.unshift(rest.pop());

  const ordered = [];
  let rot = [fixed, ...rest];
  for (let round = 0; round < slots - 1; round++) {
    for (let i = 0; i < half; i++) {
      const a = rot[i], b = rot[slots - 1 - i];
      if (a === -1 || b === -1) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      ordered.push([lo, hi]);
    }
    // putar semua kecuali elemen pertama
    rot = [rot[0], rot[slots - 1], ...rot.slice(1, slots - 1)];
  }

  // Urutkan agar tidak ada tim main dua kali berturut-turut (cari solusi 0 bila ada)
  const nOrd = ordered.length;
  const usedI = new Array(nOrd).fill(false);
  const overlap = (p, q) => p && (q[0] === p[0] || q[0] === p[1] || q[1] === p[0] || q[1] === p[1]);
  let bestSeq = null, bestB2b = Infinity, seq = [];
  const search = (prev, b2b) => {
    if (b2b >= bestB2b) return;
    if (seq.length === nOrd) { bestB2b = b2b; bestSeq = seq.slice(); return; }
    // coba dulu yang tidak overlap, lalu yang overlap (agar 0 ditemukan lebih awal)
    for (const wantOverlap of [false, true]) {
      for (let i = 0; i < nOrd; i++) {
        if (usedI[i]) continue;
        const ov = overlap(prev, ordered[i]);
        if (!!ov !== wantOverlap) continue;
        usedI[i] = true; seq.push(ordered[i]);
        search(ordered[i], b2b + (ov ? 1 : 0));
        seq.pop(); usedI[i] = false;
        if (bestB2b === 0) return;
      }
    }
  };
  search(null, 0);
  const scheduled = bestSeq || ordered;

  return scheduled.map(([a, b], k) => ({
    id: `kec-${cat}-${a}-${b}`, home: teams[a], away: teams[b],
    homeScore: "", awayScore: "", wo: "none",
    yellowHome: 0, yellowAway: 0, redHome: 0, redAway: 0,
    scorers: [], date: "", time: "", matchNo: k + 1,
  }));
}

const initKecamatan = (() => {
  const t = KEC_TEAMS_DEFAULT;
  const mkFinal = () => ({ homeScore:"", awayScore:"", wo:"none", scorers:[], home:"", away:"" });
  return {
    teams: t,
    U16: { matches: generateKecMatches(t,"U16"), final: mkFinal(), roster: {} },
    U13: { matches: generateKecMatches(t,"U13"), final: mkFinal(), roster: {} },
  };
})();

function calcStats(teams, matches) {
  const stats = {};
  teams.forEach(t => stats[t] = { team:t, p:0, w:0, d:0, l:0, gf:0, ga:0, gd:0, pts:0, yc:0, rc:0, cards:0 });
  matches.forEach(m => {
    if (m.wo === "none" && (m.homeScore === "" || m.awayScore === "")) return;
    let hs, as_, hw, hd, hl, aw, ad, al;
    if (m.wo === "home_wo")      { hs=3;as_=0;hw=1;hd=0;hl=0;aw=0;ad=0;al=1; }
    else if (m.wo === "away_wo") { hs=0;as_=3;hw=0;hd=0;hl=1;aw=1;ad=0;al=0; }
    else {
      hs=parseInt(m.homeScore); as_=parseInt(m.awayScore);
      if(hs>as_){hw=1;hd=0;hl=0;aw=0;ad=0;al=1;}
      else if(hs<as_){hw=0;hd=0;hl=1;aw=1;ad=0;al=0;}
      else{hw=0;hd=1;hl=0;aw=0;ad=1;al=0;}
    }
    const h=stats[m.home], a=stats[m.away];
    h.p++;h.w+=hw;h.d+=hd;h.l+=hl;h.gf+=hs;h.ga+=as_;h.gd+=hs-as_;h.pts+=hw*3+hd;
    a.p++;a.w+=aw;a.d+=ad;a.l+=al;a.gf+=as_;a.ga+=hs;a.gd+=as_-hs;a.pts+=aw*3+ad;
    h.yc+=parseInt(m.yellowHome)||0; h.rc+=parseInt(m.redHome)||0;
    a.yc+=parseInt(m.yellowAway)||0; a.rc+=parseInt(m.redAway)||0;
  });
  Object.values(stats).forEach(s => s.cards = s.yc + s.rc*2);
  const arr = Object.values(stats);

  function getH2H(teamA, teamB) {
    const m = matches.find(m=>(m.home===teamA&&m.away===teamB)||(m.home===teamB&&m.away===teamA));
    if (!m || m.homeScore==="" || m.awayScore==="") return 0;
    const hs=parseInt(m.homeScore), as_=parseInt(m.awayScore);
    if((m.home===teamA&&hs>as_)||(m.away===teamA&&as_>hs)) return 1;
    if((m.home===teamB&&hs>as_)||(m.away===teamB&&as_>hs)) return -1;
    return 0;
  }

  function isCircular(group) {
    if(group.length<3) return false;
    const wins={};
    group.forEach(t=>wins[t]=0);
    for(let i=0;i<group.length;i++)
      for(let j=i+1;j<group.length;j++){
        const r=getH2H(group[i],group[j]);
        if(r===1) wins[group[i]]++;
        else if(r===-1) wins[group[j]]++;
      }
    const vals=Object.values(wins);
    return vals.every(w=>w===vals[0]);
  }

  arr.sort((a,b)=>{
    if(b.pts!==a.pts) return b.pts-a.pts;
    if(b.gd!==a.gd)  return b.gd-a.gd;
    return a.cards-b.cards;
  });

  let i=0;
  while(i<arr.length){
    let j=i+1;
    while(j<arr.length&&arr[j].pts===arr[i].pts&&arr[j].gd===arr[i].gd) j++;
    if(j-i>1){
      const group=arr.slice(i,j);
      if(!isCircular(group.map(t=>t.team))){
        group.sort((a,b)=>{const r=getH2H(a.team,b.team);return r!==0?-r:a.cards-b.cards;});
        for(let k=0;k<group.length;k++) arr[i+k]=group[k];
      }
    }
    i=j;
  }
  return arr;
}

function getKnockoutWinner(home, away, match) {
  if (!home || !away) return null;
  if (match.wo === "home_wo") return home;
  if (match.wo === "away_wo") return away;
  if (match.homeScore === "" || match.awayScore === "") return null;
  const hs = parseInt(match.homeScore), as_ = parseInt(match.awayScore);
  if (hs > as_) return home;
  if (as_ > hs) return away;
  return null;
}

function calcTopScorers(matches, final) {
  const map = {};
  const process = (m) => {
    (m.scorers || []).forEach(s => {
      const teamName = s.side === "home" ? m.home : m.away;
      if (!teamName) return;
      const key = `${s.name}||${teamName}`;
      if (!map[key]) map[key] = { name: s.name, team: teamName, goals: 0 };
      map[key].goals += parseInt(s.goals) || 0;
    });
  };
  matches.forEach(process);
  if (final) process(final);
  return Object.values(map).filter(s => s.goals > 0).sort((a, b) => b.goals - a.goals);
}

// ─── MATCH CARD ──────────────────────────────────────────────────
function MatchCard({ label, home, away, match, isAdmin, onUpdate, roster }) {
  const [showScorer, setShowScorer] = useState(false);
  const [newScorer, setNewScorer] = useState({ name:"", side:"home", goals:1 });
  const ph = "Belum ditentukan";
  const wo = match.wo;
  const scored = wo === "none" ? (match.homeScore !== "" && match.awayScore !== "") : true;
  const hs  = wo==="home_wo"?3:wo==="away_wo"?0:parseInt(match.homeScore)||0;
  const as_ = wo==="away_wo"?3:wo==="home_wo"?0:parseInt(match.awayScore)||0;
  const winner = scored && home && away ? (hs>as_?home:as_>hs?away:null) : null;

  const teamRow = (team, score, isHome) => (
    <div style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:8,
      borderBottom: isHome?"1px solid #f1f5f9":"none",
      background: winner&&winner===team?"#f5f3ff":"#fff" }}>
      <div style={{ flex:1, fontWeight:600, fontSize:13, color:team?"#1e293b":"#94a3b8" }}>
        {team||ph}
        {winner===team&&<span style={{ marginLeft:6,fontSize:10,background:KEC_COLOR,color:"#fff",borderRadius:4,padding:"1px 5px" }}>MENANG</span>}
      </div>
      {isAdmin ? (
        wo!=="none"
          ? <span style={{ fontWeight:700, color:"#7c3aed", fontSize:14 }}>{score}</span>
          : <input type="number" min="0" value={isHome?match.homeScore:match.awayScore}
              onChange={e=>onUpdate({...match,[isHome?"homeScore":"awayScore"]:e.target.value})}
              disabled={!home||!away}
              style={{ width:38, textAlign:"center", border:"1px solid #e2e8f0", borderRadius:6, padding:"3px 4px", fontSize:13, fontWeight:700 }} />
      ) : (
        scored&&home&&away&&<span style={{ fontWeight:800, fontSize:15, color:winner===team?KEC_COLOR:"#64748b" }}>{score}</span>
      )}
    </div>
  );

  const addScorer = () => {
    if (!newScorer.name.trim()) return;
    onUpdate({ ...match, scorers: [...(match.scorers||[]), { name: newScorer.name.trim(), side: newScorer.side, goals: parseInt(newScorer.goals)||1 }] });
    setNewScorer({ name:"", side:"home", goals:1 });
  };
  const removeScorer = (idx) => onUpdate({ ...match, scorers: (match.scorers||[]).filter((_,i)=>i!==idx) });
  const totalGoals = (match.scorers||[]).reduce((s,c)=>s+(parseInt(c.goals)||0),0);

  return (
    <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 2px 10px #0002" }}>
      <div style={{ background:"#5b21b6", color:"#fff", padding:"7px 14px", fontSize:11, fontWeight:700, textAlign:"center", letterSpacing:1 }}>{label}</div>
      {teamRow(home, hs, true)}
      {teamRow(away, as_, false)}
      {isAdmin && home && away && (
        <div style={{ padding:"6px 14px 8px", background:"#f8fafc" }}>
          <select value={wo} onChange={e=>onUpdate({...match,wo:e.target.value})}
            style={{ fontSize:11, border:"1px solid #e2e8f0", borderRadius:4, padding:"2px 6px", width:"100%", color:"#64748b" }}>
            <option value="none">— Normal —</option>
            <option value="home_wo">{home} WO</option>
            <option value="away_wo">{away} WO</option>
          </select>
        </div>
      )}
      {wo!=="none"&&<div style={{ padding:"3px 14px 6px", background:"#f5f3ff", fontSize:11, color:"#7c3aed", fontWeight:700, textAlign:"center" }}>WO</div>}
      {isAdmin && home && away && (
        <div style={{ borderTop:"1px solid #f1f5f9" }}>
          <button onClick={()=>setShowScorer(!showScorer)}
            style={{ width:"100%", background: showScorer?"#fffbeb":"#f8fafc", border:"none", padding:"6px 14px", fontSize:11, fontWeight:700, color: totalGoals>0?"#d97706":"#94a3b8", cursor:"pointer", textAlign:"left" }}>
            {totalGoals>0 ? `⚽ ${totalGoals} Gol — ${showScorer?"Tutup":"Lihat/Edit"}` : "⚽ Tambah Pencetak Gol"}
          </button>
          {showScorer && (
            <div style={{ padding:"10px 14px 12px", background:"#fffbeb", display:"flex", flexDirection:"column", gap:8 }}>
              {(match.scorers||[]).length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                  {(match.scorers||[]).map((s,si)=>(
                    <div key={si} style={{ display:"flex", alignItems:"center", gap:4, background:"#fff", border:"1px solid #fcd34d", borderRadius:6, padding:"3px 8px", fontSize:11 }}>
                      <span style={{ fontWeight:600 }}>{s.name}</span>
                      <span style={{ color:"#94a3b8" }}>({s.side==="home"?home:away})</span>
                      <span style={{ color:"#f59e0b", fontWeight:700 }}>×{s.goals}</span>
                      <button onClick={()=>removeScorer(si)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:12, lineHeight:1, padding:"0 2px" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
                <select value={newScorer.side} onChange={e=>setNewScorer(p=>({...p,side:e.target.value,name:""}))}
                  style={{ border:"1px solid #e2e8f0", borderRadius:5, padding:"4px 6px", fontSize:11 }}>
                  <option value="home">{home}</option>
                  <option value="away">{away}</option>
                </select>
                {(roster?.[newScorer.side==="home"?home:away]?.players||[]).length>0 ? (
                  <select value={newScorer.name} onChange={e=>setNewScorer(p=>({...p,name:e.target.value}))}
                    style={{ border:"1px solid #e2e8f0", borderRadius:5, padding:"4px 8px", fontSize:11, minWidth:130 }}>
                    <option value="">— Pilih pemain —</option>
                    {[...(roster?.[newScorer.side==="home"?home:away]?.players||[])].sort((a,b)=>(parseInt(a.number)||99)-(parseInt(b.number)||99)).map((p,pi)=>(
                      <option key={pi} value={p.name}>{p.number?`#${p.number} `:""}{p.name}</option>
                    ))}
                  </select>
                ) : (
                  <input placeholder="Nama pemain" value={newScorer.name} onChange={e=>setNewScorer(p=>({...p,name:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&addScorer()}
                    style={{ border:"1px solid #e2e8f0", borderRadius:5, padding:"4px 8px", fontSize:11, width:130 }} />
                )}
                <input type="number" min="1" value={newScorer.goals} onChange={e=>setNewScorer(p=>({...p,goals:e.target.value}))}
                  style={{ width:40, border:"1px solid #e2e8f0", borderRadius:5, padding:"4px", fontSize:11, textAlign:"center" }} />
                <button onClick={addScorer}
                  style={{ background:"#f59e0b", color:"#fff", border:"none", borderRadius:5, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer" }}>+ Tambah</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TOP SKOR ────────────────────────────────────────────────────
function TopScorers({ matches, final }) {
  const scorers = calcTopScorers(matches, final);
  return (
    <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 6px #0001" }}>
      <div style={{ background:"linear-gradient(135deg,#f59e0b,#d97706)", color:"#fff", padding:"12px 20px", fontWeight:700, fontSize:14 }}>
        ⚽ Pencetak Gol Terbanyak
      </div>
      {scorers.length === 0 ? (
        <div style={{ padding:32, textAlign:"center", color:"#94a3b8", fontSize:13 }}>Belum ada data pencetak gol</div>
      ) : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ background:"#f8fafc" }}>
                {["#","Pemain","Tim","⚽ Gol"].map((h,i)=>(
                  <th key={i} style={{ padding:"8px 10px", color:"#64748b", textAlign:i<3?"left":"center", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scorers.map((s,i)=>(
                <tr key={`${s.name}-${s.team}`} style={{ borderBottom:"1px solid #f1f5f9", background:i===0?"#fffbeb":i===1?"#f8fafc":i===2?"#fff7ed":"#fff" }}>
                  <td style={{ padding:"10px 10px", fontWeight:700, fontSize:15, color:i===0?"#d97706":i===1?"#64748b":i===2?"#92400e":"#94a3b8" }}>
                    {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
                  </td>
                  <td style={{ padding:"10px 10px", fontWeight:600, color:"#1e293b" }}>{s.name}</td>
                  <td style={{ padding:"10px 10px", color:"#64748b", fontSize:12 }}>{s.team}</td>
                  <td style={{ padding:"10px 10px", textAlign:"center", fontWeight:800, color:"#f59e0b", fontSize:18 }}>{s.goals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── ROSTER VIEW (publik) ────────────────────────────────────────
function RosterView({ teams, roster }) {
  const [selected, setSelected] = useState(teams[0] || "");
  const data = roster[selected] || { players: [], officials: [] };
  const posColor = { GK:"#7c3aed", FP:"#2563eb", CF:"#10b981" };
  const posLabel = { GK:"Kiper", FP:"Pemain Lapangan", CF:"Pivot" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ background:"#fff", borderRadius:12, padding:"14px 16px", boxShadow:"0 1px 6px #0001" }}>
        <div style={{ fontSize:12, fontWeight:600, color:"#64748b", marginBottom:8 }}>Pilih Tim:</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {teams.map(t => (
            <button key={t} onClick={()=>setSelected(t)}
              style={{ padding:"6px 14px", borderRadius:8, border:`2px solid ${selected===t?KEC_COLOR:"#e2e8f0"}`, background:selected===t?KEC_COLOR:"#fff", color:selected===t?"#fff":"#1e293b", fontWeight:600, fontSize:12, cursor:"pointer" }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 6px #0001" }}>
        <div style={{ background:"#5b21b6", color:"#fff", padding:"12px 20px", fontWeight:700, fontSize:14 }}>👥 {selected}</div>
        <div style={{ padding:"12px 16px 0" }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6, textTransform:"uppercase", letterSpacing:1 }}>Official</div>
          {data.officials.length === 0
            ? <div style={{ fontSize:12, color:"#cbd5e1", paddingBottom:12 }}>Belum ada data official</div>
            : <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                {data.officials.map((o,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderRadius:8, background:"#f1f5f9", border:"1px solid #e2e8f0" }}>
                    <div style={{ width:28, height:28, borderRadius:"50%", background:"#5b21b6", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800 }}>{o.name.charAt(0)}</div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:12, color:"#1e293b" }}>{o.name}</div>
                      <div style={{ fontSize:10, color:"#64748b" }}>{o.role}</div>
                    </div>
                  </div>
                ))}
              </div>}
        </div>
        <div style={{ padding:"0 16px 16px" }}>
          <div style={{ fontSize:12, fontWeight:700, color:"#64748b", marginBottom:6, textTransform:"uppercase", letterSpacing:1 }}>Pemain</div>
          {data.players.length === 0
            ? <div style={{ fontSize:12, color:"#cbd5e1" }}>Belum ada data pemain</div>
            : <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr style={{ background:"#f8fafc" }}>
                    {["No","Nama","Posisi"].map((h,i)=>(
                      <th key={i} style={{ padding:"7px 8px", textAlign:i===0?"center":"left", color:"#64748b", fontWeight:600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...data.players].sort((a,b)=>(parseInt(a.number)||99)-(parseInt(b.number)||99)).map((p,i)=>(
                    <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                      <td style={{ padding:"8px", textAlign:"center", fontWeight:700, color:KEC_COLOR, width:36 }}>{p.number||"-"}</td>
                      <td style={{ padding:"8px", fontWeight:600, color:"#1e293b" }}>{p.name}</td>
                      <td style={{ padding:"8px" }}>
                        <span style={{ fontSize:10, background:(posColor[p.pos]||"#64748b")+"22", color:posColor[p.pos]||"#64748b", borderRadius:4, padding:"2px 6px", fontWeight:700 }}>
                          {posLabel[p.pos]||p.pos||"-"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>}
        </div>
      </div>
    </div>
  );
}

// ─── ROSTER ADMIN ────────────────────────────────────────────────
function RosterAdmin({ teams, roster, setRoster, cat }) {
  const [selected, setSelected] = useState(teams[0] || "");
  const [newPlayer, setNewPlayer] = useState({ name:"", number:"", pos:"FP" });
  const [newOfficial, setNewOfficial] = useState({ name:"", role:"" });
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [editingOfficial, setEditingOfficial] = useState(null);

  const data = roster[selected] || { players: [], officials: [] };
  const update = (patch) => setRoster(prev => ({ ...prev, [selected]: { ...(prev[selected]||{players:[],officials:[]}), ...patch } }));

  const addPlayer = () => {
    if (!newPlayer.name.trim()) return;
    const nextNo = newPlayer.number || (Math.max(0, ...data.players.map(p => parseInt(p.number)||0)) + 1).toString();
    update({ players: [...data.players, { ...newPlayer, number: nextNo, name: newPlayer.name.trim() }] });
    setNewPlayer({ name:"", number:"", pos:"FP" });
  };
  const removePlayer = (i) => { update({ players: data.players.filter((_,idx)=>idx!==i) }); setEditingPlayer(null); };
  const updatePlayer = (i, field, val) => update({ players: data.players.map((p,idx)=>idx===i?{...p,[field]:val}:p) });

  const addOfficial = () => {
    if (!newOfficial.name.trim()) return;
    update({ officials: [...data.officials, { ...newOfficial, name: newOfficial.name.trim() }] });
    setNewOfficial({ name:"", role:"" });
  };
  const removeOfficial = (i) => { update({ officials: data.officials.filter((_,idx)=>idx!==i) }); setEditingOfficial(null); };
  const updateOfficial = (i, field, val) => update({ officials: data.officials.map((o,idx)=>idx===i?{...o,[field]:val}:o) });

  const sortedPlayers = [...data.players].sort((a,b)=>(parseInt(a.number)||99)-(parseInt(b.number)||99));

  const exportExcel = () => {
    const rows = [
      ["No Urut","No Punggung","Nama Pemain","Posisi","Tim","Kategori"],
      ...sortedPlayers.map((p,i)=>[i+1, p.number||"-", p.name, p.pos==="GK"?"Kiper":p.pos==="CF"?"Pivot":"Pemain", selected, cat]),
    ];
    const csv = "﻿" + rows.map(r=>r.map(v=>`"${v}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
    a.download = `pemain-${cat}-${selected.replace(/\s+/g,"-")}.csv`;
    a.click();
  };

  const exportPDF = () => {
    const posLabel = {GK:"Kiper",FP:"Pemain",CF:"Pivot"};
    const numRows = Math.max(12, sortedPlayers.length);
    const playerRows = Array.from({length: numRows}, (_,i) => {
      const p = sortedPlayers[i];
      return `<tr><td style="text-align:center;font-size:13px">${i+1}</td><td style="text-align:center">${p?.number||""}</td><td style="padding:5px 10px">${p?.name||""}</td><td style="text-align:center">${p?(posLabel[p.pos]||p.pos||""):""}</td><td></td><td></td><td></td></tr>`;
    }).join("");
    const off1 = data.officials[0], off2 = data.officials[1];
    const totalRows = numRows + 4;
    const w = window.open("","_blank");
    w.document.write(`<!DOCTYPE html><html><head><title>Daftar Susunan Pemain - ${selected} ${cat}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:20px}.title{text-align:center;font-weight:bold;font-size:13px;margin-bottom:20px;line-height:2}table{width:100%;border-collapse:collapse}td,th{border:1px solid #000;padding:5px 6px;vertical-align:middle;font-size:11px}@media print{@page{size:A4 landscape;margin:1cm}}</style>
      </head><body>
      <div class="title">DAFTAR SUSUNAN PEMAIN<br>TURNAMEN FUTSAL KECAMATAN PASAR REBO — ${cat}<br>TIM ${selected}</div>
      <table><tbody>
        <tr>
          <td rowspan="${totalRows}" style="width:110px;font-weight:bold;font-size:11px;vertical-align:top;padding:8px">
            <table style="border:none;width:100%;height:100%"><tr><td style="border:none;padding:0;vertical-align:top">TIM : ${selected}</td></tr><tr><td style="border:none;padding:0;vertical-align:bottom;padding-top:${numRows*14}px">OFFICIAL/COACH :</td></tr></table>
          </td>
          <th rowspan="2" style="width:46px;text-align:center">NO</th>
          <th rowspan="2" style="width:100px;text-align:center">NO PUNGGUNG</th>
          <th rowspan="2" style="text-align:center">NAMA LENGKAP PEMAIN</th>
          <th rowspan="2" style="width:80px;text-align:center">POSISI</th>
          <th colspan="3" style="text-align:center">STATUS PEMAIN</th>
        </tr>
        <tr><th style="width:70px;text-align:center">MAIN</th><th style="width:80px;text-align:center">CADANGAN</th><th style="width:60px;text-align:center">JOKER</th></tr>
        ${playerRows}
        <tr><td colspan="3" style="text-align:center;font-weight:bold;font-size:10px;letter-spacing:1px;padding:6px">OFFICIAL 1</td><td colspan="4" style="text-align:center;font-weight:bold;font-size:10px;letter-spacing:1px;padding:6px">OFFICIAL 2</td></tr>
        <tr><td colspan="3" style="height:60px;text-align:center;vertical-align:bottom;padding-bottom:6px;font-size:11px">${off1?.name||""}</td><td colspan="4" style="height:60px;text-align:center;vertical-align:bottom;padding-bottom:6px;font-size:11px">${off2?.name||""}</td></tr>
      </tbody></table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ background:"#fff", borderRadius:12, padding:"14px 16px", boxShadow:"0 1px 6px #0001" }}>
        <div style={{ fontSize:12, fontWeight:600, color:"#64748b", marginBottom:8 }}>Pilih Tim ({cat}):</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {teams.map(t => (
            <button key={t} onClick={()=>{ setSelected(t); setEditingPlayer(null); setEditingOfficial(null); }}
              style={{ padding:"6px 14px", borderRadius:8, border:`2px solid ${selected===t?KEC_COLOR:"#e2e8f0"}`, background:selected===t?KEC_COLOR:"#fff", color:selected===t?"#fff":"#1e293b", fontWeight:600, fontSize:12, cursor:"pointer" }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 6px #0001" }}>
        <div style={{ background:"#5b21b6", color:"#fff", padding:"10px 16px", fontWeight:700, fontSize:13 }}>👔 Official — {selected}</div>
        <div style={{ padding:12, display:"flex", flexDirection:"column", gap:8 }}>
          {data.officials.map((o,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, background: editingOfficial===i?"#f5f3ff":"#f8fafc", border:`1px solid ${editingOfficial===i?"#c4b5fd":"#e2e8f0"}` }}>
              {editingOfficial===i ? (
                <>
                  <input value={o.name} onChange={e=>updateOfficial(i,"name",e.target.value)} style={{ flex:2, border:"1px solid #c4b5fd", borderRadius:5, padding:"3px 8px", fontSize:12, fontWeight:600 }} />
                  <input value={o.role} onChange={e=>updateOfficial(i,"role",e.target.value)} style={{ flex:2, border:"1px solid #c4b5fd", borderRadius:5, padding:"3px 8px", fontSize:12 }} />
                  <button onClick={()=>setEditingOfficial(null)} style={{ background:"#dcfce7", border:"none", color:"#16a34a", borderRadius:5, padding:"2px 8px", cursor:"pointer", fontSize:11, fontWeight:700 }}>✓</button>
                </>
              ) : (
                <>
                  <span style={{ flex:1, fontWeight:600, fontSize:12 }}>{o.name}</span>
                  <span style={{ fontSize:11, color:"#64748b" }}>{o.role}</span>
                  <button onClick={()=>setEditingOfficial(i)} style={{ background:"#f5f3ff", border:"none", color:KEC_COLOR, borderRadius:5, padding:"2px 8px", cursor:"pointer", fontSize:11, fontWeight:700 }}>✏️</button>
                  <button onClick={()=>removeOfficial(i)} style={{ background:"#fee2e2", border:"none", color:"#ef4444", borderRadius:5, padding:"2px 8px", cursor:"pointer", fontSize:11, fontWeight:700 }}>×</button>
                </>
              )}
            </div>
          ))}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <input placeholder="Nama official" value={newOfficial.name} onChange={e=>setNewOfficial(p=>({...p,name:e.target.value}))} style={{ flex:2, border:"1px solid #e2e8f0", borderRadius:6, padding:"6px 10px", fontSize:12, minWidth:120 }} />
            <input placeholder="Jabatan (misal: Pelatih)" value={newOfficial.role} onChange={e=>setNewOfficial(p=>({...p,role:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addOfficial()} style={{ flex:2, border:"1px solid #e2e8f0", borderRadius:6, padding:"6px 10px", fontSize:12, minWidth:120 }} />
            <button onClick={addOfficial} style={{ background:"#5b21b6", color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Tambah</button>
          </div>
        </div>
      </div>

      <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 6px #0001" }}>
        <div style={{ background:KEC_COLOR, color:"#fff", padding:"10px 16px", fontWeight:700, fontSize:13 }}>⚽ Pemain — {selected}</div>
        <div style={{ padding:12, display:"flex", flexDirection:"column", gap:6 }}>
          {data.players.length > 0 && (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, marginBottom:6 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["#","No","Nama","Posisi",""].map((h,i)=><th key={i} style={{ padding:"6px 8px", textAlign:i<2?"center":"left", color:"#64748b", fontWeight:600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {sortedPlayers.map((p, urutan) => {
                  const realIdx = data.players.indexOf(p);
                  const isEditing = editingPlayer === realIdx;
                  return (
                    <tr key={realIdx} style={{ borderBottom:"1px solid #f1f5f9", background: isEditing?"#f5f3ff":"transparent" }}>
                      <td style={{ padding:"4px 6px", textAlign:"center", width:28, color:"#94a3b8", fontSize:11, fontWeight:600 }}>{urutan+1}</td>
                      <td style={{ padding:"4px 6px", textAlign:"center", width:50 }}>
                        {isEditing ? (
                          <input type="number" value={p.number} onChange={e=>updatePlayer(realIdx,"number",e.target.value)} style={{ width:40, textAlign:"center", border:"1px solid #c4b5fd", borderRadius:4, padding:"2px", fontSize:12, fontWeight:700, color:KEC_COLOR }} />
                        ) : (<span style={{ fontWeight:700, color:KEC_COLOR }}>{p.number||"-"}</span>)}
                      </td>
                      <td style={{ padding:"6px 8px", fontWeight:600 }}>{p.name}</td>
                      <td style={{ padding:"4px 6px" }}>
                        {isEditing ? (
                          <select value={p.pos} onChange={e=>updatePlayer(realIdx,"pos",e.target.value)} style={{ border:"1px solid #c4b5fd", borderRadius:4, padding:"3px 6px", fontSize:11 }}>
                            <option value="GK">Kiper (GK)</option><option value="FP">Pemain (FP)</option><option value="CF">Pivot (CF)</option>
                          </select>
                        ) : (<span style={{ fontSize:11, color:"#64748b" }}>{p.pos||"-"}</span>)}
                      </td>
                      <td style={{ padding:"4px 6px", whiteSpace:"nowrap" }}>
                        {isEditing ? (
                          <button onClick={()=>setEditingPlayer(null)} style={{ background:"#dcfce7", border:"none", color:"#16a34a", borderRadius:5, padding:"2px 8px", cursor:"pointer", fontSize:11, fontWeight:700 }}>✓ Selesai</button>
                        ) : (
                          <div style={{ display:"flex", gap:4 }}>
                            <button onClick={()=>setEditingPlayer(realIdx)} style={{ background:"#f5f3ff", border:"none", color:KEC_COLOR, borderRadius:5, padding:"2px 7px", cursor:"pointer", fontSize:11, fontWeight:700 }}>✏️</button>
                            <button onClick={()=>removePlayer(realIdx)} style={{ background:"#fee2e2", border:"none", color:"#ef4444", borderRadius:5, padding:"2px 7px", cursor:"pointer", fontSize:11, fontWeight:700 }}>×</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <input placeholder="Nama pemain" value={newPlayer.name} onChange={e=>setNewPlayer(p=>({...p,name:e.target.value}))} style={{ flex:3, border:"1px solid #e2e8f0", borderRadius:6, padding:"6px 10px", fontSize:12, minWidth:120 }} />
            <input type="number" placeholder="No" value={newPlayer.number} onChange={e=>setNewPlayer(p=>({...p,number:e.target.value}))} style={{ width:56, border:"1px solid #e2e8f0", borderRadius:6, padding:"6px 8px", fontSize:12, textAlign:"center" }} />
            <select value={newPlayer.pos} onChange={e=>setNewPlayer(p=>({...p,pos:e.target.value}))} style={{ border:"1px solid #e2e8f0", borderRadius:6, padding:"6px 8px", fontSize:12 }}>
              <option value="GK">Kiper (GK)</option><option value="FP">Pemain (FP)</option><option value="CF">Pivot (CF)</option>
            </select>
            <button onClick={addPlayer} style={{ background:KEC_COLOR, color:"#fff", border:"none", borderRadius:6, padding:"6px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Tambah</button>
          </div>
          {data.players.length > 0 && (
            <div style={{ display:"flex", gap:8, marginTop:8, paddingTop:8, borderTop:"1px solid #f1f5f9" }}>
              <button onClick={exportExcel} style={{ flex:1, background:"#f0fdf4", border:"1px solid #86efac", color:"#16a34a", borderRadius:6, padding:"7px", fontSize:12, fontWeight:700, cursor:"pointer" }}>📥 Download Excel</button>
              <button onClick={exportPDF} style={{ flex:1, background:"#f5f3ff", border:"1px solid #c4b5fd", color:KEC_COLOR, borderRadius:6, padding:"7px", fontSize:12, fontWeight:700, cursor:"pointer" }}>🖨️ Download PDF</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN ───────────────────────────────────────────────────────
function LoginScreen({ onLogin, onBack }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    if (pw === ADMIN_PASSWORD) onLogin();
    else { setErr(true); setPw(""); }
  };
  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(135deg,#5b21b6,${KEC_COLOR})`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Inter,sans-serif" }}>
      <div style={{ background:"#fff", borderRadius:20, padding:"40px 36px", width:340, boxShadow:"0 20px 60px #0004" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>🔐</div>
          <div style={{ fontWeight:800, fontSize:20, color:"#1e293b" }}>Admin Login</div>
          <div style={{ color:"#94a3b8", fontSize:13, marginTop:4 }}>Kecamatan Pasar Rebo</div>
        </div>
        <input type="password" placeholder="Password admin..." value={pw}
          onChange={e=>{setPw(e.target.value);setErr(false);}}
          onKeyDown={e=>e.key==="Enter"&&submit()}
          style={{ width:"100%", padding:"12px 14px", border:`2px solid ${err?"#ef4444":"#e2e8f0"}`, borderRadius:10, fontSize:14, outline:"none", boxSizing:"border-box", marginBottom:8 }} />
        {err&&<div style={{ color:"#ef4444", fontSize:12, marginBottom:8 }}>❌ Password salah.</div>}
        <button onClick={submit} style={{ width:"100%", padding:"12px", background:`linear-gradient(135deg,#5b21b6,${KEC_COLOR})`, color:"#fff", border:"none", borderRadius:10, fontWeight:700, fontSize:14, cursor:"pointer", marginBottom:10 }}>
          Masuk sebagai Admin
        </button>
        <button onClick={onBack} style={{ width:"100%", padding:"10px", background:"#f1f5f9", color:"#64748b", border:"none", borderRadius:10, fontWeight:600, fontSize:13, cursor:"pointer" }}>
          ← Kembali
        </button>
      </div>
    </div>
  );
}

// ─── SCORER EDITOR (untuk kartu jadwal) ──────────────────────────
function ScheduleScorers({ match, home, away, roster, isAdmin, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [ns, setNs] = useState({ name:"", side:"home", goals:1 });
  const scorers = match.scorers || [];
  const total = scorers.reduce((s,c)=>s+(parseInt(c.goals)||0),0);
  const add = () => {
    if (!ns.name.trim()) return;
    onUpdate({ ...match, scorers:[...scorers, { name:ns.name.trim(), side:ns.side, goals:parseInt(ns.goals)||1 }] });
    setNs({ name:"", side:"home", goals:1 });
  };
  const remove = (i) => onUpdate({ ...match, scorers: scorers.filter((_,idx)=>idx!==i) });
  const teamPlayers = roster?.[ns.side==="home"?home:away]?.players || [];

  // Publik: tampilkan ringkas bila ada gol
  if (!isAdmin) {
    if (scorers.length === 0) return null;
    return (
      <div style={{ marginTop:8, paddingTop:8, borderTop:"1px solid #f1f5f9", display:"flex", flexWrap:"wrap", gap:5 }}>
        {scorers.map((s,i)=>(
          <span key={i} style={{ fontSize:11, background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:6, padding:"2px 8px", color:"#92400e" }}>
            ⚽ {s.name} <b>({s.side==="home"?home:away})</b> ×{s.goals}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginTop:8, borderTop:"1px solid #f1f5f9" }}>
      <button onClick={()=>setOpen(!open)}
        style={{ width:"100%", background: open?"#fffbeb":"transparent", border:"none", padding:"6px 0", fontSize:11, fontWeight:700, color: total>0?"#d97706":"#94a3b8", cursor:"pointer", textAlign:"left" }}>
        {total>0 ? `⚽ ${total} Gol — ${open?"Tutup":"Lihat/Edit"}` : "⚽ Tambah Pencetak Gol"}
      </button>
      {open && (
        <div style={{ padding:"8px 0 4px", display:"flex", flexDirection:"column", gap:8 }}>
          {scorers.length>0 && (
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {scorers.map((s,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:4, background:"#fff", border:"1px solid #fcd34d", borderRadius:6, padding:"3px 8px", fontSize:11 }}>
                  <span style={{ fontWeight:600 }}>{s.name}</span>
                  <span style={{ color:"#94a3b8" }}>({s.side==="home"?home:away})</span>
                  <span style={{ color:"#f59e0b", fontWeight:700 }}>×{s.goals}</span>
                  <button onClick={()=>remove(i)} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:12, lineHeight:1, padding:"0 2px" }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
            <select value={ns.side} onChange={e=>setNs(p=>({...p,side:e.target.value,name:""}))}
              style={{ border:"1px solid #e2e8f0", borderRadius:5, padding:"4px 6px", fontSize:11 }}>
              <option value="home">{home}</option>
              <option value="away">{away}</option>
            </select>
            {teamPlayers.length>0 ? (
              <select value={ns.name} onChange={e=>setNs(p=>({...p,name:e.target.value}))}
                style={{ border:"1px solid #e2e8f0", borderRadius:5, padding:"4px 8px", fontSize:11, minWidth:130 }}>
                <option value="">— Pilih pemain —</option>
                {[...teamPlayers].sort((a,b)=>(parseInt(a.number)||99)-(parseInt(b.number)||99)).map((p,pi)=>(
                  <option key={pi} value={p.name}>{p.number?`#${p.number} `:""}{p.name}</option>
                ))}
              </select>
            ) : (
              <input placeholder="Nama pemain" value={ns.name} onChange={e=>setNs(p=>({...p,name:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&add()}
                style={{ border:"1px solid #e2e8f0", borderRadius:5, padding:"4px 8px", fontSize:11, width:130 }} />
            )}
            <input type="number" min="1" value={ns.goals} onChange={e=>setNs(p=>({...p,goals:e.target.value}))}
              style={{ width:40, border:"1px solid #e2e8f0", borderRadius:5, padding:"4px", fontSize:11, textAlign:"center" }} />
            <button onClick={add}
              style={{ background:"#f59e0b", color:"#fff", border:"none", borderRadius:5, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer" }}>+ Tambah</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HALAMAN UTAMA ───────────────────────────────────────────────
function KecamatanPage({ kecamatan, setKecamatan, isAdmin, onSave, onAdminClick, onLogout }) {
  const [cat, setCat] = useState("U16");
  const [tab, setTab] = useState("standings");
  const [saved, setSaved] = useState(false);

  const catData   = kecamatan[cat] || initKecamatan[cat];
  const teams     = kecamatan.teams || KEC_TEAMS_DEFAULT;
  const stats     = calcStats(teams, catData.matches);
  const finalist1 = stats[0]?.team;
  const finalist2 = stats[1]?.team;

  const handleSave = async () => {
    await onSave();
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  };

  const updMatch = (id, field, val) =>
    setKecamatan(prev => ({
      ...prev,
      [cat]: { ...prev[cat], matches: prev[cat].matches.map(m => m.id===id?{...m,[field]:val}:m) }
    }));

  const updFinal = val =>
    setKecamatan(prev => ({
      ...prev,
      [cat]: { ...prev[cat], final: { ...val, home:finalist1||"", away:finalist2||"" } }
    }));

  const updRoster = updater =>
    setKecamatan(prev => {
      const cur = prev[cat].roster || {};
      const next = typeof updater === "function" ? updater(cur) : updater;
      return { ...prev, [cat]: { ...prev[cat], roster: next } };
    });

  const shuffleSchedule = () => {
    if (!window.confirm(`Acak ulang jadwal ${cat}? Semua skor & pencetak gol kategori ${cat} akan direset.`)) return;
    const rot = Math.floor((new Date().getTime() / 1000) % (teams.length - 1)) + 1;
    setKecamatan(prev => ({ ...prev, [cat]: { ...prev[cat], matches: generateKecMatches(teams, cat, rot) } }));
  };

  const matchResult = m => {
    if (m.wo==="home_wo") return { score:"3 - 0", wo:true };
    if (m.wo==="away_wo") return { score:"0 - 3", wo:true };
    if (m.homeScore===""||m.awayScore==="") return null;
    return { score:`${m.homeScore} - ${m.awayScore}`, wo:false };
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,#5b21b6,${KEC_COLOR})`, borderRadius:16, padding:"20px 24px", color:"#fff", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:700 }}>Turnamen Futsal Kecamatan Pasar Rebo 2026</h1>
          <p style={{ margin:"4px 0 0", opacity:0.8, fontSize:13 }}>5 Kelurahan · Round-Robin · Live Standings</p>
          <p style={{ margin:"4px 0 0", opacity:0.8, fontSize:13 }}>Created by Rahmat Mulyana Karang Taruna Kelurahan Kalisari</p>
        </div>
        {isAdmin
          ? <button onClick={onLogout} style={{ background:"#ffffff22", border:"1px solid #ffffff44", color:"#fff", borderRadius:10, padding:"8px 14px", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>🚪 Keluar</button>
          : <button onClick={onAdminClick} style={{ background:"#ffffff22", border:"1px solid #ffffff44", color:"#fff", borderRadius:10, padding:"8px 14px", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>🔐 Admin</button>
        }
      </div>

      {isAdmin && (
        <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:10, padding:"10px 16px", fontSize:12, color:"#92400e", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span>🔐 <b>Mode Admin Aktif</b> — Edit skor, tanggal, waktu, dan WO.</span>
          <button onClick={handleSave}
            style={{ background:saved?"#10b981":KEC_COLOR, border:"none", color:"#fff", borderRadius:8, padding:"7px 16px", cursor:"pointer", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
            {saved?"✅ Tersimpan!":"💾 Simpan"}
          </button>
        </div>
      )}

      {/* Kategori */}
      <div style={{ display:"flex", gap:8 }}>
        {["U16","U13"].map(c=>(
          <button key={c} onClick={()=>{setCat(c);setTab("standings");}}
            style={{ padding:"10px 28px", borderRadius:10, border:"none", cursor:"pointer", fontWeight:800, fontSize:15, background:cat===c?KEC_COLOR:"#fff", color:cat===c?"#fff":"#64748b", boxShadow:cat===c?`0 3px 10px ${KEC_COLOR}55`:"0 1px 3px #0001" }}>
            {c}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {[["standings","📊 Klasemen"],["schedule","📋 Jadwal & Hasil"],["topscorer","⚽ Top Skor"],["final","🏆 Final"],["roster","👥 Tim & Pemain"]].map(([k,v])=>(
          <button key={k} onClick={()=>setTab(k)}
            style={{ padding:"7px 16px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:13, background:tab===k?KEC_COLOR:"#f1f5f9", color:tab===k?"#fff":"#64748b", boxShadow:tab===k?`0 2px 6px ${KEC_COLOR}44`:"none" }}>
            {v}
          </button>
        ))}
      </div>

      {/* ── Klasemen ── */}
      {tab==="standings" && (
        <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 6px #0001" }}>
          <div style={{ background:KEC_COLOR, color:"#fff", padding:"12px 20px", fontWeight:700, fontSize:14, display:"flex", justifyContent:"space-between" }}>
            <span>Klasemen {cat}</span>
            <span style={{ fontSize:11, opacity:0.85 }}>Top 2 → Final</span>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ background:"#f8fafc" }}>
                  {["#","Tim","M","M","S","K","GM","GK","SG","🟡","🔴","Poin"].map((h,i)=>(
                    <th key={i} style={{ padding:"8px 6px", color:"#64748b", textAlign:i<2?"left":"center", fontWeight:600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.map((s,i)=>(
                  <tr key={s.team} style={{ borderBottom:"1px solid #f1f5f9", background:i<2?KEC_BG:"#fff" }}>
                    <td style={{ padding:"8px 6px", fontWeight:700, color:i<2?KEC_COLOR:"#94a3b8" }}>{i+1}{i<2?"✓":""}</td>
                    <td style={{ padding:"8px 6px", fontWeight:600, color:"#1e293b" }}>
                      {s.team}
                      {i===0&&<span style={{ fontSize:10,background:KEC_COLOR,color:"#fff",borderRadius:4,padding:"1px 4px",marginLeft:4 }}>Juara</span>}
                      {i===1&&<span style={{ fontSize:10,background:"#f59e0b",color:"#fff",borderRadius:4,padding:"1px 4px",marginLeft:4 }}>Runner Up</span>}
                    </td>
                    {[s.p,s.w,s.d,s.l,s.gf,s.ga].map((v,j)=>(
                      <td key={j} style={{ padding:"8px 6px", textAlign:"center", color:j===1?"#10b981":j===2?"#f59e0b":j===3?"#ef4444":"#1e293b" }}>{v}</td>
                    ))}
                    <td style={{ padding:"8px 6px", textAlign:"center", fontWeight:600, color:s.gd>0?"#10b981":s.gd<0?"#ef4444":"#64748b" }}>{s.gd>0?"+":""}{s.gd}</td>
                    <td style={{ padding:"8px 6px", textAlign:"center" }}>{s.yc}</td>
                    <td style={{ padding:"8px 6px", textAlign:"center" }}>{s.rc}</td>
                    <td style={{ padding:"8px 6px", textAlign:"center", fontWeight:700, color:KEC_COLOR, fontSize:14 }}>{s.pts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding:"10px 16px", background:"#faf5ff", fontSize:11, color:"#6b21a8", lineHeight:1.7 }}>
            <b>📌 Keterangan:</b> M=Main · GM=Gol Masuk · GK=Gol Kemasukan · SG=Selisih Gol<br/>
            <b>Ranking:</b> Poin → Selisih Gol → Head-to-Head → Akumulasi Kartu
          </div>
        </div>
      )}

      {/* ── Jadwal & Hasil ── */}
      {tab==="schedule" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {isAdmin && (
            <button onClick={shuffleSchedule}
              style={{ alignSelf:"flex-start", background:"#fff", border:`1px solid ${KEC_COLOR}`, color:KEC_COLOR, borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              🔀 Acak Ulang Jadwal {cat}
            </button>
          )}
          {catData.matches.map(m => {
            const res = matchResult(m);
            const winner = res&&!res.wo&&m.homeScore!==""
              ? (parseInt(m.homeScore)>parseInt(m.awayScore)?m.home:parseInt(m.awayScore)>parseInt(m.homeScore)?m.away:null)
              : res?.wo?(m.wo==="home_wo"?m.home:m.away):null;
            return (
              <div key={m.id} style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px #0001" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", background:KEC_COLOR+"15", borderBottom:`2px solid ${KEC_COLOR}33` }}>
                  <span style={{ background:KEC_COLOR, color:"#fff", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:800, minWidth:28, textAlign:"center" }}>
                    {String(m.matchNo).padStart(2,"0")}
                  </span>
                  <span style={{ fontSize:11, fontWeight:700, color:KEC_COLOR }}>{cat}</span>
                  <span style={{ fontSize:10, color:"#94a3b8", marginLeft:4 }}>⏱ 20 mnt</span>
                  {(m.date||m.time) && (
                    <span style={{ fontSize:10, background:"#f1f5f9", borderRadius:5, padding:"1px 8px", color:"#64748b", marginLeft:"auto" }}>
                      {m.date&&new Date(m.date).toLocaleDateString("id-ID",{day:"numeric",month:"short"})}
                      {m.date&&m.time&&" · "}{m.time&&m.time+" WIB"}
                    </span>
                  )}
                </div>
                <div style={{ padding:"10px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center" }}>
                    <div style={{ flex:1, textAlign:"right", fontWeight:700, fontSize:13, color:winner===m.home?"#10b981":"#1e293b" }}>{m.home}</div>
                    <div style={{ width:100, textAlign:"center", margin:"0 10px" }}>
                      {isAdmin ? (
                        m.wo!=="none" ? (
                          <div style={{ background:"#f5f3ff", borderRadius:8, padding:"4px 10px", color:"#7c3aed", fontWeight:700 }}>
                            {m.wo==="home_wo"?"3 - 0":"0 - 3"}
                          </div>
                        ) : (
                          <div style={{ display:"flex", alignItems:"center", gap:3, justifyContent:"center" }}>
                            <input type="number" min="0" value={m.homeScore} onChange={e=>updMatch(m.id,"homeScore",e.target.value)}
                              style={{ width:34, textAlign:"center", border:"1px solid #e2e8f0", borderRadius:4, padding:"3px", fontSize:14, fontWeight:700 }} />
                            <span style={{ color:"#94a3b8", fontWeight:700 }}>-</span>
                            <input type="number" min="0" value={m.awayScore} onChange={e=>updMatch(m.id,"awayScore",e.target.value)}
                              style={{ width:34, textAlign:"center", border:"1px solid #e2e8f0", borderRadius:4, padding:"3px", fontSize:14, fontWeight:700 }} />
                          </div>
                        )
                      ) : res ? (
                        <div style={{ background:res.wo?"#f5f3ff":"#f1f5f9", borderRadius:8, padding:"4px 10px" }}>
                          <div style={{ fontWeight:700, color:res.wo?"#7c3aed":"#1e293b", fontSize:15 }}>{res.score}</div>
                          {res.wo&&<div style={{ fontSize:9, color:"#7c3aed" }}>WO</div>}
                        </div>
                      ) : (
                        <div style={{ background:"#f8fafc", borderRadius:8, padding:"4px 10px", color:"#cbd5e1", fontSize:12, fontWeight:600 }}>VS</div>
                      )}
                    </div>
                    <div style={{ flex:1, textAlign:"left", fontWeight:700, fontSize:13, color:winner===m.away?"#10b981":"#1e293b" }}>{m.away}</div>
                  </div>
                  {isAdmin && (
                    <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap", alignItems:"center" }}>
                      <select value={m.wo} onChange={e=>updMatch(m.id,"wo",e.target.value)}
                        style={{ fontSize:11, border:"1px solid #e2e8f0", borderRadius:4, padding:"2px 6px", color:"#64748b" }}>
                        <option value="none">— Normal —</option>
                        <option value="home_wo">{m.home} WO</option>
                        <option value="away_wo">{m.away} WO</option>
                      </select>
                      <input type="date" value={m.date||""} onChange={e=>updMatch(m.id,"date",e.target.value)}
                        style={{ border:"1px solid #e2e8f0", borderRadius:4, padding:"2px 5px", fontSize:11 }} />
                      <input type="time" value={m.time||""} onChange={e=>updMatch(m.id,"time",e.target.value)}
                        style={{ border:"1px solid #e2e8f0", borderRadius:4, padding:"2px 5px", fontSize:11 }} />
                    </div>
                  )}
                  <ScheduleScorers match={m} home={m.home} away={m.away}
                    roster={catData.roster||{}} isAdmin={isAdmin}
                    onUpdate={updated=>updMatch(m.id,"scorers",updated.scorers)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Final ── */}
      {tab==="final" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 6px #0001" }}>
            <div style={{ background:KEC_COLOR, color:"#fff", padding:"12px 20px", fontWeight:700, fontSize:14 }}>🏆 Final {cat} — Kecamatan Pasar Rebo</div>
            <div style={{ padding:16, display:"flex", flexDirection:"column", gap:10 }}>
              {[[finalist1,"Juara Grup"],[finalist2,"Runner Up"]].map(([team,label],i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderRadius:10, background:KEC_BG, border:`2px solid ${KEC_COLOR}33` }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:KEC_COLOR, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:16 }}>
                    {i===0?"🥇":"🥈"}
                  </div>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>{team||<span style={{ color:"#cbd5e1" }}>Belum ditentukan</span>}</div>
                    <div style={{ fontSize:12, color:"#64748b" }}>{label} {cat}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <MatchCard
            label={`🏆 FINAL ${cat} — ${finalist1||"Juara"} vs ${finalist2||"Runner Up"}`}
            home={finalist1} away={finalist2}
            match={catData.final}
            isAdmin={isAdmin}
            onUpdate={updFinal}
            roster={catData.roster||{}}
          />
          {getKnockoutWinner(finalist1, finalist2, catData.final) && (
            <div style={{ background:`linear-gradient(135deg,#5b21b6,${KEC_COLOR})`, borderRadius:16, padding:"28px 20px", textAlign:"center", color:"#fff", boxShadow:`0 6px 24px ${KEC_COLOR}55` }}>
              <div style={{ fontSize:48 }}>🏆</div>
              <div style={{ fontSize:22, fontWeight:800, marginTop:8 }}>{getKnockoutWinner(finalist1, finalist2, catData.final)}</div>
              <div style={{ fontSize:13, opacity:0.85, marginTop:4 }}>Juara {cat} Futsal Kecamatan Pasar Rebo</div>
            </div>
          )}
        </div>
      )}

      {tab==="topscorer" && (
        <TopScorers matches={catData.matches} final={catData.final} />
      )}

      {tab==="roster" && (
        isAdmin
          ? <RosterAdmin teams={teams} roster={catData.roster||{}} setRoster={updRoster} cat={cat} />
          : <RosterView teams={teams} roster={catData.roster||{}} />
      )}

      <div style={{ marginTop:8, padding:"16px 0 8px", textAlign:"center" }}>
        <div style={{ fontSize:12, color:"#94a3b8" }}>
          Futsal Kecamatan Pasar Rebo 2026 · Karang Taruna Kelurahan Kalisari<br/>
          <span style={{ fontSize:11 }}>Dibuat oleh <b>Rahmat Mulyana</b></span>
        </div>
      </div>
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────
export default function App() {
  const [kecamatan, setKecamatan] = useState(initKecamatan);
  const [mode, setMode] = useState("public");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(DATA_DOC, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.kecamatan) setKecamatan(d.kecamatan);
      }
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const handleSave = async () => {
    const snap = await getDoc(DATA_DOC);
    const existing = snap.exists() ? snap.data() : {};
    await setDoc(DATA_DOC, { ...existing, kecamatan });
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Inter,sans-serif", background:"#f8fafc" }}>
      <div style={{ textAlign:"center", color:"#64748b" }}>
        <div style={{ fontSize:36, marginBottom:12 }}>🏙️</div>
        <div style={{ fontWeight:600 }}>Memuat data...</div>
      </div>
    </div>
  );

  if (mode === "login") return (
    <LoginScreen onLogin={()=>setMode("admin")} onBack={()=>setMode("public")} />
  );

  const isAdmin = mode === "admin";

  return (
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8fafc", minHeight:"100vh", padding:16 }}>
      <div style={{ maxWidth:900, margin:"0 auto" }}>
        <KecamatanPage
          kecamatan={kecamatan}
          setKecamatan={setKecamatan}
          isAdmin={isAdmin}
          onSave={handleSave}
          onAdminClick={()=>setMode("login")}
          onLogout={()=>setMode("public")}
        />
      </div>
    </div>
  );
}
