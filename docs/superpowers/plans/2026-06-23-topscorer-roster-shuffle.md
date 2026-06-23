# Top Skor, Roster, dan Acak Jadwal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan tab Top Skor, tab Tim & Pemain (roster per kategori), input pencetak gol, dan penjadwalan anti-back-to-back dengan tombol acak ulang ke aplikasi Futsal Kecamatan Pasar Rebo.

**Architecture:** Single-file React app (`src/App.jsx`). Semua komponen baru ditambahkan di file yang sama mengikuti pola FFU Kalisari (`/Users/rahmatmulyana/futsal-tournament/src/App.jsx`). State `roster` disimpan per kategori di dalam objek `kecamatan` sehingga otomatis ikut `handleSave` ke Firestore. Tidak ada test framework di project — verifikasi logika murni lewat script Node sekali pakai di scratchpad, verifikasi UI lewat `npm run build` + `npm run lint`.

**Tech Stack:** React 19, Vite, Firebase Firestore, oxlint. Inline styles (tidak ada CSS module). Tidak ada test runner.

## Global Constraints

- Bahasa UI: Indonesia. Warna tema: `KEC_COLOR = "#8b5cf6"`, `KEC_BG = "#f5f3ff"`, gradient gelap `#5b21b6`.
- Tim default: `KEC_TEAMS_DEFAULT = ["Kalisari","Cijantung","Kp. Gedong","Baru","Pekayon"]` (5 tim, ganjil).
- Kategori: `U16`, `U13`. Roster & top skor DIPISAH per kategori.
- Scorer format mengikuti FFU: `{ name, side, goals }`, `side ∈ {"home","away"}`.
- Posisi pemain: `GK` (Kiper), `FP` (Pemain), `CF` (Pivot).
- Verifikasi tiap task: `npm run lint` harus bersih dari error baru (2 warning import lama `doc`/`db` boleh ada), dan `npm run build` harus sukses.
- Commit setiap akhir task.

---

## File Structure

- Modify: `src/App.jsx` — semua perubahan ada di sini (konstanta, helper, komponen, KecamatanPage, App).

Tidak ada file baru dalam kode produksi. Script verifikasi logika ditaruh di scratchpad (tidak di-commit).

---

### Task 1: Circle-method scheduler (anti back-to-back)

Ganti `generateKecMatches` agar urutan match menyebar — tidak ada tim main dua kali berturut-turut. Tambah parameter `rotate` untuk variasi urutan (dipakai tombol acak ulang).

**Files:**
- Modify: `src/App.jsx:11-23` (fungsi `generateKecMatches`)
- Verify (throwaway): `<scratchpad>/verify-schedule.mjs`

**Interfaces:**
- Produces: `generateKecMatches(teams, cat, rotate = 0)` → array match `{id, home, away, homeScore:"", awayScore:"", wo:"none", yellowHome:0, yellowAway:0, redHome:0, redAway:0, scorers:[], date:"", time:"", matchNo}`. `id` format `kec-${cat}-${a}-${b}` di mana `a<b` adalah indeks tim asli (stabil lintas rotate agar id unik & konsisten). `matchNo` urut 1..N sesuai urutan circle method.

- [ ] **Step 1: Tulis script verifikasi (failing)**

Buat `<scratchpad>/verify-schedule.mjs`:

```js
// Salin fungsi generateKecMatches versi baru ke sini setelah ditulis, lalu cek properti.
function generateKecMatches(teams, cat, rotate = 0) { /* diisi di Step 3 */ }

const teams = ["Kalisari","Cijantung","Kp. Gedong","Baru","Pekayon"];
const m = generateKecMatches(teams, "U16", 0);

// 1. Jumlah match = C(5,2) = 10
console.assert(m.length === 10, `FAIL jumlah match: ${m.length} (harus 10)`);

// 2. Semua pasangan unik muncul tepat sekali
const pairs = new Set(m.map(x => [x.home,x.away].sort().join("|")));
console.assert(pairs.size === 10, `FAIL pasangan unik: ${pairs.size}`);

// 3. Tidak ada tim main 2x berturut-turut
let backToBack = 0;
for (let i = 1; i < m.length; i++) {
  const prev = new Set([m[i-1].home, m[i-1].away]);
  if (prev.has(m[i].home) || prev.has(m[i].away)) backToBack++;
}
console.assert(backToBack === 0, `FAIL back-to-back: ${backToBack} kali`);

// 4. matchNo urut 1..10
console.assert(m.every((x,i) => x.matchNo === i+1), "FAIL matchNo tidak urut");

// 5. id unik
console.assert(new Set(m.map(x=>x.id)).size === 10, "FAIL id tidak unik");

// 6. rotate menghasilkan urutan berbeda tapi pasangan sama
const m2 = generateKecMatches(teams, "U16", 2);
const order1 = m.map(x=>x.id).join(",");
const order2 = m2.map(x=>x.id).join(",");
console.assert(order1 !== order2, "FAIL rotate tidak mengubah urutan");
const pairs2 = new Set(m2.map(x => [x.home,x.away].sort().join("|")));
console.assert(pairs2.size === 10, "FAIL rotate pasangan tidak lengkap");

console.log("Semua assertion lewat.");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node <scratchpad>/verify-schedule.mjs`
Expected: error / assertion gagal (fungsi masih kosong, `m.length` undefined).

