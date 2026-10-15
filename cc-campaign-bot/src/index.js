// Creator Congress campaign bot
// - Posts Active proposals (with "Post to Discord" checked) to the campaign channel
// - Logs ✅ reactions to the Campaign Commitments table; un-reacting marks them Withdrawn
// - /link <email>   connects a member's Discord account to their Creator Applications record
// - /mycampaigns    shows a member the campaigns they've signed up for (only they can see it)
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import * as at from './airtable.js';
import { CAMPAIGNS as C, MEMBERS as M, COMMITMENTS as K } from './schema.js';

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  CAMPAIGN_CHANNEL_ID,
  SIGNUP_EMOJI = '✅',
  POLL_SECONDS = '120',
  PORTAL_URL = '',
} = process.env;

for (const [k, v] of Object.entries({ DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, CAMPAIGN_CHANNEL_ID, AIRTABLE_TOKEN: process.env.AIRTABLE_TOKEN })) {
  if (!v) {
    console.error(`Missing required env var ${k}. See .env.example.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions],
  // Partials let us receive reactions on posts made before the bot last restarted.
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

const log = (...a) => console.log(new Date().toISOString(), ...a);
const now = () => new Date().toISOString();
const isSnowflake = (s) => /^\d{17,20}$/.test(String(s));

// ---------- campaign lookup (cached by Discord message ID) ----------

const campaignByMessage = new Map(); // messageId -> { id, name, closed }

async function getCampaignForMessage(messageId) {
  if (campaignByMessage.has(messageId)) return campaignByMessage.get(messageId);
  const rec = await at.first(C.table, {
    formula: `{${C.names.discordMessageId}}=${at.q(messageId)}`,
    fields: [C.f.shortName, C.f.status, C.f.discordClosed],
  });
  const info = rec
    ? { id: rec.id, name: rec.fields[C.f.shortName] || 'Campaign', closed: rec.fields[C.f.status] !== C.ACTIVE }
    : null;
  campaignByMessage.set(messageId, info);
  return info;
}

// ---------- posting & closing campaigns ----------

function money(n) {
  return typeof n === 'number' ? `$${n.toLocaleString('en-US')}` : null;
}

function fmtDate(d) {
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function buildEmbed(fields, { closed = false } = {}) {
  const name = fields[C.f.shortName] || 'New campaign';
  const details = fields[C.f.details] || '';
  const e = new EmbedBuilder()
    .setTitle(closed ? `[CLOSED] ${name}` : name)
    .setDescription(details.length > 3900 ? details.slice(0, 3900) + '…' : details || '\u200b')
    .setColor(closed ? 0x808080 : 0x2ecc71);

  const add = (label, value) => value && e.addFields({ name: label, value: String(value), inline: true });
  add('Type', fields[C.f.proposalType]);
  add('Creator pay', money(fields[C.f.creatorPay]));
  add('Creators needed', fields[C.f.creatorsNeeded]);
  const start = fmtDate(fields[C.f.startDate]);
  const end = fmtDate(fields[C.f.endDate]);
  add('Dates', start && end ? `${start} – ${end}` : start || end);
  if (Array.isArray(fields[C.f.issues]) && fields[C.f.issues].length) {
    e.addFields({ name: 'Issues', value: fields[C.f.issues].join(', ').slice(0, 1000) });
  }
  e.setFooter({
    text: closed
      ? 'This campaign is closed. Sign-ups are no longer being taken.'
      : `React ${SIGNUP_EMOJI} to sign up · remove your reaction to withdraw · /mycampaigns to see yours`,
  });
  return e;
}

async function syncCampaignPosts() {
  const channel = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
  const campaignFields = Object.values(C.f);

  // 1) New: Active + Post to Discord + not yet posted
  const toPost = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.postToDiscord}}, {${C.names.discordMessageId}}="")`,
    fields: campaignFields,
  });
  for (const rec of toPost) {
    const msg = await channel.send({ embeds: [buildEmbed(rec.fields)] });
    await msg.react(SIGNUP_EMOJI);
    await at.update(C.table, rec.id, { [C.f.discordMessageId]: msg.id, [C.f.discordClosed]: false });
    campaignByMessage.set(msg.id, { id: rec.id, name: rec.fields[C.f.shortName] || 'Campaign', closed: false });
    log(`Posted campaign ${rec.id} as message ${msg.id}`);
  }

  // 2) Close: posted, no longer Active, not yet marked closed
  const toClose = await at.list(C.table, {
    formula: `AND({${C.names.status}}!=${at.q(C.ACTIVE)}, {${C.names.discordMessageId}}!="", NOT({${C.names.discordClosed}}))`,
    fields: campaignFields,
  });
  for (const rec of toClose) {
    await editPost(channel, rec, true);
  }

  // 3) Re-open: posted + closed, but switched back to Active
  const toReopen = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.discordMessageId}}!="", {${C.names.discordClosed}})`,
    fields: campaignFields,
  });
  for (const rec of toReopen) {
    await editPost(channel, rec, false);
  }
}

async function editPost(channel, rec, closed) {
  const messageId = rec.fields[C.f.discordMessageId];
  try {
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ embeds: [buildEmbed(rec.fields, { closed })] });
  } catch (err) {
    log(`Could not edit message ${messageId} for ${rec.id}
