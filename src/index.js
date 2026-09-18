
require("dotenv").config();

const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, EmbedBuilder
} = require("discord.js");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

function need(name) {
  if (!process.env[name] || process.env[name].trim() === "") {
    console.error(`[CONFIG ERROR] Missing Railway Variable: ${name}`);
    return false;
  }
  return true;
}

if (!need("DISCORD_TOKEN")) process.exit(1);
if (!need("GUILD_ID")) process.exit(1);
if (!need("ORDER_CATEGORY_ID")) process.exit(1);
if (!need("TESTIMONI_CHANNEL_ID")) process.exit(1);
if (!need("STAFF_ROLE_ID")) process.exit(1);

const ORDER_CATEGORY_ID = process.env.ORDER_CATEGORY_ID.trim();
const TESTIMONI_CHANNEL_ID = process.env.TESTIMONI_CHANNEL_ID.trim();

// V8.1 FINAL: panel/create-ticket berada di Category ORDER, sedangkan ticket
// aktual WAJIB masuk ke Category khusus sesuai jenis commission.
const TICKET_CATEGORY_IDS = {
  skin: process.env.TICKET_SKIN_CATEGORY_ID?.trim(),
  animasi: process.env.TICKET_ANIMASI_CATEGORY_ID?.trim(),
  logo: process.env.TICKET_LOGO_CATEGORY_ID?.trim(),
  render: process.env.TICKET_RENDER_CATEGORY_ID?.trim()
};

for (const [category, id] of Object.entries(TICKET_CATEGORY_IDS)) {
  if (!id) {
    console.error(`[CONFIG ERROR] Missing Railway Variable: TICKET_${category.toUpperCase()}_CATEGORY_ID`);
    process.exit(1);
  }
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "commission.sqlite");
const db = new Database(DB_PATH);
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS counters(
  guild_id TEXT PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS panels(
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_panels(
  guild_id TEXT NOT NULL,
  category TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY(guild_id, category)
);
CREATE TABLE IF NOT EXISTS tickets(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT UNIQUE NOT NULL,
  seq INTEGER NOT NULL,
  order_id TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  size TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  worker_id TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  order_id TEXT UNIQUE NOT NULL,
  worker_id TEXT,
  category TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// V7.5 MULTI-TICKET: customer sekarang boleh mempunyai beberapa ticket/order sekaligus.
// Hapus constraint lama yang membatasi 1 ticket aktif per user agar database
// lama juga otomatis ikut mendukung multi-order.
db.exec(`DROP INDEX IF EXISTS one_active_ticket_per_user;`);

const now = () => new Date().toISOString();
const orderId = n => `DZS-${String(n).padStart(4, "0")}`;
const ticketByChannel = id => db.prepare(
  "SELECT * FROM tickets WHERE channel_id=?"
).get(id);
const ticketByOrder = (guild, oid) => db.prepare(
  "SELECT * FROM tickets WHERE guild_id=? AND order_id=?"
).get(guild, oid);
const isStaff = member =>
  member &&
  (member.permissions.has(PermissionFlagsBits.Administrator) ||
   member.roles.cache.has(process.env.STAFF_ROLE_ID));

const commissionLabel = t => {
  if (!t.size) return t.category.toUpperCase();
  if (t.category === "animasi") {
    const names = { basic: "BASIC STYLE", medium: "MEDIUM STYLE", hight: "HIGHT STYLE" };
    return `ANIMASI ${names[t.size] || t.size.toUpperCase()}`;
  }
  return `${t.category.toUpperCase()} ${t.size}`;
};

const nextNumber = db.transaction(guildId => {
  const row = db.prepare(
    "SELECT next_number FROM counters WHERE guild_id=?"
  ).get(guildId);
  const n = row ? row.next_number : 1;
  if (row) {
    db.prepare(
      "UPDATE counters SET next_number=? WHERE guild_id=?"
    ).run(n + 1, guildId);
  } else {
    db.prepare(
      "INSERT INTO counters(guild_id,next_number) VALUES(?,?)"
    ).run(guildId, n + 1);
  }
  return n;
});

function commissionPanel() {
  return new EmbedBuilder()
    .setTitle("🎨 DZS COMMISSION")
    .setDescription(
      "Pilih jenis pembelian di menu bawah.\n\n" +
      "🧑‍🎨 **SKIN** — 64 / 128 / 256 / 512\n" +
      "🖼️ **RENDER**\n" +
      "🎨 **LOGO**\n" +
      "🎞️ **ANIMASI**\n\n" +
      "Nomor order otomatis: **DZS-0001**, **DZS-0002**, dst."
    )
    .setFooter({ text: "DZS Commission System" });
}

function categoryMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("dzs_category")
      .setPlaceholder("🛒 Pilih jenis pembelian...")
      .addOptions(
        {
          label: "SKIN",
          description: "Minecraft Skin 64 / 128 / 256 / 512",
          value: "skin",
          emoji: "🧑‍🎨"
        },
        {
          label: "RENDER",
          description: "Minecraft / character render",
          value: "render",
          emoji: "🖼️"
        },
        {
          label: "LOGO",
          description: "Logo / branding",
          value: "logo",
          emoji: "🎨"
        },
        {
          label: "ANIMASI",
          description: "Animation commission",
          value: "animasi",
          emoji: "🎞️"
        }
      )
  );
}

function sizeMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("dzs_size")
      .setPlaceholder("🧑‍🎨 Pilih ukuran skin...")
      .addOptions(
        {
          label: "SKIN 64",
          description: "Minecraft skin 64×64",
          value: "64",
          emoji: "🟨"
        },
        {
          label: "SKIN 128",
          description: "Minecraft skin 128×128",
          value: "128",
          emoji: "🟨"
        },
        {
          label: "SKIN 256",
          description: "Minecraft skin 256×256",
          value: "256",
          emoji: "🟨"
        },
        {
          label: "SKIN 512",
          description: "Minecraft skin 512×512",
          value: "512",
          emoji: "🟨"
        }
      )
  );
}

function skinSizeSelectMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("dzs_skin_size_select")
      .setPlaceholder("🧑‍🎨 Pilih ukuran skin...")
      .addOptions(
        { label: "64×64", description: "Buat order Skin 64×64 • Multi-ticket", value: "64", emoji: "🟨" },
        { label: "128×128", description: "Buat order Skin 128×128 • Multi-ticket", value: "128", emoji: "🟨" },
        { label: "256×256", description: "Buat order Skin 256×256 • Multi-ticket", value: "256", emoji: "🟨" },
        { label: "512×512", description: "Buat order Skin 512×512 • Multi-ticket", value: "512", emoji: "🟨" }
      )
  );
}

function animationStyleSelectMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("dzs_animation_style_select")
      .setPlaceholder("🎞️ Pilih kasta animasi...")
      .addOptions(
        {
          label: "Basic Style",
          description: "Max 30 detik • Custom map/model • Basic Lighting",
          value: "basic",
          emoji: "🟢"
        },
        {
          label: "Medium Style",
          description: "Durasi 1 menit • Max 4 Char • Medium Lighting",
          value: "medium",
          emoji: "🟡"
        },
        {
          label: "Hight Style",
          description: "Skin 256x/512x • Full Lighting • Fog & Rays",
          value: "hight",
          emoji: "🔴"
        }
      )
  );
}

function itemPanelComponents(category) {
  if (category === "skin") return [skinSizeSelectMenu()];
  if (category === "animasi") return [animationStyleSelectMenu()];
  return [itemPanelButton(category)];
}

function ticketEmbed(t) {
  const status = {
    open: "🟢 Open",
    progress: "🟡 Progress",
    waiting: "🟠 Waiting",
    completed: "🟣 Completed"
  }[t.status] || t.status;

  return new EmbedBuilder()
    .setTitle(`🎫 ${t.order_id}`)
    .setDescription(
      `**Pembelian:** ${commissionLabel(t)}\n` +
      `**Customer:** <@${t.user_id}>\n` +
      `**Status:** ${status}\n` +
      `**Worker:** ${t.worker_id ? `<@${t.worker_id}>` : "Belum di-claim"}\n\n` +
      `**Request / Detail:**\n${t.description}`
    )
    .setFooter({ text: "DZS Commission System" });
}

function ticketControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("dzs_claim")
        .setLabel("👨‍💻 Claim")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("dzs_progress")
        .setLabel("🟡 Progress")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("dzs_waiting")
        .setLabel("🟠 Waiting")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("dzs_completed")
        .setLabel("🟣 Completed")
        .setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("dzs_close")
        .setLabel("🔒 Close Ticket")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function ratingButtons(oid) {
  return new ActionRowBuilder().addComponents(
    ...[1, 2, 3, 4, 5].map(n =>
      new ButtonBuilder()
        .setCustomId(`dzs_rate_${oid}_${n}`)
        .setLabel(`${n} ⭐`)
        .setStyle(ButtonStyle.Primary)
    )
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName("setup-commission")
    .setDescription("Pasang panel order commission per item. Customer dapat membuat beberapa order.")
    .addSubcommand(s => s.setName("skin").setDescription("Pasang panel commission Skin."))
    .addSubcommand(s => s.setName("render").setDescription("Pasang panel commission Render."))
    .addSubcommand(s => s.setName("logo").setDescription("Pasang panel commission Logo."))
    .addSubcommand(s => s.setName("animasi").setDescription("Pasang panel commission Animasi.")),
  new SlashCommandBuilder()
    .setName("setup-feedback")
    .setDescription("Pasang panel informasi feedback."),
  new SlashCommandBuilder()
    .setName("claim-ticket")
    .setDescription("Claim ticket ini."),
  new SlashCommandBuilder()
    .setName("order-status")
    .setDescription("Ubah status ticket.")
    .addStringOption(o =>
      o.setName("status")
       .setDescription("Status ticket")
       .setRequired(true)
       .addChoices(
         { name: "Open", value: "open" },
         { name: "Progress", value: "progress" },
         { name: "Waiting", value: "waiting" },
         { name: "Completed", value: "completed" }
       )
    ),
  new SlashCommandBuilder()
    .setName("close-ticket")
    .setDescription("Selesaikan ticket."),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Lihat statistik feedback."),
  new SlashCommandBuilder()
    .setName("myfeedback")
    .setDescription("Lihat feedback milikmu.")
].map(x => x.toJSON());

function itemPanel(category) {
  const data = {
    skin: {
      emoji: "🧑‍🎨", title: "🧑‍🎨 DZS COMMISSION — SKIN",
      desc: "Pesan **Minecraft Skin** sesuai ukuran yang kamu butuhkan.\n\n📐 **Pilih ukuran skin pada menu di bawah:**\n• 64×64\n• 128×128\n• 256×256\n• 512×512\n\n🔄 **Multi-Ticket:** Kamu dapat membuat beberapa order Skin sekaligus. Setelah satu order dibuat, menu akan kembali siap dipakai untuk membuat order berikutnya."
    },
    render: {
      emoji: "🖼️", title: "🖼️ DZS COMMISSION — RENDER",
      desc: "Pesan **Minecraft / Character Render** untuk kebutuhanmu.\n\nKlik tombol di bawah untuk membuat order."
    },
    logo: {
      emoji: "🎨", title: "🎨 DZS COMMISSION — LOGO",
      desc: "Pesan **Logo / Branding** custom.\n\nKlik tombol di bawah untuk membuat order."
    },
    animasi: {
      emoji: "🎞️", title: "🎞️ DZS COMMISSION — ANIMASI",
      desc: `#Minecraft Animation!\n\n____________________________________________\n**Basic Style**\n\n• Durasi Max 30 detik\n• Req Custom map/model\n• Basic Lighting [ shadow - bloom and glowing effect ]\n\n**Medium Style**\n\n• Durasi 1 Menit\n• Max 4 Char + tambahan karakter\n• Medium Lighting [ Shadow Thermochromism - Cloud ]\n\n**Hight Style**\n\n• Skin 256x/512x support\n• Full Lighting [ Shadow Thermochromism - Cloud - Fog - Rays ]\n____________________________________________\n\n**Fighting Style Animation**\n**Note:** Fighting hanya berlaku saat pengambilan durasi yang memasuki scene bertarung. Dan Fighting Animation hanya berlaku pada kasta animasi **Medium dan Hight**.\n\n🎞️ **Pilih kasta animasi pada menu di bawah:**`
    }
  }[category];

  return new EmbedBuilder()
    .setTitle(data.title)
    .setDescription(`${data.desc}\n\n🧾 Nomor order otomatis: **DZS-0001**, **DZS-0002**, dst.`)
    .setFooter({ text: "DZS Commission System" });
}

function itemPanelButton(category) {
  const labels = { skin: "🧑‍🎨 Order Skin", render: "🖼️ Order Render", logo: "🎨 Order Logo", animasi: "🎞️ Order Animasi" };
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dzs_open_${category}`)
      .setLabel(labels[category])
      .setStyle(ButtonStyle.Primary)
  );
}

async function saveOrUpdateItemPanel(interaction, category) {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    return interaction.reply({ content: "❌ Jalankan command ini di text channel.", ephemeral: true });
  }

  // Panel Create Ticket dipasang di Category ORDER. Ticket aktual nanti
  // dibuat di category khusus Skin/Animasi/Logo/Render.
  if (channel.parentId !== ORDER_CATEGORY_ID) {
    return interaction.reply({
      content: `❌ Jalankan /setup-commission **${category}** di channel yang berada di Category **ORDER**.`,
      ephemeral: true
    });
  }

  const existing = db.prepare("SELECT * FROM item_panels WHERE guild_id=? AND category=?")
    .get(interaction.guildId, category);

  if (existing) {
    try {
      const oldChannel = interaction.guild.channels.cache.get(existing.channel_id) ||
        await interaction.guild.channels.fetch(existing.channel_id);
      if (oldChannel && oldChannel.isTextBased()) {
        const msg = await oldChannel.messages.fetch(existing.message_id);
        await msg.edit({ embeds: [itemPanel(category)], components: itemPanelComponents(category) });
        if (oldChannel.id === channel.id) {
          return interaction.reply({
            content: `✅ Panel **${category.toUpperCase()}** sudah diperbarui di <#${channel.id}>.
🎫 Ticket akan dibuat di Category **${category.toUpperCase()}**.`,
            ephemeral: true
          });
        }
      }
    } catch (_) {}
  }

  const msg = await channel.send({
    embeds: [itemPanel(category)],
    components: itemPanelComponents(category)
  });

  db.prepare(`
    INSERT INTO item_panels(guild_id,category,channel_id,message_id) VALUES(?,?,?,?)
    ON CONFLICT(guild_id,category) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id
  `).run(interaction.guildId, category, channel.id, msg.id);

  return interaction.reply({
    content: `✅ Panel **${category.toUpperCase()}** aktif di <#${channel.id}>.
🎫 Ticket akan dibuat di Category **${category.toUpperCase()}**.`,
    ephemeral: true
  });
}

async function saveOrUpdateCommissionPanel(interaction) {
  const guildId = interaction.guildId;
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    return interaction.reply({ content: "❌ Jalankan command ini di text channel.", ephemeral: true });
  }

  const panel = db.prepare("SELECT * FROM panels WHERE guild_id=?").get(guildId);
  if (panel) {
    try {
      const oldChannel = interaction.guild.channels.cache.get(panel.channel_id) ||
        await interaction.guild.channels.fetch(panel.channel_id);
      if (oldChannel && oldChannel.isTextBased()) {
        const msg = await oldChannel.messages.fetch(panel.message_id);
        await msg.edit({ embeds: [commissionPanel()], components: [categoryMenu()] });

        // Kalau setup dijalankan di channel lain, pindahkan panel dengan membuat panel baru.
        if (oldChannel.id === channel.id) {
          return interaction.reply({
            content: `✅ Panel commission sudah diperbarui di <#${channel.id}>. Tidak perlu menjalankan /setup-commission lagi.`,
            ephemeral: true
          });
        }
      }
    } catch (_) {
      // Pesan lama sudah dihapus/tidak bisa diakses; buat panel baru di channel sekarang.
    }
  }

  const msg = await channel.send({
    embeds: [commissionPanel()],
    components: [categoryMenu()]
  });

  db.prepare(`
    INSERT INTO panels(guild_id,channel_id,message_id) VALUES(?,?,?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,message_id=excluded.message_id
  `).run(guildId, channel.id, msg.id);

  return interaction.reply({
    content: `✅ Panel commission aktif di <#${channel.id}>. Panel ini akan tetap bisa dipakai setelah bot restart.`,
    ephemeral: true
  });
}

