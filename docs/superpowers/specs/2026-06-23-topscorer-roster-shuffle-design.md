# Desain: Top Skor, Tim & Pemain, dan Acak Jadwal

**Tanggal:** 2026-06-23
**Project:** Futsal Kecamatan Pasar Rebo (`src/App.jsx`)
**Acuan:** Project FFU Kalisari (`/Users/rahmatmulyana/futsal-tournament/src/App.jsx`)

## Tujuan

Menambahkan tiga fitur ke aplikasi turnamen Kecamatan, meniru implementasi FFU Kalisari
dengan penyesuaian untuk struktur Kecamatan (5 tim round-robin, kategori U16/U13 — bukan grup A/B):

1. **Top Skor** — tab daftar pencetak gol terbanyak, dengan input scorer per pertandingan.
2. **Tim & Pemain (Roster)** — tab daftar pemain & official tiap tim, dengan mode admin + export Excel/PDF.
3. **Acak Jadwal** — urutan pertandingan disebar agar tidak ada satu kelurahan main berturut-turut, plus tombol admin untuk acak ulang.

## Keputusan Desain

- **Roster dipisah per kategori.** Tiap kelurahan punya skuad U16 dan skuad U13 terpisah.
  Top skor juga dihitung terpisah per kategori.
- **Acak jadwal dengan tombol admin.** Default generate sudah anti-back-to-back; admin juga
  punya tombol "🔀 Acak Ulang Jadwal" (dengan konfirmasi, karena me-reset skor & scorer kategori itu).

## Struktur Data

### Roster (baru) — disimpan per kategori

```js
// kecamatan[cat].roster = { [namaTim]: { players: [...], officials: [...] } }
// players: [{ name, number, pos }]  pos ∈ {GK, FP, CF}
// officials: [{ name, role }]
```

Roster diletakkan di dalam `kecamatan.U16.roster` dan `kecamatan.U13.roster`, mengikuti
keputusan "dipisah per kategori". `initKecamatan` menambahkan `roster: {}` di tiap kategori.

### Scorer (sudah ada)

Tiap match & final sudah punya field `scorers: []`. Format scorer mengikuti FFU:
`{ name, side, goals }` dengan `side ∈ {home, away}`.

## Komponen

### `calcTopScorers(matches, final)` (fungsi baru)
Meniru FFU `calcTopScorers`. Akumulasi `scorers` dari semua match round-robin + final kategori,
group by `name||team`, filter goals>0, urut menurun. `team` diturunkan dari `side` + home/away match.

### `TopScorers({ matches, final })` (komponen baru)
Tabel oranye identik FFU: kolom `# / Pemain / Tim / ⚽ Gol`, medali 🥇🥈🥉 untuk 3 teratas.
Empty state "Belum ada data pencetak gol".

### `MatchCard` (modifikasi) — bagian Final
Tambahkan section scorer ala FFU (admin): toggle, daftar chip scorer, form tambah
(pilih sisi → pilih pemain dari roster kategori atau ketik manual → jumlah gol). Terima prop `roster`.

### Tab Jadwal & Hasil (modifikasi)
Tambahkan section input scorer per match (admin) — pola sama seperti MatchCard, memakai roster kategori.

### `RosterView({ teams, roster })` (komponen baru)
Versi publik ditiru dari FFU, disederhanakan: pemilih tim dari daftar `teams` (bukan grup A/B),
warna pakai `KEC_COLOR`. Menampilkan official + tabel pemain (No/Nama/Posisi).

### `RosterAdmin({ teams, roster, setRoster })` (komponen baru)
Ditiru dari FFU: form official, form pemain (tambah/edit/hapus), export Excel (CSV) & export PDF.
Judul PDF diganti: "DAFTAR SUSUNAN PEMAIN — TURNAMEN FUTSAL KECAMATAN PASAR REBO".
Pemilih tim dari `teams`, warna `KEC_COLOR`.

### `generateKecMatches(teams, cat)` (modifikasi — circle method)
Ganti urutan nested-loop menjadi **circle method** round-robin: tiap ronde tiap tim main sekali
(satu tim "bye" karena jumlah ganjil = 5), sehingga tidak ada tim main dua kali berurutan.
`matchNo` tetap berurutan sesuai urutan hasil circle method.

### Tombol "🔀 Acak Ulang Jadwal" (admin, di tab Jadwal)
Konfirmasi via `window.confirm`. Bila ya: regenerate matches kategori aktif dengan urutan teracak
(circle method dengan offset/rotasi berbeda), me-reset skor & scorer. Roster & final tidak terpengaruh.

## Tata Letak Tab (final)

```
📊 Klasemen · 📋 Jadwal & Hasil · ⚽ Top Skor · 🏆 Final · 👥 Tim & Pemain
```

Tab admin/publik dibedakan: di tab "Tim & Pemain", admin melihat `RosterAdmin`, publik melihat `RosterView`.

## Penyimpanan

`handleSave` di App sudah menyimpan seluruh objek `kecamatan` ke Firestore. Karena `roster`
diletakkan di dalam `kecamatan[cat]`, otomatis ikut tersimpan tanpa perubahan logika save.

## Yang TIDAK termasuk (YAGNI)

- Tidak ada grup A/B (Kecamatan murni round-robin 5 tim).
- Tidak ada bracket semifinal/juara-3 (struktur Kecamatan: top-2 → final tunggal, sudah ada).
- Tidak ada sponsor (tidak diminta).