- [ ] **Step 3: Implementasi circle method di App.jsx**

Ganti `src/App.jsx:11-23` dengan:

```jsx
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

  return ordered.map(([a, b], k) => ({
    id: `kec-${cat}-${a}-${b}`, home: teams[a], away: teams[b],
    homeScore: "", awayScore: "", wo: "none",
    yellowHome: 0, yellowAway: 0, redHome: 0, redAway: 0,
    scorers: [], date: "", time: "", matchNo: k + 1,
  }));
}
```

- [ ] **Step 4: Salin fungsi ke script verifikasi & jalankan, pastikan lewat**

Salin fungsi final ke `<scratchpad>/verify-schedule.mjs` (ganti placeholder Step 1).
Run: `node <scratchpad>/verify-schedule.mjs`
Expected: `Semua assertion lewat.`

- [ ] **Step 5: Lint & build**

Run: `npm run lint && npm run build`
Expected: build sukses, tidak ada error lint baru.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat: jadwal round-robin circle method (anti back-to-back)"
```

---

### Task 2: Roster per kategori di state default

Tambah `roster: {}` ke tiap kategori di `initKecamatan`, dan helper baca roster kategori aktif.

**Files:**
- Modify: `src/App.jsx:25-33` (`initKecamatan`)

**Interfaces:**
- Produces: `initKecamatan.U16.roster === {}` dan `initKecamatan.U13.roster === {}`. Bentuk roster saat terisi: `{ [namaTim]: { players: [{name, number, pos}], officials: [{name, role}] } }`.
- Consumes: `generateKecMatches` (Task 1).

- [ ] **Step 1: Tambah roster ke initKecamatan**

Ganti `src/App.jsx:25-33`:

```jsx
const initKecamatan = (() => {
  const t = KEC_TEAMS_DEFAULT;
  const mkFinal = () => ({ homeScore:"", awayScore:"", wo:"none", scorers:[], home:"", away:"" });
  return {
    teams: t,
    U16: { matches: generateKecMatches(t,"U16"), final: mkFinal(), roster: {} },
    U13: { matches: generateKecMatches(t,"U13"), final: mkFinal(), roster: {} },
  };
})();
```

- [ ] **Step 2: Lint & build**

Run: `npm run lint && npm run build`
Expected: build sukses.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: tambah state roster per kategori"
```

---

### Task 3: calcTopScorers + komponen TopScorers

Fungsi akumulasi pencetak gol dan komponen tabelnya.

**Files:**
- Modify: `src/App.jsx` — tambah fungsi `calcTopScorers` setelah `getKnockoutWinner` (sekitar baris 103-112), dan komponen `TopScorers` setelah `MatchCard`.
- Verify (throwaway): `<scratchpad>/verify-topscorer.mjs`

**Interfaces:**
- Produces: `calcTopScorers(matches, final)` → array `{name, team, goals}` terurut menurun, hanya `goals>0`.
- Produces: `<TopScorers matches={catData.matches} final={catData.final} />` → JSX tabel.
- Consumes: match `{home, away, scorers:[{name,side,goals}]}`.

- [ ] **Step 1: Tulis script verifikasi (failing)**

`<scratchpad>/verify-topscorer.mjs`:

