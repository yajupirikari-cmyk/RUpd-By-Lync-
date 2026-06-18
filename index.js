import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { config } from "dotenv";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fetchCurrentVersions, fetchPastVersions } from "./roblox_api.js";
import express from "express";

config();

const PREFIX = "!";
const UPDATE_CHANNEL_ID = process.env.UPDATE_CHANNEL_ID;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL) || 60;
const STATE_FILE = path.join(process.cwd(), "lastState.json");
const PORT = process.env.PORT || 3000;

// プラットフォームアイコン
const PLATFORM_ICONS = {
  Windows: "🪟",
  Mac: "🍏",
  Android: "🤖",
  iOS: "📱"
};

// Expressサーバー設定
const app = express();
app.get("/", (req, res) => {
  res.send("Roblox Update Bot is running!");
});

// 状態管理
async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveState(state) {
  try {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

function hasVersionChanged(old, cur) {
  if (!old) return true;
  const keys = ["Windows", "Mac", "Android", "iOS"];
  return keys.some((k) => old[k] !== cur[k]);
}

function createPlatformField(platform, data) {
  const icon = PLATFORM_ICONS[platform] || "🔹";
  const version = data?.version ?? "不明";
  const date = data?.date ?? "不明";
  const downloadUrl = data?.downloadUrl;
  
  let value = `${icon} **${platform}**\nVersion: \`${version}\`\nUpdated: ${date}`;
  if (downloadUrl) {
    value += `\n[Download](${downloadUrl})`;
  }
  
  return {
    name: "\u200b",
    value: value,
    inline: false,
  };
}

function createEmbed(title, current, past = null) {
  const fields = [];

  // 現在のバージョン
  for (const [platform, data] of Object.entries(current)) {
    fields.push(createPlatformField(platform, data));
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription("Roblox の最新バージョン情報")
    .addFields(...fields)
    .setColor(0x00ae86)
    .setTimestamp();

  // 過去のバージョン（オプション）
  if (past) {
    const pastFields = [];
    for (const [platform, data] of Object.entries(past)) {
      pastFields.push(createPlatformField(platform, data));
    }
    embed.addFields({ name: "---", value: "**Past Versions**", inline: false });
    embed.addFields(...pastFields);
  }

  return embed;
}

async function handleUpdateCommand(message) {
  try {
    const [current, past] = await Promise.all([
      fetchCurrentVersions(),
      fetchPastVersions()
    ]);
    const embed = createEmbed("Roblox Update (Manual)", current, past);
    await message.channel.send({ embeds: [embed] });
  } catch (err) {
    if (err.isRateLimit) {
      const wait = err.remainingTime ?? "しばらく";
      await message.channel.send(`レート制限中です。${wait}秒後に再試行してください。`);
    } else {
      console.error("Update command error:", err);
      await message.channel.send("アップデート情報の取得に失敗しました。");
    }
  }
}

async function startPolling(client) {
  let lastState = await loadState();
  let isPolling = false;

  const intervalId = setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const [current, past] = await Promise.all([
        fetchCurrentVersions(),
        fetchPastVersions()
      ]);

      if (hasVersionChanged(lastState?.current, current)) {
        const channel = client.channels.cache.get(UPDATE_CHANNEL_ID);
        if (channel?.isTextBased()) {
          const embed = createEmbed("Roblox Update (Auto)", current, past);
          await channel.send({ embeds: [embed] });
        } else {
          console.warn("UPDATE_CHANNEL_ID が無効です。");
        }
        await saveState({ current, past });
        lastState = { current, past };
      }
    } catch (err) {
      if (err.isRateLimit) {
        console.warn(`Rate limited. Waiting ${err.remainingTime} seconds...`);
      } else {
        console.error("Polling error:", err);
      }
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL * 1000);

  process.on("SIGINT", () => {
    clearInterval(intervalId);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clearInterval(intervalId);
    process.exit(0);
  });
}

// Discord Bot起動
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  startPolling(client);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;
  const [cmd] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  if (cmd.toLowerCase() === "update") {
    await handleUpdateCommand(msg);
  }
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
});

// HTTPサーバー起動
app.listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("Failed to login:", error);
  process.exit(1);
});