async function secureTicketCategories(guild) {
  const staffRole = guild.roles.cache.get(process.env.STAFF_ROLE_ID);

  for (const [categoryName, categoryId] of Object.entries(TICKET_CATEGORY_IDS)) {
    const category = guild.channels.cache.get(categoryId) ||
      await guild.channels.fetch(categoryId).catch(() => null);

    if (!category || category.type !== ChannelType.GuildCategory) {
      console.error(`❌ CATEGORY SECURITY: ${categoryName} bukan Category yang valid (${categoryId}).`);
      continue;
    }

    try {
      // Category ticket dibuat private: @everyone tidak dapat melihatnya.
      // Admin tetap dapat melihat karena Administrator bypass permission deny.
      await category.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: false
      });

      // Worker/staff dapat melihat dan mengelola seluruh ticket di category ini.
      if (staffRole) {
        await category.permissionOverwrites.edit(staffRole, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          ManageMessages: true
        });
      }

      console.log(`🔒 PRIVATE CATEGORY: ${category.name}`);
    } catch (err) {
      console.error(`❌ GAGAL MENGUNCI CATEGORY ${categoryName.toUpperCase()}:`, err.message);
    }
  }
}

client.once("ready", async () => {
  console.log(`✅ LOGIN BERHASIL: ${client.user.tag}`);
  console.log(`🆔 BOT ID: ${client.user.id}`);

  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID) ||
      await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
    if (guild) await secureTicketCategories(guild);
  } catch (err) {
    console.error("❌ GAGAL MENYIAPKAN PRIVATE CATEGORY:", err);
  }

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

    if (process.env.GUILD_ID && process.env.GUILD_ID.trim()) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID.trim()),
        { body: commands }
      );
      console.log(`✅ COMMANDS REGISTERED KE SERVER: ${process.env.GUILD_ID}`);
    } else {
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      console.log("✅ GLOBAL COMMANDS REGISTERED. Discord bisa butuh beberapa menit untuk menampilkannya.");
    }
  } catch (err) {
    console.error("❌ GAGAL REGISTER COMMANDS:", err);
  }
});

async function cleanupCompletedTickets() {
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const rows = db.prepare(
    "SELECT * FROM tickets WHERE status='completed' AND closed_at IS NOT NULL"
  ).all();

  for (const t of rows) {
    if (Date.parse(t.closed_at) <= cutoff) {
      const channel = client.channels.cache.get(t.channel_id) ||
        await client.channels.fetch(t.channel_id).catch(() => null);
      if (channel) {
        await channel.delete("DZS Commission automatic cleanup after 24h").catch(() => {});
      }
      db.prepare("UPDATE tickets SET status='archived' WHERE id=?").run(t.id);
    }
  }
}