```js
function calcTopScorers(matches, final) { /* diisi Step 3 */ }

const matches = [
  { home:"A", away:"B", scorers:[{name:"Budi",side:"home",goals:2},{name:"Tono",side:"away",goals:1}] },
  { home:"A", away:"C", scorers:[{name:"Budi",side:"home",goals:1}] },
  { home:"B", away:"C", scorers:[] },
];
const final = { home:"A", away:"B", scorers:[{name:"Tono",side:"away",goals:3}] };

const r = calcTopScorers(matches, final);
// Budi (A): 3 gol, Tono (B): 4 gol → Tono di atas
console.assert(r.length === 2, `FAIL panjang: ${r.length}`);
console.assert(r[0].name === "Tono" && r[0].goals === 4, `FAIL top: ${JSON.stringify(r[0])}`);
console.assert(r[1].name === "Budi" && r[1].goals === 3 && r[1].team === "A", `FAIL kedua: ${JSON.stringify(r[1])}`);
// scorer dengan goals 0 / match kosong tidak muncul
console.assert(r.every(s => s.goals > 0), "FAIL ada goals<=0");
console.log("Top scorer assertion lewat.");
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node <scratchpad>/verify-topscorer.mjs`
Expected: assertion gagal (fungsi kosong).

- [ ] **Step 3: Implementasi calcTopScorers**

Tambah setelah fungsi `getKnockoutWinner` (sebelum `// ─── MATCH CARD`):

```jsx
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
```

- [ ] **Step 4: Implementasi komponen TopScorers**

Tambah setelah komponen `MatchCard` (sebelum `// ─── LOGIN`):

```jsx
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
```

- [ ] **Step 5: Salin calcTopScorers ke script & jalankan**

Salin fungsi final ke `<scratchpad>/verify-topscorer.mjs`.
Run: `node <scratchpad>/verify-topscorer.mjs`
Expected: `Top scorer assertion lewat.`

- [ ] **Step 6: Lint & build**

