import { useState, useEffect } from "react";
import { doc, setDoc, onSnapshot, getDoc } from "firebase/firestore";
import { db, DATA_DOC } from "./firebase";

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

const KEC_COLOR = "#8b5cf6";
const KEC_BG    = "#f5f3ff";
const KEC_TEAMS_DEFAULT = ["Kalisari","Cijantung","Kp. Gedong","Baru","Pekayon"];

function generateKecMatches(teams, cat) {
  const matches = [];
  let no = 1;
  for (let i = 0; i < teams.length; i++)
    for (let j = i + 1; j < teams.length; j++)
      matches.push({
        id:`kec-${cat}-${i}-${j}`, home:teams[i], away:teams[j],
        homeScore:"", awayScore:"", wo:"none",
        yellowHome:0, yellowAway:0, redHome:0, redAway:0,
        scorers:[], date:"", time:"", matchNo:no++,
      });
  return matches;
}

const initKecamatan = (() => {
  const t = KEC_TEAMS_DEFAULT;
  const mkFinal = () => ({ homeScore:"", awayScore:"", wo:"none", scorers:[], home:"", away:"" });
  return {
    teams: t,
    U16: { matches: generateKecMatches(t,"U16"), final: mkFinal() },
    U13: { matches: generateKecMatches(t,"U13"), final: mkFinal() },
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

// ─── MATCH CARD ──────────────────────────────────────────────────
function MatchCard({ label, home, away, match, isAdmin, onUpdate }) {
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

// ─── HALAMAN UTAMA ───────────────────────────────────────────────
function KecamatanPage({ kecamatan, setKecamatan, isAdmin, onSave }) {
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

  const matchResult = m => {
    if (m.wo==="home_wo") return { score:"3 - 0", wo:true };
    if (m.wo==="away_wo") return { score:"0 - 3", wo:true };
    if (m.homeScore===""||m.awayScore==="") return null;
    return { score:`${m.homeScore} - ${m.awayScore}`, wo:false };
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,#5b21b6,${KEC_COLOR})`, borderRadius:12, padding:"16px 20px", color:"#fff", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16 }}>🏙️ Futsal Kecamatan Pasar Rebo</div>
          <div style={{ fontSize:12, opacity:0.85, marginTop:4 }}>5 Kelurahan · Round-Robin · 20 menit/pertandingan</div>
        </div>
        {isAdmin && (
          <button onClick={handleSave}
            style={{ background:saved?"#10b98122":"#ffffff22", border:`1px solid ${saved?"#10b98166":"#ffffff44"}`, color:saved?"#6ee7b7":"#fff", borderRadius:10, padding:"8px 16px", cursor:"pointer", fontSize:12, fontWeight:700 }}>
            {saved?"✅ Tersimpan!":"💾 Simpan"}
          </button>
        )}
      </div>

      {isAdmin && (
        <div style={{ background:"#fef3c7", border:"1px solid #fcd34d", borderRadius:10, padding:"10px 16px", fontSize:12, color:"#92400e" }}>
          🔐 <b>Mode Admin Aktif</b> — Edit skor, tanggal, waktu, dan WO. Klik Simpan setelah selesai.
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
        {[["standings","📊 Klasemen"],["schedule","📋 Jadwal & Hasil"],["final","🏆 Final"]].map(([k,v])=>(
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
    <div style={{ fontFamily:"Inter,sans-serif", background:"#f8fafc", minHeight:"100vh" }}>
      <nav style={{ background:"#1e293b", position:"sticky", top:0, zIndex:100, boxShadow:"0 2px 8px #0003" }}>
        <div style={{ maxWidth:900, margin:"0 auto", padding:"0 16px", display:"flex", alignItems:"center", height:52 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1 }}>
            <span style={{ fontSize:20 }}>🏙️</span>
            <span style={{ color:"#fff", fontWeight:800, fontSize:13, lineHeight:1.3 }}>
              Futsal Kecamatan <span style={{ fontWeight:400, fontSize:11, opacity:0.65 }}>Pasar Rebo 2026</span>
            </span>
          </div>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {isAdmin && (
              <span style={{ fontSize:10, background:"#f59e0b33", color:"#fbbf24", border:"1px solid #f59e0b44", borderRadius:5, padding:"2px 7px", fontWeight:700 }}>
                ADMIN
              </span>
            )}
            {isAdmin
              ? <button onClick={()=>setMode("public")} style={{ background:"#ef444422", border:"1px solid #ef444444", color:"#fca5a5", borderRadius:7, padding:"5px 10px", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>🚪 Keluar</button>
              : <button onClick={()=>setMode("login")} style={{ background:"#ffffff11", border:"1px solid #ffffff22", color:"#94a3b8", borderRadius:7, padding:"5px 10px", cursor:"pointer", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>🔐 Admin</button>
            }
          </div>
        </div>
      </nav>
      <div style={{ maxWidth:900, margin:"0 auto", padding:16 }}>
        <KecamatanPage
          kecamatan={kecamatan}
          setKecamatan={setKecamatan}
          isAdmin={isAdmin}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
