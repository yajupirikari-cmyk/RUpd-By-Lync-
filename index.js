import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { config } from "dotenv";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fetchCurrentVersions, fetchPastVersions } from "./roblox_api.js";
import express from "express";

config();

const PREFIX = "!";
const UPDATE_CHANNEL_ID = process.env.UPDATE_CHANNEL_ID || "";
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL) || 60;
const STATE_FILE = path.join(process.cwd(), "lastState.json");
const PORT = process.env.PORT || 3000;
const PLATFORMS = ["Windows", "Mac", "Android", "iOS"];

// 必須環境変数チェック
if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN が設定されていません");
if (!UPDATE_CHANNEL_ID) throw new Error("UPDATE_CHANNEL_ID が設定されていません");

// プラットフォーム画像URL（公式ロゴ）
const PLATFORM_IMAGES = {
  Windows: "https://www.roblox.com/assets/images/icons/windows-icon.png",
  Mac: "https://www.roblox.com/assets/images/icons/macos-icon.png",
  Android: "https://www.roblox.com/assets/images/icons/android-icon.png",
  iOS: "https://www.roblox.com/assets/images/icons/ios-icon.png"
};

// Express（ヘルスチェック用）設定
const app = express();
app.get("/", (req, res) => {
  res.send("Roblox Update Bot is running!");
});
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// 状態管理
async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    console.warn("状態ファイルが無いか破損しています。デフォルトで初期化します。");
    return { current: {}, past: {} };
  }
}
async function saveState(state) {
  try {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.error("状態保存失敗:", e);
  }
}

// バージョン変更判定
function hasVersionChanged(old, cur) {
  if (!old) return true;
  return PLATFORMS.some((p) => old[p]?.version !== cur[p]?.version);
}

// 埋め込みメッセージ作成
function createPlatformField(platform, data) {
  const version = data?.version ?? "不明";
  const date = data?.date ?? "不明";
  const downloadUrl = data?.downloadUrl;
  const imageUrl = PLATFORM_IMAGES[platform];

  let value = `Version: \`${version}\`\nUpdated: ${date}`;
  if (downloadUrl) value += `\n[Download](${downloadUrl})`;

  return {
    name: platform,
    value,
    inline: false,
    ...(imageUrl && { thumbnail: { url: imageUrl } })
  };
}
function createEmbed(title, current, past = null) {
  const fields = PLATFORMS.map((p) => createPlatformField(p, current[p])).filter(Boolean);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription("Roblox の最新バージョン情報")
    .addFields(...fields)
    .setColor(0x00ae86)
    .setTimestamp();

  if (past) {
    const pastFields = PLATFORMS.map((p) => createPlatformField(p, past[p])).filter(Boolean);
    embed.addFields({ name: "Past Versions", value: "\u200b", inline: false });
    embed.addFields(...pastFields);
  }
  return embed;
}

// 手動コマンド処理
async function handleUpdateCommand(message) {
  try {
    const [current, past] = await Promise.all([fetchCurrentVersions(), fetchPastVersions()]);
    const embed = createEmbed("Roblox Update (Manual)", current, past);
    await message.channel.send({ embeds: [embed] });
  } catch (err) {
    if (err.isRateLimit) {
      const wait = err.remainingTime ?? "しばらく";
      await message.channel.send(`レート制限中です。${wait}秒後に再試行してください。`);
    } else {
      console.error("手動取得エラー:", err);
      await message.channel.send("アップデート情報の取得に失敗しました。");
    }
  }
}

// ポーリング開始
async function startPolling(client) {
  let lastState = await loadState();
  let isRunning = false;

  const timer = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const [current, past] = await Promise.all([fetchCurrentVersions(), fetchPastVersions()]);
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
        console.warn(`Rate limited, wait ${err.remainingTime}s`);
      } else {
        console.error("ポーリングエラー:", err);
      }
    } finally {
      isRunning = false;
    }
  }, POLL_INTERVAL * 1000);

  process.on("SIGINT", () => {
    clearInterval(timer);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
}

// Discord クライアント起動
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

client.on("error", (err) => {
  console.error("Discord client error:", err);
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("Discord login 失敗:", err);
  process.exit(1);
});