Run: `npm run lint && npm run build`
Expected: sukses. (Komponen belum dipakai → boleh ada warning "unused" sementara; jika lint memblok, lanjut Task 6 yang memakainya sebelum commit final. Untuk sekarang abaikan warning unused.)

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat: calcTopScorers + komponen TopScorers"
```

---

### Task 4: Input pencetak gol di MatchCard (Final)

Tambah section scorer ala FFU ke `MatchCard`, dipakai di tab Final.

**Files:**
- Modify: `src/App.jsx` komponen `MatchCard` (saat ini sekitar baris 115-162).

**Interfaces:**
- Produces: `MatchCard` menerima prop tambahan `roster` (objek `{ [tim]: {players:[{name,number,pos}]} }`). Memanggil `onUpdate({...match, scorers:[...]})`.
- Consumes: `match.scorers`, `roster`.

- [ ] **Step 1: Tambah state & handler scorer di MatchCard**

Di awal `function MatchCard({ label, home, away, match, isAdmin, onUpdate })`, tambah param `roster` dan state:

Ubah signature menjadi:
```jsx
function MatchCard({ label, home, away, match, isAdmin, onUpdate, roster }) {
  const [showScorer, setShowScorer] = useState(false);
  const [newScorer, setNewScorer] = useState({ name:"", side:"home", goals:1 });
```

Tambah sebelum `return (` di dalam MatchCard:
```jsx
  const addScorer = () => {
    if (!newScorer.name.trim()) return;
    onUpdate({ ...match, scorers: [...(match.scorers||[]), { name: newScorer.name.trim(), side: newScorer.side, goals: parseInt(newScorer.goals)||1 }] });
    setNewScorer({ name:"", side:"home", goals:1 });
  };
  const removeScorer = (idx) => onUpdate({ ...match, scorers: (match.scorers||[]).filter((_,i)=>i!==idx) });
  const totalGoals = (match.scorers||[]).reduce((s,c)=>s+(parseInt(c.goals)||0),0);
```

- [ ] **Step 2: Tambah JSX section scorer**

Di dalam `return` MatchCard, sebelum penutup `</div>` terakhir (setelah blok `{wo!=="none"&&...}` baris ~159), tambah:

```jsx
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
```

- [ ] **Step 3: Teruskan roster ke MatchCard di tab Final**

Di `KecamatanPage`, pada pemakaian `<MatchCard ... />` di tab final (sekitar baris 411-417), tambah prop `roster={catData.roster||{}}`.

- [ ] **Step 4: Lint & build**

Run: `npm run lint && npm run build`
Expected: sukses.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: input pencetak gol di MatchCard final"
```

---

### Task 5: RosterView (publik) + RosterAdmin (admin)

Komponen daftar pemain & official, versi baca dan versi kelola, dengan export Excel/PDF.

**Files:**
- Modify: `src/App.jsx` — tambah `RosterView` dan `RosterAdmin` setelah `TopScorers`.

**Interfaces:**
- Produces: `<RosterView teams={teams} roster={catData.roster||{}} />`
- Produces: `<RosterAdmin teams={teams} roster={catData.roster||{}} setRoster={fn} cat={cat} />` di mana `setRoster(updaterOrObject)` menyimpan roster ke `kecamatan[cat].roster`.
- Consumes: `teams` (array nama tim), roster `{ [tim]: {players:[{name,number,pos}], officials:[{name,role}]} }`.

- [ ] **Step 1: Implementasi RosterView**

Tambah setelah komponen `TopScorers`:

```jsx
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
```

- [ ] **Step 2: Implementasi RosterAdmin**

Tambah setelah `RosterView`:

```jsx
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
```

- [ ] **Step 3: Lint & build**

Run: `npm run lint && npm run build`
Expected: sukses (komponen belum dipakai → abaikan warning unused sampai Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: komponen RosterView dan RosterAdmin per kategori"
```

---

### Task 6: Wiring tab + handler roster + tombol acak ulang di KecamatanPage

Menyambungkan semua komponen ke `KecamatanPage`: tab baru, handler roster, tombol acak ulang.

**Files:**
- Modify: `src/App.jsx` — `KecamatanPage` (tabs ~266-273, body), tambah handler.

**Interfaces:**
- Consumes: `TopScorers`, `RosterView`, `RosterAdmin` (Task 3,5), `generateKecMatches` (Task 1).
- Produces: tab `topscorer` & `roster`, fungsi `updRoster`, fungsi `shuffleSchedule`.

- [ ] **Step 1: Tambah handler roster & acak ulang**

Di `KecamatanPage`, setelah `updFinal` (sekitar baris 220-224), tambah:

```jsx
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
```

- [ ] **Step 2: Tambah tab topscorer & roster**

Ganti baris sub-tabs (sekitar 266-273) agar daftar tab menjadi:

```jsx
        {[["standings","📊 Klasemen"],["schedule","📋 Jadwal & Hasil"],["topscorer","⚽ Top Skor"],["final","🏆 Final"],["roster","👥 Tim & Pemain"]].map(([k,v])=>(
```

(struktur button tetap sama).

- [ ] **Step 3: Render tab topscorer & roster + tombol acak ulang**

Setelah blok `{tab==="final" && (...)}` (sebelum footer ~428), tambah:

```jsx
      {tab==="topscorer" && (
        <TopScorers matches={catData.matches} final={catData.final} />
      )}

      {tab==="roster" && (
        isAdmin
          ? <RosterAdmin teams={teams} roster={catData.roster||{}} setRoster={updRoster} cat={cat} />
          : <RosterView teams={teams} roster={catData.roster||{}} />
      )}
```

Di dalam blok `{tab==="schedule" && (` , tepat setelah `<div style={{ display:"flex", flexDirection:"column", gap:8 }}>` pembuka, tambah tombol acak ulang (admin):

```jsx
          {isAdmin && (
            <button onClick={shuffleSchedule}
              style={{ alignSelf:"flex-start", background:"#fff", border:`1px solid ${KEC_COLOR}`, color:KEC_COLOR, borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>
              🔀 Acak Ulang Jadwal {cat}
            </button>
          )}
```

- [ ] **Step 4: Lint & build**

Run: `npm run lint && npm run build`
Expected: sukses, tidak ada warning unused untuk komponen baru (semua sudah dipakai).

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: wiring tab top skor & roster, tombol acak ulang jadwal"
```

---

## Self-Review

**Spec coverage:**
- Top Skor (calc + komponen + input scorer) → Task 3, 4, 6. ✓
- Roster per kategori (view + admin + export) → Task 2, 5, 6. ✓
- Acak jadwal (circle method + tombol) → Task 1, 6. ✓
- Penyimpanan otomatis (roster dalam kecamatan[cat]) → Task 2 (struktur) + handleSave existing. ✓
- Tab final layout → Task 6. ✓

**Placeholder scan:** Script verifikasi punya placeholder `/* diisi Step 3 */` yang memang diisi pada step berikutnya dalam task yang sama (bukan placeholder tugas) — eksplisit diinstruksikan. Tidak ada "TODO/TBD" lain. ✓

**Type consistency:** `roster` selalu `{[tim]:{players,officials}}`; `setRoster`/`updRoster` menerima function-or-object; scorer `{name,side,goals}`; `generateKecMatches(teams,cat,rotate)`; `TopScorers({matches,final})`; `RosterAdmin({teams,roster,setRoster,cat})`. Konsisten lintas task. ✓
