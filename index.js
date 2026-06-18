import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { config } from "dotenv";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fetchCurrentVersions, fetchPastVersions } from "./roblox_api.js";

config();

const PREFIX = "!";
const UPDATE_CHANNEL_ID = process.env.UPDATE_CHANNEL_ID;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL) || 60;
const STATE_FILE = path.join(process.cwd(), "lastState.json");

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

function createPlatformField(key, version, date) {
  return {
    name: key,
    value: `Version: \`${version ?? "不明"}\`\nUpdated: ${date ?? "不明"}`,
    inline: false,
  };
}

function createEmbed(title, current, past = null) {
  const fields = [];

  // Current versions
  fields.push(
    createPlatformField("Windows", current.Windows, current.WindowsDate),
    createPlatformField("Mac", current.Mac, current.MacDate),
    createPlatformField("Android", current.Android, current.AndroidDate),
    createPlatformField("iOS", current.iOS, current.iOSDate)
  );

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription("Roblox のバージョン情報")
    .addFields(...fields)
    .setColor(0x00ae86)
    .setTimestamp();

  // Past versions (if provided)
  if (past) {
    const pastFields = [
      createPlatformField("Windows", past.Windows, past.WindowsDate),
      createPlatformField("Mac", past.Mac, past.MacDate)
    ];
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

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("Failed to login:", error);
  process.exit(1);
});