async function openOrder(interaction, category, size) {
  const modal = new ModalBuilder()
    .setCustomId(`dzs_order_${category}_${size || "none"}`)
    .setTitle(`Order ${size ? (category === "animasi" ? `ANIMASI ${size.toUpperCase()} STYLE` : `SKIN ${size}`) : category.toUpperCase()}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("request")
        .setLabel("Detail request")
        .setPlaceholder("Tulis detail commission kamu...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1500)
    )
  );

  return interaction.showModal(modal);
}

async function createTicket(interaction, category, size) {
  // Customer boleh membuat beberapa ticket/order sekaligus.

  const description = interaction.fields.getTextInputValue("request");
  const guild = interaction.guild;
  const staffRole = guild.roles.cache.get(process.env.STAFF_ROLE_ID);

  // ORDER berisi panel/create-ticket. Ticket aktual masuk ke Category
  // sesuai jenis commission. Validasi dilakukan sebelum nomor order
  // dialokasikan agar konfigurasi yang salah tidak membakar nomor order.
  const ticketCategoryId = TICKET_CATEGORY_IDS[category];
  const ticketCategory = guild.channels.cache.get(ticketCategoryId) ||
    await guild.channels.fetch(ticketCategoryId).catch(() => null);
  if (!ticketCategory || ticketCategory.type !== ChannelType.GuildCategory || ticketCategory.guildId !== guild.id) {
    return interaction.reply({
      content: `❌ Category ticket untuk **${category.toUpperCase()}** belum benar. Set **TICKET_${category.toUpperCase()}_CATEGORY_ID** ke ID Category yang sesuai.`,
      ephemeral: true
    });
  }

  const seq = nextNumber(interaction.guildId);
  const oid = orderId(seq);

  const channel = await guild.channels.create({
    name: `ticket-${oid.toLowerCase()}`,
    type: ChannelType.GuildText,
    parent: ticketCategory.id,
    topic: `${oid} | ${categoryLabel({ category, size })} | ${interaction.user.tag}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      },
      ...(staffRole ? [{
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      }] : [])
    ]
  });

  try {
    db.prepare(`
      INSERT INTO tickets(
        guild_id,user_id,channel_id,seq,order_id,category,size,
        description,status,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      guild.id, interaction.user.id, channel.id, seq, oid,
      category, size, description, "open", now()
    );
  } catch (err) {
    await channel.delete("Failed to save DZS commission ticket").catch(() => {});
    throw err;
  }

  const t = ticketByChannel(channel.id);

  await channel.send({
    content: `<@${interaction.user.id}> ${staffRole ? `<@&${staffRole.id}>` : ""}`,
    embeds: [ticketEmbed(t)],
    components: ticketControls()
  });

  // Semua notifikasi detail pembuatan order dirapikan ke LOG channel saja.
  const log = guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  if (log && log.isTextBased()) {
    const logEmbed = new EmbedBuilder()
      .setTitle("🎫 ORDER BARU")
      .setDescription(
        `🧾 **Order:** ${oid}\n` +
        `👤 **Customer:** <@${interaction.user.id}>\n` +
        `🛒 **Commission:** ${categoryLabel(t)}\n` +
        `📌 **Status:** 🟢 Open\n` +
        `🎫 **Ticket:** <#${channel.id}>`
      )
      .setFooter({ text: "DZS Commission System • Ticket Created" })
      .setTimestamp();

    await log.send({ embeds: [logEmbed] }).catch(() => {});
  }

  // Setelah order Skin dibuat, refresh panel Skin agar dropdown kembali
  // ke placeholder dan siap dipakai untuk order berikutnya.
  if (category === "skin" || category === "animasi") {
    const panel = db.prepare(
      "SELECT * FROM item_panels WHERE guild_id=? AND category=?"
    ).get(guild.id, category);

    if (panel) {
      try {
        const panelChannel = guild.channels.cache.get(panel.channel_id) ||
          await guild.channels.fetch(panel.channel_id);
        if (panelChannel && panelChannel.isTextBased()) {
          const panelMessage = await panelChannel.messages.fetch(panel.message_id);
          await panelMessage.edit({
            embeds: [itemPanel(category)],
            components: itemPanelComponents(category)
          });
        }
      } catch (err) {
        console.error(`❌ GAGAL RESET PANEL ${category.toUpperCase()}:`, err.message);
      }
    }
  }

  // Discord tetap membutuhkan response untuk modal submit, tetapi detail
  // pembuatan ticket tidak dikirim sebagai notifikasi tambahan.
  return interaction.reply({
    content: "✅ Order berhasil diproses. Ticket sudah disiapkan. Kamu tetap bisa membuat order/ticket lainnya.",
    ephemeral: true
  });
}

function categoryLabel(x) {
  return x.size ? `${x.category.toUpperCase()} ${x.size}` : x.category.toUpperCase();
}

