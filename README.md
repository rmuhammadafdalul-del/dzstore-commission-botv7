# DZS Commission Bot V8.1.0 FINAL

Bot commission Discord berbasis Node.js 20, discord.js 14, dan SQLite. Target deploy: Railway, Render Background Worker, dan Pterodactyl.

## Struktur Discord yang dipakai

- **ORDER category**: hanya tempat channel-panel Create Ticket.
- **TIKET SKIN category**: ticket Skin aktual.
- **TIKET ANIMASI category**: ticket Animasi aktual.
- **TIKET LOGO category**: ticket Logo aktual.
- **TIKET RENDER category**: ticket Render aktual.
- **TESTIMONI channel**: semua feedback/rating customer.
- **LOG channel**: log aktivitas (opsional).

Customer boleh membuat banyak ticket/order sekaligus (multi-ticket). Tidak ada constraint satu ticket aktif per customer.

## Environment Variables

```env
DISCORD_TOKEN=PASTE_BOT_TOKEN_HERE
GUILD_ID=PASTE_SERVER_ID_HERE
ORDER_CATEGORY_ID=PASTE_ORDER_CATEGORY_ID_HERE
TICKET_SKIN_CATEGORY_ID=PASTE_TIKET_SKIN_CATEGORY_ID_HERE
TICKET_ANIMASI_CATEGORY_ID=PASTE_TIKET_ANIMASI_CATEGORY_ID_HERE
TICKET_LOGO_CATEGORY_ID=PASTE_TIKET_LOGO_CATEGORY_ID_HERE
TICKET_RENDER_CATEGORY_ID=PASTE_TIKET_RENDER_CATEGORY_ID_HERE
TESTIMONI_CHANNEL_ID=PASTE_TESTIMONI_CHANNEL_ID_HERE
LOG_CHANNEL_ID=PASTE_LOG_CHANNEL_ID_HERE
STAFF_ROLE_ID=PASTE_STAFF_ROLE_ID_HERE
DATA_DIR=./data
```

`LOG_CHANNEL_ID` opsional. Variable category ticket per jenis **wajib** agar ticket tidak salah masuk ke ORDER.

## Setup panel

Staff/Admin menjalankan command di channel text yang berada di dalam **ORDER category**:

- `/setup-commission skin`
- `/setup-commission animasi`
- `/setup-commission logo`
- `/setup-commission render`

Command tersebut memasang panel Create Ticket. Ticket yang dibuat masuk ke category khusus berdasarkan jenis commission.

`/setup-feedback` memasang panel informasi feedback di `TESTIMONI_CHANNEL_ID`.

## Animasi

Panel Animasi memiliki Basic, Medium, dan Hight tanpa harga, dengan deskripsi produk dan catatan Fighting Style. Fighting Style hanya untuk Medium/Hight sesuai spesifikasi project.

## Workflow ticket

1. Customer memilih produk pada panel di ORDER.
2. Customer mengisi detail request.
3. Bot membuat order ID otomatis `DZS-0001`, dst.
4. Ticket private dibuat pada category khusus produk.
5. Staff dapat Claim; claim bersifat atomic sehingga satu ticket hanya dapat di-claim satu worker.
6. Status: Open → Progress → Waiting → Completed.
7. Setelah Completed, customer dapat memberi rating 1–5 + review.
8. Feedback dikirim ke TESTIMONI.
9. Ticket dihapus 15 detik setelah feedback.
10. Ticket completed yang belum diberi feedback dibersihkan otomatis setelah 24 jam.

## Railway

- Deploy project menggunakan Dockerfile.
- Isi semua variables di atas.
- Tambahkan Railway Volume dengan mount path `/app/data`.
- Untuk konfigurasi sekarang, boleh set `DATA_DIR=/app/data` agar eksplisit.

## Render

Gunakan `render.yaml` atau Background Worker Docker manual. Persistent Disk dipasang ke `/app/data` dan `DATA_DIR=/app/data`.

## Pterodactyl

Gunakan Node.js 20+. Startup: `npm start`. Untuk filesystem persistent, gunakan `DATA_DIR=./data`.

## Discord permissions

Bot membutuhkan setidaknya View Channels, Send Messages, Embed Links, Read Message History, Attach Files, Manage Channels, dan Manage Messages. `Manage Roles` hanya diperlukan bila workflow project kamu menambah/mengubah role.

## Database

SQLite cocok untuk satu instance bot. Jangan menjalankan beberapa replica yang menulis database SQLite yang sama. Backup `data/commission.sqlite` atau `/app/data/commission.sqlite` sesuai platform.