async function claimTicket(interaction) {
  const t = ticketByChannel(interaction.channelId);
  if (!t) {
    return interaction.reply({ content: "❌ Ini bukan channel ticket.", ephemeral: true });
  }

  if (t.status === "completed") {
    return interaction.reply({ content: "❌ Ticket ini sudah selesai.", ephemeral: true });
  }

  // Satu ticket hanya boleh dimiliki satu Worker.
  if (t.worker_id && t.worker_id !== interaction.user.id) {
    return interaction.reply({
      content: `❌ Ticket **${t.order_id}** sudah di-claim oleh <@${t.worker_id}>.`,
      ephemeral: true
    });
  }

  if (t.worker_id === interaction.user.id) {
    return interaction.reply({
      content: `ℹ️ Ticket **${t.order_id}** sudah kamu claim.`,
      ephemeral: true
    });
  }

  // Atomic claim: prevents two staff members from claiming the same ticket
  // when their interactions arrive at nearly the same time.
  const claimed = db.prepare(
    "UPDATE tickets SET worker_id=?, status='progress' WHERE channel_id=? AND worker_id IS NULL AND status IN ('open','waiting')"
  ).run(interaction.user.id, interaction.channelId);

  if (!claimed.changes) {
    const latest = ticketByChannel(interaction.channelId);
    return interaction.reply({
      content: latest?.worker_id
        ? `❌ Ticket **${latest.order_id}** sudah di-claim oleh <@${latest.worker_id}>.`
        : `❌ Ticket **${latest?.order_id || "ini"}** tidak dapat di-claim pada status saat ini.`,
      ephemeral: true
    });
  }

  await interaction.channel.send({
    embeds: [ticketEmbed(ticketByChannel(interaction.channelId))]
  });

  return interaction.reply({
    content: `✅ Ticket **${t.order_id}** berhasil di-claim oleh <@${interaction.user.id}> dan otomatis masuk **Progress**.`,
    ephemeral: true
  });
}

async function setStatus(interaction, status) {
  const t = ticketByChannel(interaction.channelId);
  if (!t) {
    return interaction.reply({ content: "❌ Ini bukan channel ticket.", ephemeral: true });
  }

  // Completed selalu masuk ke alur penyelesaian otomatis:
  // validasi Claim -> tandai selesai -> tampilkan rating -> hapus setelah feedback.
  if (status === "completed") {
    return closeTicket(interaction);
  }

  db.prepare("UPDATE tickets SET status=? WHERE channel_id=?")
    .run(status, interaction.channelId);

  await interaction.channel.send({
    embeds: [ticketEmbed(ticketByChannel(interaction.channelId))]
  });

  return interaction.reply({
    content: `✅ ${t.order_id} → **${status}**`,
    ephemeral: true
  });
}

async function closeTicket(interaction) {
  const t = ticketByChannel(interaction.channelId);
  if (!t) {
    return interaction.reply({ content: "❌ Ini bukan channel ticket.", ephemeral: true });
  }

  // Close Ticket juga dianggap sebagai penyelesaian order, jadi wajib sudah di-claim.
  if (!t.worker_id) {
    return interaction.reply({
      content: "❌ Worker wajib **Claim** ticket terlebih dahulu sebelum ticket bisa diselesaikan.",
      ephemeral: true
    });
  }

  if (t.worker_id !== interaction.user.id &&
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: `❌ Hanya Worker yang melakukan Claim (<@${t.worker_id}>) atau Admin yang dapat menutup ticket.`,
      ephemeral: true
    });
  }

  db.prepare(
    "UPDATE tickets SET status='completed',closed_at=? WHERE channel_id=?"
  ).run(now(), interaction.channelId);

  const updated = ticketByChannel(interaction.channelId);

  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(`✅ ${updated.order_id} — Order Selesai`)
        .setDescription(
          "Terima kasih sudah order! 💜\n\n" +
          "Customer, silakan pilih rating untuk Worker:"
        )
    ],
    components: [ratingButtons(updated.order_id)]
  });

  await interaction.reply({
    content: `✅ ${updated.order_id} selesai. Silakan isi feedback. Setelah feedback dikirim, ticket akan dihapus dalam **15 detik**.`,
    ephemeral: true
  });
}

async function getWorkerProfile(guild, workerId) {
  if (!workerId) return null;
  try {
    const member = await guild.members.fetch(workerId);
    return {
      name: member.displayName || member.user.username,
      tag: member.user.tag,
      avatar: member.displayAvatarURL({ extension: "png", size: 256 })
    };
  } catch (_) {
    return {
      name: `<@${workerId}>`,
      tag: "Worker",
      avatar: null
    };
  }
}

setTimeout(() => cleanupCompletedTickets().catch(err => console.error("❌ CLEANUP ERROR:", err)), 5000);
setInterval(() => cleanupCompletedTickets().catch(err => console.error("❌ CLEANUP ERROR:", err)), 10 * 60 * 1000);

client.on("interactionCreate", async interaction => {
  try {
    // Commission workflow hanya berjalan di server Discord.
    if (!interaction.guildId || !interaction.guild) {
      if (interaction.isRepliable()) {
        return interaction.reply({
          content: "❌ Command/fitur ini hanya tersedia di server Discord.",
          ephemeral: true
        }).catch(() => {});
      }
      return;
    }
    if (interaction.isChatInputCommand()) {
      const staffCommands = [
        "setup-commission",
        "setup-feedback",
        "claim-ticket",
        "order-status",
        "close-ticket"
      ];

      if (staffCommands.includes(interaction.commandName) && !isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ Command ini khusus Admin / Commission Staff.",
          ephemeral: true
        });
      }

      if (interaction.commandName === "setup-commission") {
        const item = interaction.options.getSubcommand();
        return saveOrUpdateItemPanel(interaction, item);
      }

      if (interaction.commandName === "setup-feedback") {
        // Feedback panel SELALU dipasang di channel TESTIMONI, bukan di channel ticket/order.
        const feedbackChannel =
          interaction.guild.channels.cache.get(TESTIMONI_CHANNEL_ID) ||
          await interaction.guild.channels.fetch(TESTIMONI_CHANNEL_ID).catch(() => null);

        if (!feedbackChannel || !feedbackChannel.isTextBased() || feedbackChannel.guildId !== interaction.guildId) {
          return interaction.reply({
            content: "❌ TESTIMONI_CHANNEL_ID salah atau channel tidak dapat diakses bot.",
            ephemeral: true
          });
        }

        const message = await feedbackChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("💜 DZS FEEDBACK")
              .setDescription(
                "Setelah order selesai, customer memilih rating 1–5.\n\n" +
                "Post feedback otomatis menampilkan:\n" +
                "👤 **Worker**\n" +
                "📋 **Reviewer**\n" +
                "⭐ **Rating**\n" +
                "💬 **Review/Ulasan**"
              )
              .setFooter({ text: "DZS Commission System • TESTIMONI" })
          ]
        });

        return interaction.reply({
          content: `✅ Panel feedback dipasang di <#${feedbackChannel.id}>.\n📌 Panel Create Ticket berada di Category ORDER. Ticket aktual masuk ke Category sesuai jenis commission.`,
          ephemeral: true
        });
      }

      if (interaction.commandName === "claim-ticket") return claimTicket(interaction);

      if (interaction.commandName === "order-status") {
        return setStatus(
          interaction,
          interaction.options.getString("status")
        );
      }

      if (interaction.commandName === "close-ticket") return closeTicket(interaction);

      if (interaction.commandName === "stats") {
        const r = db.prepare(
          "SELECT COUNT(*) total, AVG(rating) avg FROM reviews WHERE guild_id=?"
        ).get(interaction.guildId);

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("📊 DZS Feedback Stats")
              .setDescription(
                `Total feedback: **${r.total}**\n` +
                `Rata-rata: **${r.avg ? Number(r.avg).toFixed(2) : "0.00"} ⭐**`
              )
          ]
        });
      }

      if (interaction.commandName === "myfeedback") {
        const rows = db.prepare(
          "SELECT order_id,category,rating,comment FROM reviews " +
          "WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 10"
        ).all(interaction.guildId, interaction.user.id);

        return interaction.reply({
          content: rows.length
            ? rows.map(x =>
                `**${x.order_id}** — ${x.category} — ${x.rating} ⭐\n${x.comment}`
              ).join("\n\n")
            : "Belum ada feedback.",
          ephemeral: true
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "dzs_skin_size_select") {
        return openOrder(interaction, "skin", interaction.values[0]);
      }

      if (interaction.customId === "dzs_animation_style_select") {
        return openOrder(interaction, "animasi", interaction.values[0]);
      }

      if (interaction.customId === "dzs_category") {
        const category = interaction.values[0];

        if (category === "skin") {
          return interaction.reply({
            content: "🧑‍🎨 Pilih ukuran skin:",
            components: [sizeMenu()],
            ephemeral: true
          });
        }

        if (category === "animasi") {
          return interaction.reply({
            content: "🎞️ Pilih kasta animasi yang kamu inginkan:",
            components: [animationStyleSelectMenu()],
            ephemeral: true
          });
        }

        return openOrder(interaction, category, null);
      }

      if (interaction.customId === "dzs_size") {
        return openOrder(interaction, "skin", interaction.values[0]);
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("dzs_open_")) {
        const category = interaction.customId.replace("dzs_open_", "");
        if (!["skin", "render", "logo", "animasi"].includes(category)) {
          return interaction.reply({ content: "❌ Jenis commission tidak valid.", ephemeral: true });
        }
        if (category === "skin") {
          return interaction.reply({
            content: "🧑‍🎨 Pilih ukuran skin:",
            components: [sizeMenu()],
            ephemeral: true
          });
        }
        if (category === "animasi") {
          return interaction.reply({
            content: "🎞️ Pilih kasta animasi yang kamu inginkan:",
            components: [animationStyleSelectMenu()],
            ephemeral: true
          });
        }
        return openOrder(interaction, category, null);
      }

      if (["dzs_claim","dzs_progress","dzs_waiting","dzs_completed"].includes(interaction.customId)) {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ Khusus Admin / Commission Staff.",
            ephemeral: true
          });
        }

        if (interaction.customId === "dzs_claim") {
          return claimTicket(interaction);
        }

        const map = {
          dzs_progress: "progress",
          dzs_waiting: "waiting",
          dzs_completed: "completed"
        };

        return setStatus(interaction, map[interaction.customId]);
      }

      if (interaction.customId === "dzs_close") {
        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: "❌ Khusus Admin / Commission Staff.",
            ephemeral: true
          });
        }
        return closeTicket(interaction);
      }

      if (interaction.customId.startsWith("dzs_rate_")) {
        const p = interaction.customId.split("_");
        const oid = p[2];
        const rating = Number(p[3]);
        const t = ticketByOrder(interaction.guildId, oid);

        if (!t || t.user_id !== interaction.user.id || t.status !== "completed") {
          return interaction.reply({
            content: "❌ Rating ini bukan untuk order kamu.",
            ephemeral: true
          });
        }

        if (db.prepare("SELECT id FROM reviews WHERE order_id=?").get(oid)) {
          return interaction.reply({
            content: "❌ Order ini sudah diberi feedback.",
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`dzs_review_${oid}_${rating}`)
          .setTitle(`${oid} — ${rating} ⭐`);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("comment")
              .setLabel("Review / Ulasan")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000)
          )
        );

        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("dzs_order_")) {
        const p = interaction.customId.split("_");
        return createTicket(
          interaction,
          p[2],
          p[3] === "none" ? null : p[3]
        );
      }

      if (interaction.customId.startsWith("dzs_review_")) {
        const p = interaction.customId.split("_");
        const oid = p[2];
        const rating = Number(p[3]);
        const t = ticketByOrder(interaction.guildId, oid);

        if (!t || t.user_id !== interaction.user.id || t.status !== "completed") {
          return interaction.reply({
            content: "❌ Order tidak valid.",
            ephemeral: true
          });
        }

        if (db.prepare("SELECT id FROM reviews WHERE order_id=?").get(oid)) {
          return interaction.reply({
            content: "❌ Feedback sudah ada.",
            ephemeral: true
          });
        }

        const comment = interaction.fields.getTextInputValue("comment");

        db.prepare(`
          INSERT INTO reviews(
            guild_id,user_id,order_id,worker_id,category,rating,comment,created_at
          ) VALUES(?,?,?,?,?,?,?,?)
        `).run(
          interaction.guildId,
          interaction.user.id,
          oid,
          t.worker_id,
          categoryLabel(t),
          rating,
          comment,
          now()
        );

        // Feedback sudah masuk, ticket tidak lagi dianggap aktif.
        db.prepare("UPDATE tickets SET status='archived' WHERE channel_id=?").run(interaction.channelId);

        const feedbackChannel =
          interaction.guild.channels.cache.get(TESTIMONI_CHANNEL_ID);
        const workerProfile = await getWorkerProfile(interaction.guild, t.worker_id);

        if (feedbackChannel && feedbackChannel.isTextBased()) {
          const feedbackEmbed = new EmbedBuilder()
            .setTitle("💜 RATING WORKER")
            .setDescription(
              `━━━━━━━━━━━━━━━━\n` +
              `👤 **Worker:** ${t.worker_id ? `<@${t.worker_id}>` : "Belum ditentukan"}\n` +
              `📋 **Reviewer:** <@${interaction.user.id}>\n` +
              `⭐ **Rating:** ${"⭐".repeat(rating)}${"☆".repeat(5-rating)}\n` +
              `💬 **Review/Ulasan:** "${comment}"\n` +
              `🧾 **Order:** ${oid}\n` +
              `🛒 **Commission:** ${categoryLabel(t)}\n` +
              `━━━━━━━━━━━━━━━━`
            )
            .setFooter({ text: "DZS Commission System" })
            .setTimestamp();

          if (workerProfile) {
            feedbackEmbed.setAuthor({
              name: `Worker: ${workerProfile.name}`,
              iconURL: workerProfile.avatar || undefined
            });
            if (workerProfile.avatar) feedbackEmbed.setThumbnail(workerProfile.avatar);
          }

          await feedbackChannel.send({ embeds: [feedbackEmbed] });
        }

        const log = interaction.guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
        if (log && log.isTextBased()) {
          await log.send(
            `⭐ Feedback **${oid}** — ${rating}/5 — reviewer <@${interaction.user.id}> — ` +
            `worker ${t.worker_id ? `<@${t.worker_id}>` : "N/A"}`
          ).catch(() => {});
        }

        await interaction.reply({
          content: `✅ Feedback **${oid}** berhasil disimpan! 💜 Ticket akan dihapus dalam **15 detik**.`,
          ephemeral: true
        });

        // Beri waktu 15 detik agar customer sempat membaca konfirmasi feedback.
        setTimeout(() => {
          interaction.channel.delete("DZS Commission feedback submitted (15s delay)").catch(() => {});
        }, 15 * 1000);
      }
    }
  } catch (err) {
    console.error("❌ INTERACTION ERROR:", err);
    if (interaction.isRepliable() && !interaction.replied) {
      await interaction.reply({
        content: "❌ Terjadi error. Cek Deploy Logs Railway.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

client.on("error", err => console.error("❌ DISCORD CLIENT ERROR:", err));
process.on("unhandledRejection", err => console.error("❌ UNHANDLED REJECTION:", err));
process.on("uncaughtException", err => console.error("❌ UNCAUGHT EXCEPTION:", err));

client.login(process.env.DISCORD_TOKEN)
  .catch(err => {
    console.error("❌ LOGIN DISCORD GAGAL.");
    console.error(err);
    process.exit(1);
  });
