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
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import * as at from './airtable.js';
import { CAMPAIGNS as C, MEMBERS as M, COMMITMENTS as K, ORGS as O, OUTBOX, PORTAL } from './schema.js';

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  CAMPAIGN_CHANNEL_ID,
  SIGNUP_EMOJI = '✅',
  POLL_SECONDS = '120',
  PORTAL_URL = '',
  GUIDE_URL = '',
  STAFF_ROLE_ID = '',
  REVIEW_CHANNEL_ID = '',
  PUBLIC_URL = '',
  CAMPAIGN_CATEGORY = 'Active Campaigns',
  ARCHIVE_CATEGORY = 'Archived Campaigns',
  ORG_CATEGORY = 'Partner Organizations',
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

// How creators join: 'open' | 'review' | 'invite'. Falls back to the older "Requires approval" checkbox.
function modeOf(fields) {
  const m = String(fields[C.f.joinMode] || '');
  if (m.startsWith('Invite')) return 'invite';
  if (m.startsWith('Partner')) return 'review';
  if (m.startsWith('Open')) return 'open';
  if (fields[C.f.inviteOnlyBox]) return 'invite';
  return fields[C.f.requiresApproval] ? 'review' : 'open';
}

function campaignInfo(rec) {
  return {
    id: rec.id,
    name: rec.fields[C.f.shortName] || 'Campaign',
    closed: rec.fields[C.f.status] !== C.ACTIVE,
    approval: modeOf(rec.fields) === 'review',
    org: (rec.fields[C.f.orgName] || [])[0] || 'the partner organization',
  };
}

async function getCampaignForMessage(messageId) {
  if (campaignByMessage.has(messageId)) return campaignByMessage.get(messageId);
  const rec = await at.first(C.table, {
    formula: `{${C.names.discordMessageId}}=${at.q(messageId)}`,
    fields: [C.f.shortName, C.f.status, C.f.discordClosed, C.f.requiresApproval, C.f.joinMode, C.f.orgName],
  });
  const info = rec ? campaignInfo(rec) : null;
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

function progressBar(n, total, width = 10) {
  if (!total || total <= 0) return '';
  const filled = Math.max(0, Math.min(width, Math.round((n / total) * width)));
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

function buildEmbed(fields, { closed = false, invite = false } = {}) {
  const name = fields[C.f.shortName] || 'New campaign';
  const org = (fields[C.f.orgName] || []).filter(Boolean).join(', ');
  const details = (fields[C.f.details] || '').trim();
  const signups = Number(fields[C.f.signups]) || 0;
  const needed = Number(fields[C.f.creatorsNeeded]) || 0;
  const pay = Number(fields[C.f.creatorPay]) || 0;
  const start = fmtDate(fields[C.f.startDate]);
  const end = fmtDate(fields[C.f.endDate]);
  const issues = Array.isArray(fields[C.f.issues]) ? fields[C.f.issues] : [];

  const e = new EmbedBuilder()
    .setAuthor({ name: closed ? '⚪  CAMPAIGN CLOSED' : invite ? '✉️  INVITATION' : '🟢  OPEN CAMPAIGN' })
    .setTitle(name.slice(0, 256))
    .setColor(closed ? 0x4f545c : 0x2ecc71);

  const desc = [];
  if (org) desc.push(`with **${org}**`);
  if (details) desc.push(`\n${details.length > 3500 ? details.slice(0, 3500) + '…' : details}`);
  e.setDescription(desc.join('\n') || '​');

  e.addFields(
    { name: '💰 Pay', value: pay ? `${money(pay)}` : 'Unpaid / TBD', inline: true },
    {
      name: '👥 Spots',
      value: needed ? `${signups} of ${needed} filled\n${progressBar(signups, needed)}` : `${signups} signed up`,
      inline: true,
    },
    { name: '📅 Dates', value: start && end ? `${start} –\n${end}` : start || end || 'Flexible', inline: true }
  );
  const tags = [fields[C.f.proposalType], ...issues].filter(Boolean);
  if (tags.length) e.addFields({ name: '🏷️ Focus', value: tags.map((t) => `\`${t}\``).join('  ').slice(0, 1000) });
  if (modeOf(fields) === 'review' && !closed) {
    e.addFields({ name: '🙋 Partner-reviewed', value: `${org || 'The partner'} reviews each sign-up. React to request a spot, and you'll get a DM once you're confirmed.` });
  }
  if (hasThread(fields) && !closed) {
    e.addFields({ name: '💬 Campaign thread', value: 'Once you’re confirmed, you’re added to a private thread for this campaign in the partner’s Discord channel.' });
  }

  e.addFields({
    name: '​',
    value: closed
      ? '**Sign-ups are closed.** Thanks to everyone who joined!'
      : invite
        ? `**You've been personally invited to this campaign.** Use the buttons below to accept or pass.\nType \`/mycampaigns\` in the server to see everything you've joined.`
        : `**React ${SIGNUP_EMOJI} below to sign up.** Remove your reaction to withdraw.\nType \`/mycampaigns\` to see everything you've joined.`,
  });
  e.setFooter({ text: 'Creator Congress' });
  return e;
}

// Re-render a post (e.g. to update the sign-up count) — debounced so a burst of reactions = one edit.
const refreshTimers = new Map();
function scheduleRefresh(messageId, campaignId) {
  clearTimeout(refreshTimers.get(messageId));
  refreshTimers.set(
    messageId,
    setTimeout(async () => {
      refreshTimers.delete(messageId);
      try {
        const [rec] = await at.list(C.table, { formula: `RECORD_ID()=${at.q(campaignId)}`, fields: Object.values(C.f) });
        if (!rec) return;
        if (!isInviteKey(messageId)) {
          const channel = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
          const msg = await channel.messages.fetch(messageId);
          await msg.edit({ embeds: [buildEmbed(rec.fields, { closed: rec.fields[C.f.status] !== C.ACTIVE })] });
        }
        if (hasThread(rec.fields)) await syncCampaignChannel(rec);
      } catch (err) {
        log(`Could not refresh post ${messageId}: ${err.message}`);
      }
    }, 4000)
  );
}

async function syncCampaignPosts() {
  const channel = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
  const campaignFields = Object.values(C.f);

  // 1) New: Active + Post to Discord + not yet posted
  const toPost = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.postToDiscord}}, {${C.names.discordMessageId}}="", {${C.names.joinMode}}!="Invite-only")`,
    fields: campaignFields,
  });
  for (const rec of toPost) {
    const msg = await channel.send({ embeds: [buildEmbed(rec.fields)] });
    await msg.react(SIGNUP_EMOJI);
    await at.update(C.table, rec.id, { [C.f.discordMessageId]: msg.id, [C.f.discordClosed]: false });
    campaignByMessage.set(msg.id, campaignInfo(rec));
    log(`Posted campaign ${rec.id} as message ${msg.id}`);
    if (hasThread(rec.fields)) await syncCampaignChannel({ ...rec, fields: { ...rec.fields, [C.f.discordMessageId]: msg.id } });
  }

  // 1a) Repost: delete the old post, post fresh at the bottom, carry sign-ups over to the new post
  const toRepost = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.repost}}, {${C.names.discordMessageId}}!="")`,
    fields: campaignFields,
  });
  for (const rec of toRepost) {
    const oldId = rec.fields[C.f.discordMessageId];
    if (isInviteKey(oldId)) {
      await at.update(C.table, rec.id, { [C.f.repost]: false });
      continue; // invite-only campaigns have no public post
    }
    const old = await channel.messages.fetch(oldId).catch(() => null);
    if (old) await old.delete().catch((err) => log(`Couldn't delete old post ${oldId}: ${err.message}`));
    const msg = await channel.send({ embeds: [buildEmbed(rec.fields)] });
    await msg.react(SIGNUP_EMOJI);
    await at.update(C.table, rec.id, { [C.f.discordMessageId]: msg.id, [C.f.discordClosed]: false, [C.f.repost]: false });
    // Move every sign-up to the new post. People who'd reacted on the old post are marked so the
    // reaction check doesn't withdraw them (their old reaction went away with the old post).
    const rows = await at.list(K.table, { formula: `{${K.names.discordMessageId}}=${at.q(oldId)}`, fields: [K.f.joinedVia, K.f.status] });
    for (const r of rows) {
      const via = r.fields[K.f.joinedVia];
      await at.update(K.table, r.id, {
        [K.f.discordMessageId]: msg.id,
        ...(!via || via === 'Discord' ? { [K.f.joinedVia]: 'Discord (reposted)' } : {}),
      });
    }
    campaignByMessage.delete(oldId);
    campaignByMessage.set(msg.id, campaignInfo(rec));
    log(`Reposted campaign ${rec.id}: ${oldId} → ${msg.id} (${rows.length} sign-up row(s) moved)`);
    if (hasThread(rec.fields)) await syncCampaignChannel({ ...rec, fields: { ...rec.fields, [C.f.discordMessageId]: msg.id } });
  }

  // 1b) Posted campaigns with an org linked but no thread yet (or an old channel to move over) → create its thread
  const needChannel = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.orgLinks}}!="", {${C.names.discordMessageId}}!="", OR({${C.names.threadId}}="", {${C.names.oldChannelId}}!=""))`,
    fields: campaignFields,
  });
  for (const rec of needChannel) await syncCampaignChannel(rec);

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
    if (!isInviteKey(messageId)) {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ embeds: [buildEmbed(rec.fields, { closed })] });
    }
  } catch (err) {
    log(`Could not edit message ${messageId} for ${rec.id} (deleted?): ${err.message}`);
  }
  await at.update(C.table, rec.id, { [C.f.discordClosed]: closed });
  campaignByMessage.set(messageId, { ...campaignInfo(rec), closed });
  log(`${closed ? 'Closed' : 'Re-opened'} campaign ${rec.id}`);
  if (hasThread(rec.fields)) await syncCampaignChannel({ ...rec, fields: { ...rec.fields, [C.f.status]: closed ? 'closed' : C.ACTIVE } });
}

// ---------- campaign spaces: one private channel per partner org (the lobby), a private thread per campaign ----------
// Lobby: the org's linked contacts + staff + every creator confirmed on one of the org's campaigns.
// Thread: only that campaign's confirmed creators + the org's contacts (staff see every thread via Manage Threads).
// Closed campaign → its thread is locked (read-only). Withdraw → removed from the thread (and from the lobby if it was
// their last campaign with that org). Old one-channel-per-campaign channels are moved over automatically.

// Every campaign with a partner org linked gets a private thread in that org's channel.
const hasThread = (f) => (f?.[C.f.orgLinks] || []).length > 0;

const slug = (name) =>
  String(name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'campaign';

async function ensureCategory(guild, name) {
  await guild.channels.fetch();
  const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
    ],
  });
}

const VIEW = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
const POST = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.AddReactions, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const BOT_PERMS = [...VIEW, ...POST, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.ManageMessages];

// One sync at a time per org: the lobby and its threads change together.
const orgSyncs = new Map();
function syncCampaignChannel(rec) {
  const key = first1(rec.fields[C.f.orgLinks]) || rec.id;
  const prev = orgSyncs.get(key) || Promise.resolve();
  const next = prev.then(() => doSyncCampaignThread(rec)).catch((err) => log(`Thread sync failed for ${rec.id}: ${err.message}`));
  orgSyncs.set(key, next);
  return next;
}

async function committedDiscordIds(f) {
  if (!f[C.f.discordMessageId]) return new Set();
  const rows = await at.list(K.table, {
    formula: `AND({${K.names.discordMessageId}}=${at.q(f[C.f.discordMessageId])}, {${K.names.status}}="Committed")`,
    fields: [K.f.discordUserId],
  });
  return new Set(rows.map((r) => r.fields[K.f.discordUserId]).filter(isSnowflake));
}

async function ensureOrgChannel(guild, org) {
  const id = org.fields[O.f.channelId];
  let ch = id ? await guild.channels.fetch(id).catch(() => null) : null;
  if (ch) return ch;
  const orgName = org.fields[O.f.organization] || 'Partner';
  const parent = await ensureCategory(guild, ORG_CATEGORY);
  ch = await guild.channels.create({
    name: slug(orgName),
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: `Private space for ${orgName} and the creators working with them. Each campaign has its own thread.`.slice(0, 1024),
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: client.user.id, allow: BOT_PERMS },
    ],
  });
  await at.update(O.table, org.id, { [O.f.channelId]: ch.id });
  log(`Created org channel #${ch.name} for ${org.id}`);
  const welcome = await ch.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(`👋 Welcome to ${orgName}'s space`.slice(0, 256))
        .setColor(0x5865f2)
        .setDescription(
          `This is the private lobby for **${orgName}** and the creators working with them.\n\n` +
            '• **Lobby (here):** announcements and anything that applies to all of their campaigns. Everyone working with this partner can read it.\n' +
            '• **Campaign threads:** each campaign has a private thread below. You only see the threads for campaigns you’re confirmed on.\n\n' +
            'People are added and removed automatically as they join or leave campaigns. When a campaign ends, its thread becomes read-only.'
        ),
    ],
  });
  await welcome.pin().catch(() => {});
  return ch;
}

// Lobby permissions: org contacts + staff always; creators who can post if they're on an active campaign,
// read-only if all their campaigns with this org have ended (so closed threads stay readable).
async function syncOrgLobby(guild, org, ch, camps) {
  const orgIds = new Set(idList(org.fields[O.f.discordUserId]).filter(isSnowflake));
  const creatorActive = new Map();
  for (const p of camps) {
    const active = p.fields[C.f.status] === C.ACTIVE;
    for (const id of await committedDiscordIds(p.fields)) creatorActive.set(id, creatorActive.get(id) || active);
  }
  const desired = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: client.user.id, allow: BOT_PERMS },
  ];
  // Manage Threads lets staff see every private thread without being added to each one.
  if (STAFF_ROLE_ID) desired.push({ id: STAFF_ROLE_ID, allow: [...VIEW, ...POST, PermissionFlagsBits.ManageThreads] });
  for (const id of orgIds) desired.push({ id, allow: [...VIEW, ...POST] });
  for (const [id, active] of creatorActive) {
    if (orgIds.has(id)) continue;
    desired.push(active ? { id, allow: [...VIEW, ...POST] } : { id, allow: VIEW, deny: POST });
  }
  await ch.permissionOverwrites.set(desired);
  return orgIds;
}

// The bot's role needs these server-wide to make org channels and private threads.
const NEEDED_PERMS = ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles', 'AddReactions',
  'ManageChannels', 'ManageRoles', 'ManageThreads', 'CreatePrivateThreads', 'ManageMessages'];
let lastPermWarning = 0;
async function missingBotPerms(guild) {
  let me = null;
  try {
    me = guild.members.me || (await guild.members.fetchMe());
  } catch {
    return [];
  }
  if (!me?.permissions) return [];
  if (me.permissions.has(PermissionFlagsBits.Administrator)) return [];
  return NEEDED_PERMS.filter((p) => !me.permissions.has(PermissionFlagsBits[p]));
}

const welcomedToThread = new Set(); // `${threadId}:${userId}` already pinged this run

async function doSyncCampaignThread(rec) {
  const f = rec.fields;
  if (!f[C.f.discordMessageId]) return;
  {
    const g = await client.guilds.fetch(DISCORD_GUILD_ID);
    const missing = await missingBotPerms(g);
    if (missing.length) {
      if (Date.now() - lastPermWarning > 30 * 60_000) {
        lastPermWarning = Date.now();
        log(`CAN'T MAKE ORG CHANNELS/THREADS: the bot's role is missing these permissions: ${missing.join(', ')}. ` +
          'Fix: Discord → Server Settings → Roles → the bot\'s role → turn them on (or re-open the invite link with the new permissions). ' +
          'Also drag the bot\'s role above your staff role.');
      }
      return;
    }
  }
  const orgId = first1(f[C.f.orgLinks]);
  if (!orgId) return log(`Campaign ${rec.id} has no organization linked, so there's no org channel to put its thread in.`);
  const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
  const closed = f[C.f.status] !== C.ACTIVE;
  const name = f[C.f.shortName] || 'Campaign';

  // Re-read IDs in case an earlier sync just created them.
  const fresh = await at.first(C.table, { formula: `RECORD_ID()=${at.q(rec.id)}`, fields: [C.f.threadId, C.f.oldChannelId] });
  const threadId = fresh?.fields[C.f.threadId];
  if (!threadId && closed) return; // never create a thread for a closed campaign
  const org = await at.first(O.table, { formula: `RECORD_ID()=${at.q(orgId)}`, fields: [O.f.organization, O.f.discordUserId, O.f.proposals, O.f.channelId] });
  if (!org) return;

  const ch = await ensureOrgChannel(guild, org);
  const camps = (org.fields[O.f.proposals] || []).length
    ? (await listByIds(C.table, org.fields[O.f.proposals], [C.f.status, C.f.discordMessageId, C.f.threadId])).filter(
        (p) => p.fields[C.f.discordMessageId] && (p.fields[C.f.threadId] || p.id === rec.id)
      )
    : [];
  if (!camps.some((p) => p.id === rec.id)) camps.push({ id: rec.id, fields: f });
  const orgIds = await syncOrgLobby(guild, org, ch, camps); // permissions first, so new people can be added to the thread

  let thread = threadId ? await client.channels.fetch(threadId).catch(() => null) : null;
  const isNew = !thread;
  if (!thread) {
    thread = await ch.threads.create({
      name: name.slice(0, 100),
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Campaign ${rec.id}`,
    });
    await at.update(C.table, rec.id, { [C.f.threadId]: thread.id });
    log(`Created thread "${thread.name}" in #${ch.name} for ${rec.id}`);
  }

  if (closed) {
    if (!thread.locked) {
      if (thread.archived) await thread.setArchived(false);
      await thread.send('📦 This campaign is now closed. The thread is read-only. Thanks, everyone!');
      await thread.setLocked(true);
      await thread.setArchived(true);
    }
    return;
  }
  if (thread.archived) await thread.setArchived(false); // Discord hides threads after a quiet week; keep active ones open
  if (thread.locked) {
    await thread.setLocked(false);
    await thread.send('🔓 This campaign has been reopened. Welcome back!');
  }

  const want = new Set([...(await committedDiscordIds(f)), ...orgIds]);
  // Ask Discord about each person individually. (Listing every thread member needs the privileged
  // "Server Members" intent; without it the list comes back empty and everyone looks new.)
  const inThread = async (id) => {
    try {
      await thread.members.fetch({ member: id, force: true });
      return true;
    } catch {
      return false;
    }
  };
  const newcomers = [];
  for (const id of want) {
    const key = `${thread.id}:${id}`;
    if (await inThread(id)) {
      welcomedToThread.add(key);
      continue;
    }
    try {
      await thread.members.add(id);
      if (!welcomedToThread.has(key)) {
        welcomedToThread.add(key); // never ping the same person twice in one thread
        newcomers.push(id);
      }
    } catch (err) {
      log(`Couldn't add ${id} to thread ${thread.id}: ${err.message}`);
    }
  }
  // Remove people who left or were declined (staff who joined on their own stay).
  const gone = await at.list(K.table, {
    formula: `AND({${K.names.discordMessageId}}=${at.q(f[C.f.discordMessageId])}, OR({${K.names.status}}="Withdrawn", {${K.names.status}}="Declined", {${K.names.status}}="Declined invite"))`,
    fields: [K.f.discordUserId],
  });
  for (const id of new Set(gone.map((r) => r.fields[K.f.discordUserId]).filter(isSnowflake))) {
    if (want.has(id) || id === client.user.id) continue;
    if (!(await inThread(id))) continue;
    if (await isStaff(id)) continue;
    await thread.members.remove(id).catch(() => {});
    welcomedToThread.delete(`${thread.id}:${id}`);
  }

  if (isNew) {
    const postLink = `https://discord.com/channels/${DISCORD_GUILD_ID}/${CAMPAIGN_CHANNEL_ID}/${f[C.f.discordMessageId]}`;
    const intro = await thread.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`👋 Welcome to ${name}`.slice(0, 256))
          .setColor(0x2ecc71)
          .setDescription(
            `This is the private thread for this campaign.${isInviteKey(f[C.f.discordMessageId]) ? '' : ` [See the campaign post](${postLink}).`}\n\n` +
              'Confirmed creators are added automatically, along with the partner organization. The Creator Congress team can see it too. ' +
              'Leaving the campaign removes you from this thread.'
          ),
      ],
    });
    await intro.pin().catch(() => {});
  }
  const creatorsNew = newcomers.filter((id) => !orgIds.has(id));
  if (creatorsNew.length && !isNew) await thread.send(`👋 Welcome ${creatorsNew.map((id) => `<@${id}>`).join(' ')}!`);
  if (isNew && newcomers.length) await thread.send(`👋 Welcome ${newcomers.map((id) => `<@${id}>`).join(' ')}!`);

  // Move over an old one-channel-per-campaign channel: point people to the thread and make the old one read-only.
  const oldId = fresh?.fields[C.f.oldChannelId];
  if (oldId) {
    const old = await guild.channels.fetch(oldId).catch(() => null);
    if (old) {
      await old.send(`➡️ This campaign has moved to a thread in ${ch}: <#${thread.id}>. This channel is now read-only and kept for history.`).catch(() => {});
      const keep = old.permissionOverwrites.cache.filter((o) => o.type === 1 && o.id !== client.user.id).map((o) => ({ id: o.id, allow: VIEW, deny: POST }));
      const archive = await ensureCategory(guild, ARCHIVE_CATEGORY);
      await old.setParent(archive.id, { lockPermissions: false }).catch(() => {});
      await old.permissionOverwrites.set([
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: BOT_PERMS },
        ...(STAFF_ROLE_ID ? [{ id: STAFF_ROLE_ID, allow: VIEW }] : []),
        ...keep,
      ]).catch(() => {});
      log(`Moved old channel #${old.name} → thread ${thread.id}`);
    }
    await at.update(C.table, rec.id, { [C.f.oldChannelId]: '' });
  }
}

// Every 30 minutes: re-check active campaign threads (reopens threads Discord auto-archived, fixes any drift).
let lastThreadSweep = 0;
async function sweepCampaignThreads() {
  if (Date.now() - lastThreadSweep < 30 * 60_000) return;
  lastThreadSweep = Date.now();
  const recs = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.threadId}}!="")`,
    fields: Object.values(C.f),
  });
  for (const rec of recs) await syncCampaignChannel(rec);
}

// ---------- members & commitments ----------

async function findMemberByDiscordId(userId) {
  if (!isSnowflake(userId)) return null;
  return at.first(M.table, {
    formula: `{${M.names.discordUserId}}=${at.q(userId)}`,
    fields: [M.f.fullName, M.f.firstName, M.f.email],
  });
}

async function findCommitment(userId, messageId) {
  return at.first(K.table, {
    formula: `AND({${K.names.discordUserId}}=${at.q(userId)}, {${K.names.discordMessageId}}=${at.q(messageId)})`,
    fields: [K.f.status, K.f.creator],
  });
}

async function commit(user, messageId, campaign) {
  const member = await findMemberByDiscordId(user.id);
  const existing = await findCommitment(user.id, messageId);
  const memberName = member?.fields[M.f.fullName] || user.username;
  const pending = !!campaign.approval;
  if (existing?.fields[K.f.status] === 'Declined') return { member, changed: false, declined: true };
  const fields = {
    [K.f.title]: `${memberName} → ${campaign.name}`,
    [K.f.campaign]: [campaign.id],
    [K.f.status]: pending ? 'Pending' : 'Committed',
    [K.f.committedAt]: pending ? null : now(),
    [K.f.requestedAt]: now(),
    [K.f.reviewedBy]: null,
    [K.f.reviewedAt]: null,
    [K.f.reminderSent]: false,
    [K.f.flagged]: false,
    [K.f.withdrawnAt]: null,
    [K.f.discordUserId]: user.id,
    [K.f.discordUsername]: user.username,
    [K.f.discordMessageId]: messageId,
    [K.f.joinedVia]: 'Discord',
  };
  if (member) fields[K.f.creator] = [member.id];

  let recordId;
  if (existing) {
    if (['Committed', 'Pending'].includes(existing.fields[K.f.status])) return { member, changed: false, pending: existing.fields[K.f.status] === 'Pending' };
    recordId = (await at.update(K.table, existing.id, fields)).id;
  } else {
    recordId = (await at.create(K.table, fields)).id;
  }
  log(`${pending ? 'Requested' : 'Committed'}: ${user.username} (${user.id}) → ${campaign.name}`);
  if (pending) notifyReviewers(recordId).catch((err) => log('notifyReviewers error', err));
  else scheduleRefresh(messageId, campaign.id);
  return { member, changed: true, pending };
}

async function withdraw(user, messageId, campaign) {
  const existing = await findCommitment(user.id, messageId);
  if (!existing || !['Committed', 'Pending'].includes(existing.fields[K.f.status])) return false; // Declined stays Declined
  await at.update(K.table, existing.id, { [K.f.status]: 'Withdrawn', [K.f.withdrawnAt]: now() });
  log(`Withdrawn: ${user.username} (${user.id}) ✗ ${campaign.name}`);
  scheduleRefresh(messageId, campaign.id);
  return true;
}

async function dm(user, content) {
  try {
    await user.send(content);
  } catch {
    // user has DMs closed — nothing else to do
  }
}

// ---------- reaction handling ----------

async function resolveReaction(reaction, user) {
  if (user.bot) return null;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return null;
    }
  }
  if (reaction.message.channelId !== CAMPAIGN_CHANNEL_ID) return null;
  if (reaction.emoji.name !== SIGNUP_EMOJI) return null;
  const campaign = await getCampaignForMessage(reaction.message.id);
  if (campaign) return { campaign, messageId: reaction.message.id };
  // A bot post whose campaign was deleted or replaced in Airtable: tell people instead of ignoring them.
  if (reaction.message.partial) await reaction.message.fetch().catch(() => {});
  if (reaction.message.author?.id === client.user.id) return { orphan: true, messageId: reaction.message.id };
  return null;
}

const closedOrphans = new Set();
async function handleOrphanReaction(reaction, user) {
  await reaction.users.remove(user.id).catch(() => {});
  await dm(user, `That campaign post is out of date, so your sign-up wasn't recorded. Check <#${CAMPAIGN_CHANNEL_ID}> for the current version of the campaign and react there. 💚`);
  const msg = reaction.message;
  if (closedOrphans.has(msg.id)) return;
  closedOrphans.add(msg.id);
  try {
    const old = msg.embeds[0];
    const e = old ? EmbedBuilder.from(old) : new EmbedBuilder().setTitle('Campaign');
    e.setAuthor({ name: '⛔  NO LONGER ACTIVE' }).setColor(0x4f545c).setFooter({ text: 'This post is out of date. Look for the current campaign in this channel.' });
    await msg.edit({ embeds: [e] });
    log(`Marked out-of-date post ${msg.id} (no campaign in Airtable)`);
  } catch (err) {
    log(`Couldn't mark out-of-date post ${msg.id}: ${err.message}`);
  }
}

// Only nudge unlinked members to /link once: on their very first sign-up (survives restarts).
const reminded = new Set();
async function isFirstSignup(userId) {
  if (reminded.has(userId)) return false;
  reminded.add(userId);
  const rows = await at.list(K.table, { formula: `{${K.names.discordUserId}}=${at.q(userId)}`, fields: [K.f.title], maxRecords: 2 });
  return rows.length <= 1;
}

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    const hit = await resolveReaction(reaction, user);
    if (!hit) return;
    if (hit.orphan) return handleOrphanReaction(reaction, user);
    if (hit.campaign.closed) {
      await reaction.users.remove(user.id).catch(() => {});
      await dm(user, `**${hit.campaign.name}** is closed, so your sign-up wasn't recorded.`);
      return;
    }
    const { member, changed, pending, declined } = await commit(user, hit.messageId, hit.campaign);
    if (declined) {
      await reaction.users.remove(user.id).catch(() => {});
      await dm(user, `Thanks for your interest in **${hit.campaign.name}**! The partner has already finalized their decision on your request for this one. Keep an eye on <#${CAMPAIGN_CHANNEL_ID}> for more. 💚`);
      return;
    }
    const linkNote = !member && changed && (await isFirstSignup(user.id))
      ? '\n\nOne more thing: your Discord account isn\'t linked to your Creator Congress profile yet. Run `/link` with the email you applied with, in the server, so partners can see your profile.'
      : '';
    if (changed && pending) {
      await dm(user, `🙋 Your request to join **${hit.campaign.name}** is in! ${hit.campaign.org} reviews each sign-up for this campaign, and we'll DM you as soon as you're confirmed. Remove your ${SIGNUP_EMOJI} anytime to cancel.${linkNote}`);
    } else if (changed) {
      const campFields = await campaignFieldsById(hit.campaign.id);
      if (campFields) await announceConfirmed({ campFields, user, headline: `✅ You're signed up for **${hit.campaign.name}**!`, extra: linkNote });
      else await dm(user, `Thanks for signing up for **${hit.campaign.name}**! We've recorded it.${linkNote}`);
    }
  } catch (err) {
    log('reactionAdd error', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    const hit = await resolveReaction(reaction, user);
    if (!hit || hit.orphan || hit.campaign.closed) return; // removals on closed or out-of-date posts (incl. our own cleanup) don't withdraw
    await withdraw(user, hit.messageId, hit.campaign);
  } catch (err) {
    log('reactionRemove error', err);
  }
});

// ---------- catch-up: reconcile reactions that happened while the bot was offline ----------

async function reconcileOpenCampaigns() {
  const channel = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
  const open = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.discordMessageId}}!="")`,
    fields: [C.f.shortName, C.f.discordMessageId, C.f.status, C.f.requiresApproval, C.f.joinMode, C.f.orgName],
  });
  for (const rec of open) {
    const messageId = rec.fields[C.f.discordMessageId];
    if (isInviteKey(messageId)) continue; // invite-only: no public post to reconcile
    const campaign = campaignInfo(rec);
    campaignByMessage.set(messageId, campaign);
    let msg;
    try {
      msg = await channel.messages.fetch(messageId);
    } catch {
      log(`Reconcile: message ${messageId} not found for ${rec.id}`);
      continue;
    }
    const reaction = msg.reactions.cache.find((r) => r.emoji.name === SIGNUP_EMOJI);
    const reactors = new Map();
    if (reaction) {
      let after;
      for (;;) {
        const batch = await reaction.users.fetch({ limit: 100, after });
        batch.filter((u) => !u.bot).forEach((u) => reactors.set(u.id, u));
        if (batch.size < 100) break;
        after = batch.lastKey();
      }
    }
    const recorded = await at.list(K.table, {
      formula: `AND({${K.names.discordMessageId}}=${at.q(messageId)}, OR({${K.names.status}}="Committed", {${K.names.status}}="Pending"))`,
      fields: [K.f.discordUserId, K.f.joinedVia],
    });
    const recordedIds = new Set(recorded.map((r) => r.fields[K.f.discordUserId]));
    for (const [id, u] of reactors) {
      if (recordedIds.has(id)) continue;
      const res = await commit(u, messageId, campaign);
      if (res.declined) await reaction.users.remove(id).catch(() => {});
    }
    for (const r of recorded) {
      const uid = r.fields[K.f.discordUserId];
      if (['Web page', 'Invitation', 'Portal', 'Discord (reposted)'].includes(r.fields[K.f.joinedVia])) continue; // joined outside Discord, or before a repost
      if (!reactors.has(uid)) {
        await at.update(K.table, r.id, { [K.f.status]: 'Withdrawn', [K.f.withdrawnAt]: now() });
        log(`Reconcile: withdrew ${uid} from ${campaign.name}`);
      }
    }
    scheduleRefresh(messageId, campaign.id); // also upgrades older posts to the current design
  }
}

// ---------- approval: org (or staff) reviews each sign-up ----------

async function isStaff(userId) {
  try {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
    const member = await guild.members.fetch(userId);
    return member.permissions.has(PermissionFlagsBits.ManageGuild) || (STAFF_ROLE_ID && member.roles.cache.has(STAFF_ROLE_ID));
  } catch {
    return false;
  }
}

async function orgContactIds(orgLinks) {
  if (!orgLinks?.length) return [];
  const orgs = await listByIds(O.table, orgLinks, [O.f.discordUserId]);
  return [...new Set(orgs.flatMap((o) => idList(o.fields[O.f.discordUserId]).filter(isSnowflake)))];
}

const REQUEST_FIELDS = () => [K.f.title, K.f.status, K.f.campaign, K.f.creator, K.f.discordUserId, K.f.discordUsername, K.f.discordMessageId, K.f.requestedAt, K.f.reviewedBy];

async function loadRequest(recordId) {
  const req = await at.first(K.table, { formula: `RECORD_ID()=${at.q(recordId)}`, fields: REQUEST_FIELDS() });
  if (!req) return null;
  const campaignId = (req.fields[K.f.campaign] || [])[0];
  const camp = campaignId
    ? await at.first(C.table, { formula: `RECORD_ID()=${at.q(campaignId)}`, fields: [C.f.shortName, C.f.orgName, C.f.orgLinks, C.f.longTerm, C.f.threadId, C.f.discordMessageId] })
    : null;
  const creatorId = (req.fields[K.f.creator] || [])[0];
  const creator = creatorId
    ? await at.first(M.table, {
        formula: `RECORD_ID()=${at.q(creatorId)}`,
        fields: [M.f.fullName, M.f.reach, M.f.tiktok, M.f.instagram, M.f.youtube, M.f.issues, M.f.about, M.f.state],
      })
    : null;
  return { req, camp, creator };
}

function buildReviewCard({ req, camp, creator }, { banner } = {}) {
  const cf = creator?.fields || {};
  const name = cf[M.f.fullName] || req.fields[K.f.discordUsername] || 'Creator';
  const campName = camp?.fields[C.f.shortName] || 'Campaign';
  const reach = Number(cf[M.f.reach]);
  const handles = [
    cf[M.f.tiktok] && `TikTok **${cf[M.f.tiktok]}**`,
    cf[M.f.instagram] && `Instagram **${cf[M.f.instagram]}**`,
    cf[M.f.youtube] && `YouTube **${cf[M.f.youtube]}**`,
  ].filter(Boolean);
  const issues = Array.isArray(cf[M.f.issues]) ? cf[M.f.issues].slice(0, 6) : [];
  const about = String(cf[M.f.about] || '').trim();

  const e = new EmbedBuilder()
    .setAuthor({ name: banner || '🙋  SIGN-UP REQUEST' })
    .setTitle(`${name} wants to join ${campName}`.slice(0, 256))
    .setColor(0xf1c40f)
    .setDescription(
      [
        isSnowflake(req.fields[K.f.discordUserId]) ? `Discord: <@${req.fields[K.f.discordUserId]}>` : null,
        cf[M.f.state] ? `📍 ${cf[M.f.state]}` : null,
        Number.isFinite(reach) && reach > 0 ? `👥 **${reach.toLocaleString('en-US')}** total followers` : null,
        handles.length ? handles.join(' · ') : null,
        issues.length ? `🏷️ ${issues.map((t) => `\`${t}\``).join(' ')}` : null,
        about ? `\n> ${about.slice(0, 400).replace(/\n+/g, '\n> ')}${about.length > 400 ? '…' : ''}` : null,
        !creator ? '_This creator hasn’t linked their Creator Congress profile yet._' : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  const requested = req.fields[K.f.requestedAt];
  e.setFooter({ text: `Requested ${requested ? fmtDate(requested.slice(0, 10)) : 'recently'} · Approve or decline below` });
  const first = name.split(' ')[0].slice(0, 30);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rv:a:${req.id}`).setLabel(`Approve ${first}`).setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`rv:d:${req.id}`).setLabel(`Decline ${first}`).setStyle(ButtonStyle.Secondary)
  );
  return { embed: e, row };
}

async function notifyReviewers(recordId, { reminder = false } = {}) {
  const data = await loadRequest(recordId);
  if (!data?.camp) return;
  const { embed, row } = buildReviewCard(data, { banner: reminder ? '⏰  REMINDER: STILL WAITING FOR YOUR REVIEW' : undefined });
  const contacts = await orgContactIds(data.camp.fields[C.f.orgLinks]);
  let delivered = 0;
  for (const id of contacts) {
    try {
      const u = await client.users.fetch(id);
      await u.send({ embeds: [embed], components: [row] });
      delivered++;
    } catch {
      /* DMs closed */
    }
  }
  if (REVIEW_CHANNEL_ID && (!reminder || !delivered)) {
    try {
      const ch = await client.channels.fetch(REVIEW_CHANNEL_ID);
      await ch.send({
        content: delivered ? null : '⚠️ No linked org contact could be reached for this request, so staff will need to review it.',
        embeds: [embed],
        components: [row],
      });
    } catch (err) {
      log(`Could not post to review channel: ${err.message}`);
    }
  }
  // Email the org lead too, so orgs that aren't on Discord can review on their partner page.
  try {
    const campFields = await campaignFieldsById(data.camp.id);
    const cf = data.creator?.fields || {};
    const who = cf[M.f.fullName] || data.req.fields[K.f.discordUsername] || 'A creator';
    const campName = campFields?.[C.f.shortName] || 'your campaign';
    const reach = Number(cf[M.f.reach]);
    const body =
      `${reminder ? 'Reminder: ' : ''}${who} has asked to join ${campName}.` +
      (Number.isFinite(reach) && reach > 0 ? ` They have about ${reach.toLocaleString('en-US')} followers.` : '') +
      (cf[M.f.state] ? ` Based in ${cf[M.f.state]}.` : '') +
      `\n\nPlease approve or decline on your partner page (or in Discord with /review). If there's no reply in 7 days, the Creator Congress team will follow up.`;
    const { email, name } = leadContact(campFields || {});
    const orgs = (campFields?.[C.f.orgLinks] || []).length ? await listByIds(O.table, campFields[C.f.orgLinks], [O.f.pageLink]) : [];
    const page = orgs.map((o) => o.fields[O.f.pageLink]).find(Boolean);
    if (email) {
      await queueRawEmail({
        to: email,
        kind: 'Review request',
        subject: `${reminder ? 'Reminder: ' : ''}${who} wants to join ${campName}`,
        body: `Hi ${name ? name.split(' ')[0] : 'there'},\n\n${body}${page ? `\n\n[Review on your partner page](${page}#review)` : ''}\n\nQuestions? Reply to the Creator Congress team.`,
      });
    }
  } catch (err) {
    log('review email error', err);
  }
  log(`Review request ${recordId} sent to ${delivered} org contact(s)${reminder ? ' (reminder)' : ''}`);
}

// Approve or decline a Pending request (shared by Discord buttons and the partner page).
async function applyDecision(req, camp, approve, reviewer) {
  await at.update(K.table, req.id, {
    [K.f.status]: approve ? 'Committed' : 'Declined',
    ...(approve ? { [K.f.committedAt]: now() } : {}),
    [K.f.reviewedBy]: reviewer,
    [K.f.reviewedAt]: now(),
  });
  const campName = camp.fields[C.f.shortName] || 'the campaign';
  const messageId = req.fields[K.f.discordMessageId];
  const creatorUser = isSnowflake(req.fields[K.f.discordUserId]) ? await client.users.fetch(req.fields[K.f.discordUserId]).catch(() => null) : null;

  const campFields = (await campaignFieldsById(camp.id)) || camp.fields;
  const cid = (req.fields[K.f.creator] || [])[0];
  if (approve) {
    announceConfirmed({ campFields, creatorId: cid, user: creatorUser }).catch((err) => log('announce error', err));
  } else {
    // Quietly remove their reaction so the post reflects reality (the remove event is ignored for Declined).
    try {
      const ch = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
      const msg = await ch.messages.fetch(messageId);
      await msg.reactions.cache.find((r) => r.emoji.name === SIGNUP_EMOJI)?.users.remove(req.fields[K.f.discordUserId]);
    } catch {
      /* post gone or no permission */
    }
    if (creatorUser) {
      await dm(
        creatorUser,
        `Thanks so much for your interest in **${campName}**. The partner wasn't able to bring you on for this one, ` +
          `but that's no reflection on your work. Partners often have very specific needs for each campaign. ` +
          `Keep an eye on <#${CAMPAIGN_CHANNEL_ID}> for more opportunities. We'd love to see you on the next one! 💚`
      );
    }
  }
  scheduleRefresh(messageId, camp.id); // updates the spot count and private-channel access
  if (cid && !approve) {
    const contact = await at.first(M.table, { formula: `RECORD_ID()=${at.q(cid)}`, fields: CREATOR_CONTACT_FIELDS() });
    if (contact) await emailDecision(contact, campFields, false).catch((err) => log('email error', err));
  }

  log(`${approve ? 'Approved' : 'Declined'} ${req.id} by ${reviewer}`);
}

async function handleReviewButton(interaction) {
  const [, action, recordId] = interaction.customId.split(':');
  const data = await loadRequest(recordId);
  if (!data?.camp) return interaction.reply({ content: 'This request no longer exists.', flags: MessageFlags.Ephemeral });
  const { req, camp } = data;

  const allowed = (await orgContactIds(camp.fields[C.f.orgLinks])).includes(interaction.user.id) || (await isStaff(interaction.user.id));
  if (!allowed) return interaction.reply({ content: "You're not a reviewer for this campaign.", flags: MessageFlags.Ephemeral });

  const status = req.fields[K.f.status];
  if (status !== 'Pending') {
    const by = req.fields[K.f.reviewedBy] ? ` by ${req.fields[K.f.reviewedBy]}` : '';
    const word = status === 'Committed' ? 'approved' : status === 'Declined' ? 'declined' : 'withdrawn by the creator';
    await interaction.update({ components: [] }).catch(() => {});
    return interaction.followUp({ content: `This request was already ${word}${status === 'Withdrawn' ? '' : by}.`, flags: MessageFlags.Ephemeral });
  }

  const reviewer = interaction.user.globalName || interaction.user.username;
  const approve = action === 'a';
  await interaction.deferUpdate(); // the decision takes a few seconds; Discord needs an answer within 3
  await applyDecision(req, camp, approve, reviewer);

  const done = EmbedBuilder.from(interaction.message.embeds[0])
    .setAuthor({ name: approve ? `✅  APPROVED by ${reviewer}` : `✖️  DECLINED by ${reviewer}` })
    .setColor(approve ? 0x2ecc71 : 0x4f545c)
    .setFooter({ text: approve ? 'The creator has been notified and added.' : 'The creator was sent a kind, private note. No reason was shared.' });
  return interaction.editReply({ embeds: [done], components: [] });
}

async function handleReview(interaction) {
  const staff = await isStaff(interaction.user.id);
  const orgs = await findOrgsByDiscordId(interaction.user.id);
  if (!staff && !orgs.length) {
    return interaction.editReply("This command is for partner organizations. Run `/link` with your organization's application email first.");
  }
  let formula = `{${K.names.status}}="Pending"`;
  if (!staff) {
    const proposalIds = [...new Set(orgs.flatMap((o) => o.fields[O.f.proposals] || []))];
    const props = proposalIds.length ? await listByIds(C.table, proposalIds, [C.f.discordMessageId]) : [];
    const mids = props.map((p) => p.fields[C.f.discordMessageId]).filter(Boolean);
    if (!mids.length) return interaction.editReply('🎉 Nothing to review right now.');
    formula = `AND(${formula}, OR(${mids.map((m) => `{${K.names.discordMessageId}}=${at.q(m)}`).join(',')}))`;
  }
  const pending = await at.list(K.table, { formula, fields: [K.f.requestedAt] });
  if (!pending.length) return interaction.editReply('🎉 Nothing to review right now.');
  pending.sort((a, b) => String(a.fields[K.f.requestedAt]).localeCompare(String(b.fields[K.f.requestedAt])));
  const embeds = [];
  const components = [];
  for (const p of pending.slice(0, 5)) {
    const data = await loadRequest(p.id);
    if (!data?.camp) continue;
    const { embed, row } = buildReviewCard(data);
    embeds.push(embed);
    components.push(row);
  }
  const more = pending.length - embeds.length;
  return interaction.editReply({
    content: `**${pending.length}** request${pending.length === 1 ? '' : 's'} waiting, oldest first.${more > 0 ? ` Showing ${embeds.length}; run \`/review\` again after these for the rest.` : ''}`,
    embeds,
    components,
  });
}

// Reminders: org nudged after 3 days, staff alerted after 7. Requests never auto-approve.
async function checkStaleRequests() {
  const remind = await at.list(K.table, {
    formula: `AND({${K.names.status}}="Pending", DATETIME_DIFF(NOW(), {${K.names.requestedAt}}, 'days')>=3, NOT({${K.names.reminderSent}}))`,
    fields: [K.f.title],
  });
  for (const r of remind) {
    await notifyReviewers(r.id, { reminder: true });
    await at.update(K.table, r.id, { [K.f.reminderSent]: true });
  }
  const stale = await at.list(K.table, {
    formula: `AND({${K.names.status}}="Pending", DATETIME_DIFF(NOW(), {${K.names.requestedAt}}, 'days')>=7, NOT({${K.names.flagged}}))`,
    fields: [K.f.title],
  });
  for (const r of stale) {
    if (REVIEW_CHANNEL_ID) {
      const data = await loadRequest(r.id);
      if (data?.camp) {
        const { embed, row } = buildReviewCard(data, { banner: '⚠️  PENDING 7+ DAYS: STAFF FOLLOW-UP NEEDED' });
        const ch = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
        await ch?.send({ content: STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}>` : null, embeds: [embed], components: [row] });
      }
    } else {
      log(`Request ${r.id} has been pending 7+ days (set REVIEW_CHANNEL_ID to alert staff in Discord)`);
    }
    await at.update(K.table, r.id, { [K.f.flagged]: true });
  }
}

// ---------- invite-only campaigns + smart suggestions ----------

const isInviteKey = (k) => String(k || '').startsWith('invite-');
const inviteKey = (campaignId) => `invite-${campaignId}`;

// Proposal issue names → related creator issue names (the two lists use different words).
const ISSUE_MAP = {
  'Abortion': ['Reproductive Health', 'Maternal Health', 'Gender Justice'],
  'Electoral': ['Electoral Politics', 'Voting Rights'],
  'Criminal Justice': ['Policing', 'Policing Reform', 'Judicial Reform', 'Drug Reform'],
  'Judicial Reform': ['Criminal Justice'],
  'Housing': ['Economic Justice', 'Food Insecurity'],
  'Economic Justice': ['Food Insecurity', 'Healthcare'],
  'Anti-War': ['Anti-Imperialism', 'Foreign Policy'],
  'Anti-Imperialism': ['Anti-War', 'Foreign Policy'],
  'Anti-Red Pill': ['Gender Justice', 'LGBTQIA+', 'LGTBQIA+'],
};

function scoreCreator(campaign, creator) {
  const cf = creator.fields;
  const want = campaign.fields[C.f.issues] || [];
  const have = new Set(cf[M.f.issues] || []);
  const states = (campaign.fields[C.f.locationPref] || []).filter((s) => s !== 'No Preference');
  const needReach = Number(campaign.fields[C.f.reachNeeded]) || 0;
  const reach = Number(cf[M.f.reach]) || 0;
  const reasons = [];
  let score = 0;

  if (states.length) {
    if (!states.includes(cf[M.f.state])) return null; // location is a hard requirement when the org sets one
    score += 4;
    reasons.push(cf[M.f.state]);
  }
  const matched = [];
  for (const issue of want) {
    if (have.has(issue)) { score += 3; matched.push(issue); }
    else if ((ISSUE_MAP[issue] || []).some((r) => have.has(r))) { score += 2; matched.push(`${issue} (related)`); }
  }
  if (want.length && !matched.length) return null; // shares none of the campaign's issues
  if (matched.length) reasons.push(`issues: ${matched.join(', ')}`);
  if (needReach) {
    if (reach >= needReach) score += 2;
    else if (reach >= needReach / 2) score += 0.5;
    else score -= 1;
  }
  if (reach) reasons.push(`${reach.toLocaleString('en-US')} followers`);
  score += Math.log10(reach + 1) * 0.2; // small tie-breaker for reach
  if (cf[M.f.signedCoc]) { score += 1; reasons.push('signed Code of Conduct'); }
  if (isSnowflake(cf[M.f.discordUserId])) score += 1.5;
  else reasons.push('not linked on Discord yet');
  return { score, reasons };
}

async function computeSuggestions(rec) {
  const f = rec.fields;
  const creators = await at.list(M.table, {
    formula: `{${M.names.approved}}`,
    fields: [M.f.fullName, M.f.issues, M.f.state, M.f.reach, M.f.signedCoc, M.f.discordUserId],
  });
  const exclude = new Set([...(f[C.f.invited] || [])]);
  const needed = Number(f[C.f.creatorsNeeded]) || 0;
  const limit = Math.min(25, Math.max(10, needed * 2));
  const ranked = creators
    .filter((c) => !exclude.has(c.id))
    .map((c) => ({ c, s: scoreCreator(rec, c) }))
    .filter((x) => x.s && x.s.score > 0)
    .sort((a, b) => b.s.score - a.s.score)
    .slice(0, limit);
  const notes = ranked.length
    ? ranked.map((x, i) => `${i + 1}. ${x.c.fields[M.f.fullName] || 'Creator'}: ${x.s.reasons.join(' · ')}`).join('\n')
    : 'No approved creators matched this campaign’s issues and location. Try widening the location or issues, then check Refresh Suggestions.';
  await at.update(C.table, rec.id, {
    [C.f.suggested]: ranked.map((x) => x.c.id),
    [C.f.suggestionNotes]: `Updated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}. Best matches first:\n${notes}`,
    [C.f.refreshSuggestions]: false,
  });
  log(`Suggested ${ranked.length} creators for ${rec.id}`);
  if (ranked.length && !f[C.f.refreshSuggestions]) {
    const campName = f[C.f.shortName] || 'your campaign';
    const msg = `✨ We found **${ranked.length} suggested creators** for **${campName}**. Pick who to invite with \`/invite\` in Discord or on your partner page.`;
    notifyOrg(f, { dmText: msg, subject: `Suggested creators for ${campName}`, body: msg.replace(/\*\*/g, '').replace(/`/g, ''), always: true }).catch((err) => log('notify error', err));
  }
}

function inviteRow(rowId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`iv:a:${rowId}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`iv:d:${rowId}`).setLabel('No thanks').setStyle(ButtonStyle.Secondary)
  );
}

async function sendInviteDM(discordUserId, rowId, campaignFields, { reminder = false } = {}) {
  try {
    const u = await client.users.fetch(discordUserId);
    const e = buildEmbed(campaignFields, { invite: true }).setAuthor({ name: reminder ? '⏰  REMINDER: YOUR INVITATION IS WAITING' : '✉️  YOU’RE INVITED' });
    await u.send({ embeds: [e], components: [inviteRow(rowId)] });
    return true;
  } catch {
    return false;
  }
}

async function staffNote(content) {
  if (!REVIEW_CHANNEL_ID) return log(content);
  const ch = await client.channels.fetch(REVIEW_CHANNEL_ID).catch(() => null);
  await ch?.send(content).catch(() => {});
}

// Creates an "Invited" row for each creator in Invited Creators who doesn't have one yet, and DMs them.
async function sendInvites(rec) {
  const f = rec.fields;
  const key = f[C.f.discordMessageId] || inviteKey(rec.id);
  if (!f[C.f.discordMessageId]) {
    await at.update(C.table, rec.id, { [C.f.discordMessageId]: key, [C.f.discordClosed]: false });
    rec.fields[C.f.discordMessageId] = key;
  }
  const invitedIds = f[C.f.invited] || [];
  if (!invitedIds.length) return;
  const existing = await at.list(K.table, { formula: `{${K.names.discordMessageId}}=${at.q(key)}`, fields: [K.f.creator] });
  const already = new Set(existing.flatMap((r) => r.fields[K.f.creator] || []));
  const fresh = invitedIds.filter((id) => !already.has(id));
  if (!fresh.length) return;
  const creators = await listByIds(M.table, fresh, CREATOR_CONTACT_FIELDS());
  const name = f[C.f.shortName] || 'Campaign';
  const unreachable = [];
  for (const c of creators) {
    const did = c.fields[M.f.discordUserId];
    const row = await at.create(K.table, {
      [K.f.title]: `${c.fields[M.f.fullName] || 'Creator'} → ${name}`,
      [K.f.campaign]: [rec.id],
      [K.f.creator]: [c.id],
      [K.f.status]: 'Invited',
      [K.f.requestedAt]: now(),
      [K.f.discordUserId]: isSnowflake(did) ? did : '',
      [K.f.discordMessageId]: key,
      [K.f.joinedVia]: 'Invitation',
    });
    const dmOk = isSnowflake(did) && (await sendInviteDM(did, row.id, f));
    const emailOk = (!dmOk || wantsEmail(c.fields)) && (await emailInvite(c, f));
    if (!dmOk && !emailOk) unreachable.push(c.fields[M.f.fullName] || c.id);
  }
  log(`Invited ${creators.length} creator(s) to ${name}`);
  if (unreachable.length) {
    await staffNote(
      `✉️ **${name}**: couldn't DM ${unreachable.length} invited creator(s): ${unreachable.join(', ')}. ` +
        'They have no Discord link (or DMs closed) and no email on file, or email is turned off. Their invitation is saved: add an email to their Creator Applications record, or reach out directly.'
    );
  }
}

async function handleInviteButton(interaction) {
  const [, action, rowId] = interaction.customId.split(':');
  const row = await at.first(K.table, { formula: `RECORD_ID()=${at.q(rowId)}`, fields: [K.f.status, K.f.discordUserId, K.f.campaign, K.f.discordMessageId, K.f.creator] });
  if (!row) return interaction.reply({ content: 'This invitation no longer exists.', flags: MessageFlags.Ephemeral });
  if (row.fields[K.f.discordUserId] !== interaction.user.id) return interaction.reply({ content: 'This invitation is for someone else.', flags: MessageFlags.Ephemeral });
  const campaignId = (row.fields[K.f.campaign] || [])[0];
  const camp = await at.first(C.table, { formula: `RECORD_ID()=${at.q(campaignId)}`, fields: [C.f.shortName, C.f.status, C.f.orgLinks] });
  const name = camp?.fields[C.f.shortName] || 'the campaign';
  if (row.fields[K.f.status] !== 'Invited') {
    await interaction.update({ components: [] }).catch(() => {});
    return interaction.followUp({ content: `You've already responded to this invitation.`, flags: MessageFlags.Ephemeral });
  }
  if (camp?.fields[C.f.status] !== C.ACTIVE) {
    await interaction.update({ components: [] }).catch(() => {});
    return interaction.followUp({ content: `**${name}** has closed, so this invitation has expired.`, flags: MessageFlags.Ephemeral });
  }
  const accept = action === 'a';
  await at.update(K.table, row.id, {
    [K.f.status]: accept ? 'Committed' : 'Declined invite',
    ...(accept ? { [K.f.committedAt]: now() } : {}),
    [K.f.reviewedAt]: now(),
  });
  scheduleRefresh(row.fields[K.f.discordMessageId], campaignId);
  log(`Invite ${row.id} ${accept ? 'accepted' : 'declined'}`);
  if (accept) {
    campaignFieldsById(campaignId)
      .then((campFields) => announceConfirmed({ campFields, creatorId: first1(row.fields[K.f.creator]), user: interaction.user, headline: `🎉 You've accepted, and you're confirmed for **${name}**!` }))
      .catch((err) => log('announce error', err));
  }
  const base = interaction.message.embeds[0] ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setTitle(name);
  base
    .setAuthor({ name: accept ? '✅  YOU’RE IN' : '👋  NO THANKS SENT' })
    .setColor(accept ? 0x2ecc71 : 0x4f545c)
    .setFooter({
      text: accept
        ? `Confirmed! We've DMed you your contact and payment details.${hasThread(camp?.fields) ? ' You’ll be added to the campaign’s private thread in a moment.' : ''}`
        : 'Thanks for letting us know. This won’t affect future invitations.',
    });
  return interaction.update({ embeds: [base], components: [] });
}

// Org (or staff) picks from the bot's suggestions in Discord.
// ---- creator directory (orgs browse and invite anyone, not just suggestions) ----
// Profile only, never contact info: email appears only after a creator accepts.
let creatorDir = { at: 0, list: [] };
async function creatorDirectory() {
  if (Date.now() - creatorDir.at < 10 * 60_000 && creatorDir.list.length) return creatorDir.list;
  const rows = await at.list(M.table, {
    formula: `{${M.names.approved}}`,
    fields: [M.f.fullName, M.f.reach, M.f.tiktok, M.f.instagram, M.f.youtube, M.f.issues, M.f.about, M.f.state],
  });
  creatorDir = { at: Date.now(), list: rows.filter((r) => String(r.fields[M.f.fullName] || '').trim()) };
  return creatorDir.list;
}
function searchCreators(list, { q = '', issue = '', state = '', min = 0 } = {}) {
  const needle = String(q).trim().toLowerCase();
  const handles = (f) => [f[M.f.tiktok], f[M.f.instagram], f[M.f.youtube]].filter(Boolean).join(' ').toLowerCase();
  return list
    .filter((c) => {
      const f = c.fields;
      if (needle && !String(f[M.f.fullName] || '').toLowerCase().includes(needle) && !handles(f).includes(needle)) return false;
      if (issue && !(f[M.f.issues] || []).includes(issue)) return false;
      if (state && f[M.f.state] !== state) return false;
      if (min && !(Number(f[M.f.reach]) >= min)) return false;
      return true;
    })
    .sort((a, b) => (Number(b.fields[M.f.reach]) || 0) - (Number(a.fields[M.f.reach]) || 0));
}
const reachShort = (n) => (!Number(n) ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

// Who may search the directory in Discord (cached so autocomplete answers in time).
const searchAccess = new Map();
async function canSearchCreators(userId) {
  const hit = searchAccess.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ok;
  const ok = (await isStaff(userId)) || (await findOrgsByDiscordId(userId)).length > 0;
  searchAccess.set(userId, { ok, at: Date.now() });
  return ok;
}

async function handleInviteAutocomplete(interaction) {
  const focused = interaction.options.getFocused();
  if (!(await canSearchCreators(interaction.user.id))) return interaction.respond([]);
  const list = await creatorDirectory();
  const results = searchCreators(list, { q: focused }).slice(0, 25);
  return interaction.respond(
    results.map((c) => {
      const f = c.fields;
      const label = [f[M.f.fullName], f[M.f.state], reachShort(Number(f[M.f.reach])) && `${reachShort(Number(f[M.f.reach]))} followers`].filter(Boolean).join(' · ');
      return { name: label.slice(0, 100), value: c.id };
    })
  );
}

async function handleInviteCommand(interaction) {
  const staff = await isStaff(interaction.user.id);
  const orgs = await findOrgsByDiscordId(interaction.user.id);
  if (!staff && !orgs.length) {
    return interaction.editReply("This command is for partner organizations. Run `/link` with your organization's application email first.");
  }
  let campaigns;
  const fields = [C.f.shortName, C.f.status, C.f.joinMode, C.f.suggested, C.f.invited, C.f.suggestionNotes, C.f.postToDiscord];
  if (staff) {
    campaigns = await at.list(C.table, { formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.joinMode}}="Invite-only")`, fields });
  } else {
    const ids = [...new Set(orgs.flatMap((o) => o.fields[O.f.proposals] || []))];
    campaigns = (ids.length ? await listByIds(C.table, ids, fields) : []).filter(
      (p) => p.fields[C.f.status] === C.ACTIVE && p.fields[C.f.joinMode] === 'Invite-only'
    );
  }
  if (!campaigns.length) return interaction.editReply('You don’t have any active invite-only campaigns. Ask the Creator Congress team to set one up.');

  // Picked a specific creator from the search box
  const chosen = interaction.options.getString('creator');
  if (chosen) {
    if (!/^rec[A-Za-z0-9]{14}$/.test(chosen)) return interaction.editReply('Pick a creator from the list that appears as you type their name.');
    const c = (await listByIds(M.table, [chosen], [M.f.fullName, M.f.reach, M.f.tiktok, M.f.instagram, M.f.youtube, M.f.issues, M.f.about, M.f.state, M.f.approved]))[0];
    if (!c || !c.fields[M.f.approved]) return interaction.editReply('That creator isn’t in the approved Creator Congress network.');
    const nm = c.fields[M.f.fullName] || 'Creator';
    const { embed } = buildReviewCard({ req: { id: c.id, fields: { [K.f.discordUsername]: nm } }, camp: campaigns[0], creator: c }, { banner: '🔎  CREATOR YOU PICKED' });
    embed.setTitle(nm.slice(0, 256)).setColor(0x9b59b6).setFooter({ text: 'Choose which campaign to invite them to.' });
    const open = campaigns.filter((p) => !(p.fields[C.f.invited] || []).includes(c.id));
    if (!open.length) return interaction.editReply({ content: `**${nm}** is already invited to all of your invite-only campaigns.`, embeds: [embed] });
    const rows = [];
    for (let i = 0; i < open.slice(0, 20).length; i += 4) {
      rows.push(
        new ActionRowBuilder().addComponents(
          open.slice(i, i + 4).map((p) =>
            new ButtonBuilder().setCustomId(`sg:i:${p.id}:${c.id}`).setLabel(`Invite to ${p.fields[C.f.shortName] || 'campaign'}`.slice(0, 80)).setStyle(ButtonStyle.Primary).setEmoji('✉️')
          )
        )
      );
    }
    return interaction.editReply({ embeds: [embed], components: rows.slice(0, 5) });
  }

  const picks = [];
  for (const p of campaigns) {
    const invited = new Set(p.fields[C.f.invited] || []);
    for (const id of p.fields[C.f.suggested] || []) if (!invited.has(id)) picks.push({ p, id });
  }
  if (!picks.length) {
    const names = campaigns.map((p) => `**${p.fields[C.f.shortName]}** (${(p.fields[C.f.invited] || []).length} invited)`).join(', ');
    return interaction.editReply(`No new suggestions right now for ${names}. To invite someone specific, run \`/invite creator:\` and start typing their name. Use \`/roster\` to see who has responded.`);
  }
  const shown = picks.slice(0, 5);
  const creators = await listByIds(M.table, [...new Set(shown.map((x) => x.id))], [M.f.fullName, M.f.reach, M.f.tiktok, M.f.instagram, M.f.youtube, M.f.issues, M.f.about, M.f.state]);
  const byId = new Map(creators.map((c) => [c.id, c]));
  const embeds = [];
  const components = [];
  for (const { p, id } of shown) {
    const c = byId.get(id);
    if (!c) continue;
    const nm = c.fields[M.f.fullName] || 'Creator';
    const why = String(p.fields[C.f.suggestionNotes] || '').split('\n').find((l) => l.includes(`${nm}:`));
    const { embed } = buildReviewCard({ req: { id, fields: { [K.f.discordUsername]: nm } }, camp: p, creator: c }, { banner: '💡  SUGGESTED CREATOR' });
    embed
      .setTitle(`${nm} for ${p.fields[C.f.shortName]}`.slice(0, 256))
      .setColor(0x9b59b6)
      .setFooter({ text: why ? `Why: ${why.replace(/^\d+\.\s*[^:]+:\s*/, '')}`.slice(0, 2000) : 'Suggested by issues, location and reach' });
    embeds.push(embed);
    const first = nm.split(' ')[0].slice(0, 30);
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sg:i:${p.id}:${id}`).setLabel(`Invite ${first}`).setStyle(ButtonStyle.Primary).setEmoji('✉️'),
        new ButtonBuilder().setCustomId(`sg:s:${p.id}:${id}`).setLabel('Skip').setStyle(ButtonStyle.Secondary)
      )
    );
  }
  return interaction.editReply({
    content: `**${picks.length}** suggested creator${picks.length === 1 ? '' : 's'} to consider, best matches first.${picks.length > 5 ? ' Showing 5. Run `/invite` again for more.' : ''}\nWant someone else? Run \`/invite creator:\` and start typing their name.`,
    embeds,
    components,
  });
}

async function handleSuggestionButton(interaction) {
  const [, action, propId, creatorId] = interaction.customId.split(':');
  const p = await at.first(C.table, { formula: `RECORD_ID()=${at.q(propId)}`, fields: [C.f.shortName, C.f.orgLinks, C.f.suggested, C.f.invited, C.f.postToDiscord] });
  if (!p) return interaction.reply({ content: 'That campaign no longer exists.', flags: MessageFlags.Ephemeral });
  const allowed = (await orgContactIds(p.fields[C.f.orgLinks])).includes(interaction.user.id) || (await isStaff(interaction.user.id));
  if (!allowed) return interaction.reply({ content: "You're not able to invite creators to this campaign.", flags: MessageFlags.Ephemeral });
  const invite = action === 'i';
  const suggested = (p.fields[C.f.suggested] || []).filter((x) => x !== creatorId);
  const invited = new Set(p.fields[C.f.invited] || []);
  if (invite) invited.add(creatorId);
  await at.update(C.table, p.id, { [C.f.suggested]: suggested, [C.f.invited]: [...invited] });
  const who = interaction.user.globalName || interaction.user.username;
  const done = EmbedBuilder.from(interaction.message.embeds[0])
    .setAuthor({ name: invite ? `✉️  INVITED by ${who}` : `⏭️  SKIPPED by ${who}` })
    .setColor(invite ? 0x2ecc71 : 0x4f545c)
    .setFooter({
      text: invite
        ? p.fields[C.f.postToDiscord]
          ? 'Their invitation goes out within 2 minutes.'
          : 'They’ll be invited as soon as the campaign goes live.'
        : 'Removed from suggestions.',
    });
  log(`${invite ? 'Invited' : 'Skipped'} ${creatorId} for ${p.id} by ${who}`);
  return interaction.update({ embeds: [done], components: [] });
}

// One source of truth: fold the older checkboxes into "How creators join" when it's blank.
async function normalizeJoinModes() {
  const rows = await at.list(C.table, {
    formula: `AND({${C.names.joinMode}}="", OR({${C.names.inviteOnlyBox}}, {${C.names.requiresApproval}}))`,
    fields: [C.f.inviteOnlyBox, C.f.requiresApproval],
  });
  for (const r of rows) {
    const mode = r.fields[C.f.inviteOnlyBox] ? 'Invite-only' : 'Partner-reviewed';
    await at.update(C.table, r.id, { [C.f.joinMode]: mode });
    log(`Set How creators join = ${mode} on ${r.id} (from older checkbox)`);
  }
}

async function syncInviteCampaigns() {
  const fields = Object.values(C.f);
  // Suggestions: new invite-only campaigns, or Refresh Suggestions checked.
  const needSuggest = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.joinMode}}="Invite-only", OR({${C.names.suggestionNotes}}="", {${C.names.refreshSuggestions}}))`,
    fields,
  });
  for (const rec of needSuggest) await computeSuggestions(rec);
  // Invitations: live invite-only campaigns with anyone new in Invited Creators.
  const live = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.joinMode}}="Invite-only", {${C.names.postToDiscord}})`,
    fields,
  });
  for (const rec of live) await sendInvites(rec);
}

// Unanswered invitations: one reminder DM after 3 days.
async function remindInvites() {
  const rows = await at.list(K.table, {
    formula: `AND({${K.names.status}}="Invited", DATETIME_DIFF(NOW(), {${K.names.requestedAt}}, 'days')>=3, NOT({${K.names.reminderSent}}))`,
    fields: [K.f.discordUserId, K.f.campaign, K.f.creator],
  });
  for (const r of rows) {
    const camp = await at.first(C.table, { formula: `RECORD_ID()=${at.q((r.fields[K.f.campaign] || [])[0])}`, fields: Object.values(C.f) });
    if (camp?.fields[C.f.status] === C.ACTIVE) {
      if (isSnowflake(r.fields[K.f.discordUserId])) await sendInviteDM(r.fields[K.f.discordUserId], r.id, camp.fields, { reminder: true });
      const cid = (r.fields[K.f.creator] || [])[0];
      const creator = cid ? await at.first(M.table, { formula: `RECORD_ID()=${at.q(cid)}`, fields: CREATOR_CONTACT_FIELDS() }) : null;
      if (creator) await emailInvite(creator, camp.fields, { reminder: true });
    }
    await at.update(K.table, r.id, { [K.f.reminderSent]: true });
  }
}

// When an invited creator links their account, attach their saved invitations and DM them.
async function deliverSavedInvites(memberId, userId) {
  const rows = await at.list(K.table, { formula: `AND({${K.names.status}}="Invited", {${K.names.discordUserId}}="")`, fields: [K.f.creator, K.f.campaign] });
  let n = 0;
  for (const r of rows.filter((x) => (x.fields[K.f.creator] || []).includes(memberId))) {
    await at.update(K.table, r.id, { [K.f.discordUserId]: userId });
    const camp = await at.first(C.table, { formula: `RECORD_ID()=${at.q((r.fields[K.f.campaign] || [])[0])}`, fields: Object.values(C.f) });
    if (camp?.fields[C.f.status] === C.ACTIVE && (await sendInviteDM(userId, r.id, camp.fields))) n++;
  }
  return n;
}

// ---------- email + personal web page (for creators who don't use Discord) ----------
// Airtable stays the single source of truth: Discord and the web page are two doors into the same rows.

const first1 = (v) => (Array.isArray(v) ? v[0] : v);

// Should this creator get emails? Auto = only if they're not linked on Discord.
function wantsEmail(cf) {
  if (!cf?.[M.f.email]) return false;
  const pref = String(cf[M.f.campaignEmails] || 'Auto');
  if (pref.startsWith('Never')) return false;
  if (pref.startsWith('Always')) return true;
  return !isSnowflake(cf[M.f.discordUserId]);
}

async function queueEmail({ creator, subject, body, kind }) {
  const cf = creator.fields;
  if (!wantsEmail(cf)) return false;
  await at.create(OUTBOX.table, {
    [OUTBOX.f.subject]: subject.slice(0, 250),
    [OUTBOX.f.to]: cf[M.f.email],
    [OUTBOX.f.body]: body,
    [OUTBOX.f.kind]: kind,
    [OUTBOX.f.creator]: [creator.id],
  });
  log(`Queued ${kind} email for ${creator.id}`);
  return true;
}

const CREATOR_CONTACT_FIELDS = () => [M.f.fullName, M.f.firstName, M.f.email, M.f.discordUserId, M.f.campaignEmails, M.f.pageLink];

// Emails link to the logged-in portal if PORTAL_URL is set, otherwise to the creator's private page.
function pageLine(cf) {
  if (PORTAL_URL) return `\n\n[Log in to the Creator Congress portal](${PORTAL_URL})`;
  return cf[M.f.pageLink] ? `\n\n[Open your Creator Congress campaigns page](${cf[M.f.pageLink]})` : '';
}
const hi = (cf) => `Hi ${cf[M.f.firstName] || String(cf[M.f.fullName] || '').split(' ')[0] || 'there'},`;

// ---- org lead contact + payment details (shown to confirmed creators only) ----
// The org lead handles the work and payment. Lead Contact Name/Email on the proposal win;
// otherwise we use the contact on the org's application.
function leadContact(f) {
  const firstOf = (v) => String((Array.isArray(v) ? v.find(Boolean) : v) || '').trim();
  const name = String(f[C.f.leadName] || '').trim() || `${firstOf(f[C.f.orgFirst])} ${firstOf(f[C.f.orgLast])}`.trim();
  const email = String(f[C.f.leadEmail] || '').trim() || firstOf(f[C.f.orgEmail]);
  const org = (f[C.f.orgName] || []).filter(Boolean).join(', ');
  const payment = String(f[C.f.paymentDetails] || '').trim();
  return { name, email, org, payment };
}

async function campaignFieldsById(id) {
  if (!id) return null;
  const r = await at.first(C.table, { formula: `RECORD_ID()=${at.q(id)}`, fields: Object.values(C.f) });
  return r?.fields || null;
}

// Markdown block for Discord DMs and emails.
function contactMd(f, { email = false } = {}) {
  const { name, email: addr, org, payment } = leadContact(f);
  const who = [name || null, org && org !== name ? org : null].filter(Boolean).join(', ');
  const camp = f[C.f.shortName] || 'Creator Congress campaign';
  const mail = addr ? (email ? `[${addr}](mailto:${addr}?subject=${encodeURIComponent(camp)})` : addr) : '';
  const lines = [];
  if (who || mail) lines.push(`**Your contact:** ${[who, mail].filter(Boolean).join(' · ')}\nReach out to them with questions about the work and about getting paid.`);
  else lines.push('**Your contact:** the Creator Congress team will connect you with the partner lead.');
  if (payment) lines.push(`**Getting paid:**\n${payment.length > 1500 ? payment.slice(0, 1500) + '…' : payment}`);
  else if (who || mail) lines.push(`**Getting paid:** payment details haven't been posted yet. Ask ${name || 'your contact'} if you have questions.`);
  return lines.join('\n\n');
}

// Tiny, safe markdown → HTML for the Payment Details rich text (bold, italic, links, lists, headings).
function mdToHtml(md) {
  const inline = (t) =>
    esc(t)
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, txt, url) => `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`)
      .replace(/(^|[\s(])((?:https?:\/\/)[^\s<]+[^\s<.,;:!?)])/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/))) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
      close(); out.push(`<p><b>${inline(m[1])}</b></p>`);
    } else if (!line.trim()) {
      close();
    } else {
      close(); out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join('');
}

// HTML block for the creator's campaigns page.
function contactHtml(f) {
  const { name, email, org, payment } = leadContact(f);
  const camp = f[C.f.shortName] || 'Creator Congress campaign';
  const who = name || org || 'the partner lead';
  const mailto = email ? `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(camp)}` : '';
  const person = name || email
    ? `<p class="who"><b>${esc(name || email)}</b>${org && org !== name ? ` · ${esc(org)}` : ''}</p>
       <p class="muted">Your point of contact for the work and for getting paid.</p>
       ${email ? `<div class="actions"><a class="btn primary" href="${esc(mailto)}">✉️ Email ${esc(name ? name.split(' ')[0] : 'them')}</a><span class="muted">${esc(email)}</span></div>` : ''}`
    : `<p class="muted">The Creator Congress team will connect you with the partner lead.</p>`;
  const pay = payment
    ? `<div class="md">${mdToHtml(payment)}</div>`
    : `<p class="muted">Payment details haven't been posted yet.${email ? ` Questions about payment? Email ${esc(who)}.` : ''}</p>`;
  return `<div class="contact"><div class="contact-h">🤝 Your contact</div>${person}<div class="contact-h">💸 Getting paid</div>${pay}</div>`;
}

// Tell a creator they're confirmed, with their contact + payment details (DM if on Discord, email per their setting).
async function announceConfirmed({ campFields, creatorId, discordUserId, user, headline, extra = '' }) {
  if (!campFields) return;
  const name = campFields[C.f.shortName] || 'the campaign';
  const channelNote = hasThread(campFields) ? ' You’ll be added to the campaign’s private thread in the partner’s channel in a moment.' : '';
  const target = user || (isSnowflake(discordUserId) ? await client.users.fetch(discordUserId).catch(() => null) : null);
  if (target) await dm(target, `${headline || `🎉 You're in! You've been confirmed for **${name}**.`}${channelNote}\n\n${contactMd(campFields)}${extra}`);
  if (creatorId) {
    const contact = await at.first(M.table, { formula: `RECORD_ID()=${at.q(creatorId)}`, fields: CREATOR_CONTACT_FIELDS() });
    if (contact) await emailDecision(contact, campFields, true).catch((err) => log('email error', err));
  }
}

function campaignSummaryMd(f) {
  const bits = [
    f[C.f.creatorPay] ? `**Pay:** ${money(Number(f[C.f.creatorPay]))}` : null,
    f[C.f.startDate] || f[C.f.endDate] ? `**Dates:** ${[fmtDate(f[C.f.startDate]), fmtDate(f[C.f.endDate])].filter(Boolean).join(' to ')}` : null,
    (f[C.f.orgName] || []).length ? `**With:** ${(f[C.f.orgName] || []).join(', ')}` : null,
  ].filter(Boolean);
  const details = String(f[C.f.details] || '').trim();
  return `**${f[C.f.shortName] || 'Campaign'}**\n\n${bits.join('\n')}${details ? `\n\n${details.slice(0, 1200)}${details.length > 1200 ? '…' : ''}` : ''}`;
}

async function emailInvite(creator, campaignFields, { reminder = false } = {}) {
  const cf = creator.fields;
  return queueEmail({
    creator,
    kind: reminder ? 'Reminder' : 'Invitation',
    subject: `${reminder ? 'Reminder: ' : ''}You're invited: ${campaignFields[C.f.shortName] || 'a Creator Congress campaign'}`,
    body:
      `${hi(cf)}\n\nYou've been personally invited to a Creator Congress campaign:\n\n${campaignSummaryMd(campaignFields)}` +
      `\n\nAccept or pass on your campaigns page. It takes one click.${pageLine(cf)}\n\nQuestions? Just reply to the Creator Congress team.`,
  });
}

async function emailDecision(creator, campFields, approved) {
  const cf = creator.fields;
  const campaignName = campFields[C.f.shortName] || 'the campaign';
  const longTerm = hasThread(campFields);
  return queueEmail({
    creator,
    kind: approved ? 'Confirmed' : 'Not selected',
    subject: approved ? `You're in: ${campaignName}` : `Update on ${campaignName}`,
    body: approved
      ? `${hi(cf)}\n\nGood news: you've been confirmed for **${campaignName}**!\n\n${contactMd(campFields, { email: true })}` +
        (longTerm ? '\n\nThis campaign coordinates in a private Discord thread in the partner’s channel. If you’re not on Discord, the team will help you get set up or keep you updated by email.' : '') +
        pageLine(cf)
      : `${hi(cf)}\n\nThanks so much for your interest in **${campaignName}**. The partner wasn't able to bring you on for this one, but that's no reflection on your work. Partners often have very specific needs for each campaign.\n\nThere are always more opportunities coming. We'd love to see you on the next one!` +
        pageLine(cf),
  });
}

// Every approved creator gets a private page token + link (needs PUBLIC_URL).
// PUBLIC_URL with https:// added if it was entered without it.
const publicBase = () => {
  const u = String(PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return !u ? '' : /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

async function ensurePortalTokens() {
  if (!PUBLIC_URL) return;
  // Repair any links saved without https:// (they don't open when clicked).
  const broken = await at.list(M.table, {
    formula: `AND({${M.names.portalToken}}!="", {Campaigns Page Link}!="", LEFT({Campaigns Page Link}, 4)!="http")`,
    fields: [M.f.portalToken],
    maxRecords: 100,
  });
  for (const r of broken) await at.update(M.table, r.id, { [M.f.pageLink]: `${publicBase()}/c/${r.fields[M.f.portalToken]}` });
  if (broken.length) log(`Repaired ${broken.length} campaigns-page link(s) missing https://`);
  const rows = await at.list(M.table, {
    formula: `AND({${M.names.approved}}, {${M.names.portalToken}}="")`,
    fields: CREATOR_CONTACT_FIELDS(),
    maxRecords: 50,
  });
  for (const r of rows) {
    const token = randomBytes(16).toString('hex');
    const link = `${publicBase()}/c/${token}`;
    await at.update(M.table, r.id, { [M.f.portalToken]: token, [M.f.pageLink]: link });
    // Optional one-time welcome email with their link (set SEND_WELCOME_EMAILS=1 in Railway to turn on).
    if (process.env.SEND_WELCOME_EMAILS === '1') {
      r.fields[M.f.pageLink] = link;
      await queueEmail({
        creator: r,
        kind: 'Welcome',
        subject: 'Your Creator Congress campaigns page',
        body:
          `${hi(r.fields)}\n\nCreator Congress campaigns are now in one place. On your personal page you can:\n\n` +
          `* **Join open campaigns** in one click\n* **Accept invitations** from partners who hand-pick creators\n* **See your campaigns and expected pay**\n\n` +
          `[Open your campaigns page](${link})\n\nBookmark it: the link is private to you, so please don't share it. ` +
          `We'll email you when you're invited to something, plus a short weekly roundup of open campaigns.\n\n` +
          `Prefer Discord? Join our server and type /link with this email, and you can do all of this there instead.`,
      });
    }
  }
  if (rows.length) log(`Issued campaigns-page links to ${rows.length} creator(s)`);
}

// Weekly digest of open campaigns for email creators: Mondays from 10am ET, once a week.
async function maybeSendWeeklyDigest() {
  const nowEt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  if (nowEt.getDay() !== 1 || nowEt.getHours() < 10) return;
  const recent = await at.first(OUTBOX.table, {
    formula: `AND({${OUTBOX.names.kind}}="Weekly digest", DATETIME_DIFF(NOW(), CREATED_TIME(), 'days')<6)`,
    fields: [OUTBOX.f.subject],
  });
  if (recent) return;
  const open = (await listOpenCampaigns()).filter((p) => !isFull(p.fields));
  if (!open.length) return;
  const creators = await at.list(M.table, { formula: `AND({${M.names.approved}}, {Email}!="")`, fields: CREATOR_CONTACT_FIELDS() });
  const list = open
    .slice(0, 12)
    .map((p) => {
      const f = p.fields;
      const meta = [f[C.f.creatorPay] ? money(Number(f[C.f.creatorPay])) : null, (f[C.f.orgName] || [])[0], f[C.f.endDate] ? `ends ${fmtDate(f[C.f.endDate])}` : null].filter(Boolean);
      return `* **${f[C.f.shortName]}**${meta.length ? `: ${meta.join(' · ')}` : ''}${modeOf(f) === 'review' ? ' _(partner-reviewed)_' : ''}`;
    })
    .join('\n');
  let n = 0;
  for (const c of creators) {
    if (!wantsEmail(c.fields) || (!PORTAL_URL && !c.fields[M.f.pageLink])) continue;
    await queueEmail({
      creator: c,
      kind: 'Weekly digest',
      subject: `${open.length} open Creator Congress campaign${open.length === 1 ? '' : 's'} this week`,
      body: `${hi(c.fields)}\n\nHere's what's open right now:\n\n${list}\n\nJoin any of them in one click on your campaigns page.${pageLine(c.fields)}\n\n_To stop these emails, reply and let us know._`,
    });
    n++;
  }
  log(`Weekly digest queued for ${n} creator(s)`);
}

const isFull = (f) => {
  const needed = Number(f[C.f.creatorsNeeded]) || 0;
  return modeOf(f) === 'open' && needed > 0 && (Number(f[C.f.signups]) || 0) >= needed;
};

async function listOpenCampaigns() {
  const rows = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.postToDiscord}}, {${C.names.discordMessageId}}!="", {${C.names.joinMode}}!="Invite-only")`,
    fields: Object.values(C.f),
  });
  return rows.filter((r) => !isInviteKey(r.fields[C.f.discordMessageId]));
}

// ---- actions shared by the web page ----

async function webJoin(creator, camp, mine, via = 'Web page') {
  const key = camp.fields[C.f.discordMessageId];
  const existing = mine.find((r) => r.fields[K.f.discordMessageId] === key);
  const status = existing?.fields[K.f.status];
  if (status === 'Declined') return 'declined';
  if (status === 'Committed' || status === 'Pending') return 'already';
  if (isFull(camp.fields)) return 'full';
  const pending = modeOf(camp.fields) === 'review';
  const did = creator.fields[M.f.discordUserId];
  const fields = {
    [K.f.title]: `${creator.fields[M.f.fullName] || 'Creator'} → ${camp.fields[C.f.shortName] || 'Campaign'}`,
    [K.f.campaign]: [camp.id],
    [K.f.creator]: [creator.id],
    [K.f.status]: pending ? 'Pending' : 'Committed',
    [K.f.committedAt]: pending ? null : now(),
    [K.f.requestedAt]: now(),
    [K.f.reviewedBy]: null,
    [K.f.reviewedAt]: null,
    [K.f.reminderSent]: false,
    [K.f.flagged]: false,
    [K.f.withdrawnAt]: null,
    [K.f.discordUserId]: isSnowflake(did) ? did : '',
    [K.f.discordUsername]: '',
    [K.f.discordMessageId]: key,
    [K.f.joinedVia]: via,
  };
  const row = existing ? await at.update(K.table, existing.id, fields) : await at.create(K.table, fields);
  log(`Web ${pending ? 'request' : 'join'}: ${creator.id} → ${camp.id}`);
  if (pending) notifyReviewers(row.id).catch((err) => log('notifyReviewers error', err));
  else {
    scheduleRefresh(key, camp.id);
    announceConfirmed({ campFields: camp.fields, creatorId: creator.id, discordUserId: did, headline: `✅ You're signed up for **${camp.fields[C.f.shortName] || 'the campaign'}**!` }).catch((err) => log('announce error', err));
  }
  return pending ? 'requested' : 'joined';
}

async function webLeave(creator, camp, mine) {
  const key = camp.fields[C.f.discordMessageId];
  const existing = mine.find((r) => r.fields[K.f.discordMessageId] === key && ['Committed', 'Pending'].includes(r.fields[K.f.status]));
  if (!existing) return 'none';
  await at.update(K.table, existing.id, { [K.f.status]: 'Withdrawn', [K.f.withdrawnAt]: now() });
  // If they'd also reacted in Discord, remove the reaction so the two stay in sync.
  const did = existing.fields[K.f.discordUserId];
  if (isSnowflake(did) && !isInviteKey(key)) {
    try {
      const ch = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
      const msg = await ch.messages.fetch(key);
      await msg.reactions.cache.find((r) => r.emoji.name === SIGNUP_EMOJI)?.users.remove(did);
    } catch {
      /* ignore */
    }
  }
  scheduleRefresh(key, camp.id);
  return 'left';
}

// Accept / pass on an invitation (shared by Discord buttons and the web page).
async function respondToInvite(rowId, accept) {
  const row = await at.first(K.table, { formula: `RECORD_ID()=${at.q(rowId)}`, fields: [K.f.status, K.f.campaign, K.f.discordMessageId, K.f.creator, K.f.discordUserId] });
  if (!row) return { result: 'missing' };
  const campaignId = first1(row.fields[K.f.campaign]);
  const camp = await at.first(C.table, { formula: `RECORD_ID()=${at.q(campaignId)}`, fields: [C.f.shortName, C.f.status, C.f.orgLinks] });
  if (row.fields[K.f.status] !== 'Invited') return { result: 'answered', row, camp };
  if (camp?.fields[C.f.status] !== C.ACTIVE) return { result: 'closed', row, camp };
  await at.update(K.table, row.id, {
    [K.f.status]: accept ? 'Committed' : 'Declined invite',
    ...(accept ? { [K.f.committedAt]: now() } : {}),
    [K.f.reviewedAt]: now(),
  });
  scheduleRefresh(row.fields[K.f.discordMessageId], campaignId);
  log(`Invite ${row.id} ${accept ? 'accepted' : 'declined'}`);
  if (accept) {
    campaignFieldsById(campaignId)
      .then((campFields) => announceConfirmed({ campFields, creatorId: first1(row.fields[K.f.creator]), discordUserId: row.fields[K.f.discordUserId], headline: `🎉 You've accepted, and you're confirmed for **${camp.fields[C.f.shortName] || 'the campaign'}**!` }))
      .catch((err) => log('announce error', err));
  }
  return { result: accept ? 'accepted' : 'passed', row, camp };
}

// ---- the page ----

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Branding (override in Railway: LOGO_URL, BRAND_PINK, BRAND_ORANGE)
const LOGO_URL = process.env.LOGO_URL ?? 'https://images.squarespace-cdn.com/content/v1/667725a3fbb63c107d15b61d/ccf49d96-596f-49f7-942f-aa6aaf9d681e/cclogo.png?format=500w';
const BRAND_PINK = process.env.BRAND_PINK || '#e6287e';
const BRAND_ORANGE = process.env.BRAND_ORANGE || '#ff7a1f';
const brandHtml = (label) =>
  `<div class="brand">${LOGO_URL ? `<img src="${esc(LOGO_URL)}" alt="Creator Congress" onerror="this.remove()">` : ''}<span>Creator Congress${label ? ` · ${esc(label)}` : ''}</span></div>`;

const PAGE_CSS = `
:root{--bg:#fff8f5;--card:#fff;--ink:#24151c;--muted:#6e5a63;--line:#f1dfe4;--accent:${BRAND_PINK};--accent2:${BRAND_ORANGE};--accent-ink:#fff;--soft:#fde8f1;--warn:#b4520a;--warn-soft:#fff0e2;--violet:#a2266b;--violet-soft:#fbe4f0;--ok:#1f7a4d;--ok-soft:#e8f3ec}
@media (prefers-color-scheme:dark){:root{--bg:#170f13;--card:#22161c;--ink:#f6ecef;--muted:#c0a9b3;--line:#3a2630;--accent:#ff5fa2;--accent2:#ff9a4d;--accent-ink:#1a0a11;--soft:#3a1a2a;--warn:#ffb070;--warn-soft:#3a2414;--violet:#ff8cc6;--violet-soft:#3a1a2e;--ok:#4cc38a;--ok-soft:#1f3329}}
body::before{content:"";display:block;height:6px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px 64px}
header h1{font-size:26px;margin:4px 0 2px}header p{margin:0;color:var(--muted)}
.brand{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:6px}.brand img{height:40px;width:auto;display:block}
header h1{background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat b{color:var(--accent)}.card{border-top:3px solid var(--accent)}.tag{border-color:var(--soft);background:var(--soft);color:var(--violet)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 8px}.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:14px}.stat b{font-size:18px;display:block}
h2{font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent2);margin:32px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 12px}
.card h3{margin:0 0 2px;font-size:18px}.org{color:var(--muted);font-size:14px;margin:0 0 10px}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;margin:8px 0}.meta span{white-space:nowrap}
.bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:4px 0 8px;max-width:220px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--muted)}
details{margin:6px 0 10px;font-size:14px;color:var(--muted)}details summary{cursor:pointer;color:var(--ink)}details p{white-space:pre-wrap}
.note{font-size:13px;border-radius:8px;padding:6px 10px;margin:8px 0;background:var(--warn-soft);color:var(--warn)}
.note.violet{background:var(--violet-soft);color:var(--violet)}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}form{margin:0}
button{font:inherit;font-weight:600;border-radius:8px;padding:9px 16px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{background:linear-gradient(90deg,var(--accent),var(--accent2));border-color:transparent;color:var(--accent-ink)}button:disabled{opacity:.55;cursor:default}
.pill{font-size:13px;font-weight:600;border-radius:999px;padding:4px 10px;background:var(--soft);color:var(--accent)}
.pill.wait{background:var(--warn-soft);color:var(--warn)}.pill.gray{background:var(--line);color:var(--muted)}
.flash{border-radius:10px;padding:12px 14px;margin:16px 0;background:var(--soft);color:var(--ink);border:1px solid var(--line)}
.empty{color:var(--muted);font-size:15px}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
.contact{margin:12px 0 4px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--soft)}
.contact-h{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);margin:2px 0 4px}
.contact-h:not(:first-child){margin-top:14px}.contact p{margin:4px 0}.contact .who{font-size:16px}
.muted{color:var(--muted);font-size:14px}.md{font-size:15px}.md ul,.md ol{margin:4px 0;padding-left:20px}.md a,.contact a{color:var(--accent)}
a.btn{display:inline-block;font-weight:600;border-radius:8px;padding:8px 14px;text-decoration:none;border:1px solid var(--line)}
a.btn.primary{background:linear-gradient(90deg,var(--accent),var(--accent2));border-color:transparent;color:var(--accent-ink)}
.past{padding:6px 0;border-bottom:1px solid var(--line)}.past:last-child{border-bottom:0}
.pay{margin:12px 0 4px;padding:10px 14px;border-radius:10px;border:1px solid var(--line)}.pay p{margin:4px 0}
.pay.orgsayspaid,.pay.paymentdue{background:var(--warn-soft);border-color:transparent}.pay.paid{background:var(--ok-soft);border-color:transparent}
.pay.issue{background:#fde8e8;border-color:transparent;color:#8a1f1f}
@media (prefers-color-scheme:dark){.pay.issue{background:#3a1c1c;color:#f3b0b0}}
.notpaid summary{font-size:14px;padding:8px 0}.notpaid form{display:flex;flex-direction:column;gap:8px;margin-top:6px}
textarea,input{font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card);color:var(--ink);max-width:100%}
.row{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.row-main{flex:1 1 260px;min-width:0}.row-main a{color:var(--accent);word-break:break-all}
.paystat{font-size:14px;margin-top:2px}.paystat.paid{color:var(--ok)}.paystat.issue{color:#b42318}.paystat.paymentdue{color:var(--warn)}
.findform{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.findform input{flex:1 1 180px}select{font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--card);color:var(--ink);max-width:100%}
.markpaid{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.markpaid label{font-size:14px;color:var(--muted)}.markpaid input[name=note]{flex:1 1 180px}
`;

function campaignCard(p, { mineRow, inviteRow, token }) {
  const f = p.fields;
  const name = esc(f[C.f.shortName] || 'Campaign');
  const org = (f[C.f.orgName] || []).filter(Boolean).join(', ');
  const needed = Number(f[C.f.creatorsNeeded]) || 0;
  const filled = Number(f[C.f.signups]) || 0;
  const pay = Number(f[C.f.creatorPay]) || 0;
  const dates = [fmtDate(f[C.f.startDate]), fmtDate(f[C.f.endDate])].filter(Boolean).join(' – ');
  const tags = [f[C.f.proposalType], ...(f[C.f.issues] || [])].filter(Boolean);
  const details = String(f[C.f.details] || '').trim();
  const mode = modeOf(f);
  const status = mineRow?.fields[K.f.status];
  const pct = needed ? Math.min(100, Math.round((filled / needed) * 100)) : 0;
  const action = (path, label, primary) =>
    `<form method="post" action="/c/${token}/${path}"><button${primary ? ' class="primary"' : ''}>${label}</button></form>`;

  let actions = '';
  if (inviteRow) {
    actions = action(`invite/${inviteRow.id}/accept`, 'Accept invitation', true) + action(`invite/${inviteRow.id}/decline`, 'No thanks');
  } else if (status === 'Committed') {
    actions = `<span class="pill">✓ You're in</span>` + action(`leave/${p.id}`, 'Leave campaign');
  } else if (status === 'Pending') {
    actions = `<span class="pill wait">⏳ Requested, waiting for the partner</span>` + action(`leave/${p.id}`, 'Cancel request');
  } else if (status === 'Declined') {
    actions = `<span class="pill gray">Not selected this time</span>`;
  } else if (isFull(f)) {
    actions = `<button disabled>All spots filled</button>`;
  } else {
    actions = action(`join/${p.id}`, mode === 'review' ? 'Request a spot' : 'Join campaign', true);
  }
  return `<div class="card">
  <h3>${name}</h3>${org ? `<p class="org">with ${esc(org)}</p>` : ''}
  <div class="meta"><span>💰 ${pay ? esc(money(pay)) : 'Unpaid / TBD'}</span>${dates ? `<span>📅 ${esc(dates)}</span>` : ''}<span>👥 ${needed ? `${filled} of ${needed} filled` : `${filled} signed up`}</span></div>
  ${needed ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
  ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
  ${details ? `<details><summary>Campaign details</summary><p>${esc(details)}</p></details>` : ''}
  ${mode === 'review' && !inviteRow ? `<div class="note">🙋 Partner-reviewed: ${esc(org || 'the partner')} approves each creator. You'll be emailed when you're confirmed.</div>` : ''}
  ${inviteRow ? `<div class="note violet">✉️ You were personally invited to this campaign.</div>` : ''}
  ${status === 'Committed' ? paymentHtml(mineRow, token) + contactHtml(f) : ''}
  ${hasThread(f) ? `<div class="note violet">💬 Confirmed creators join a private Discord thread with the partner. Not on Discord? The team will keep you posted by email.</div>` : ''}
  <div class="actions">${actions}</div>
</div>`;
}

const FLASH = {
  joined: "🎉 You're in! Your contact and payment details are on the campaign card below.",
  requested: "🙋 Request sent! The partner reviews each sign-up and you'll get an email once you're confirmed.",
  left: "You've left the campaign. You can rejoin anytime while it's open.",
  accepted: "🎉 You've accepted the invitation and you're confirmed! Your contact and payment details are on the campaign card below.",
  passed: "Thanks for letting us know. This won't affect future invitations.",
  already: "You're already signed up for that one.",
  declined: "The partner has already made a decision on your request for this campaign.",
  full: 'Sorry, that campaign just filled up.',
  closed: 'That campaign has closed.',
  answered: "You've already responded to that invitation.",
  confirmedpaid: "✅ Thanks for confirming you were paid! We've let the partner know.",
  reported: "Thanks for letting us know. The partner and the Creator Congress team have been alerted, and someone will follow up.",
  alreadypaid: 'That payment is already confirmed.',
  notdue: "That campaign hasn't ended yet, so payment isn't due. Questions? Email your contact on the campaign.",
};

async function renderCreatorPage(creator, token, flash) {
  const cf = creator.fields;
  const mine = (cf[M.f.commitments] || []).length
    ? await listByIds(K.table, cf[M.f.commitments], [...PAY_FIELDS(), K.f.discordMessageId])
    : [];
  const open = await listOpenCampaigns();
  const campIds = [...new Set(mine.map((r) => first1(r.fields[K.f.campaign])).filter(Boolean))];
  const allCamps = new Map(open.map((p) => [p.id, p]));
  const missing = campIds.filter((id) => !allCamps.has(id));
  if (missing.length) (await listByIds(C.table, missing, Object.values(C.f))).forEach((p) => allCamps.set(p.id, p));
  const rowFor = (p) => mine.find((r) => first1(r.fields[K.f.campaign]) === p.id && r.fields[K.f.discordMessageId] === p.fields[C.f.discordMessageId]);

  const isActive = (p) => p.fields[C.f.status] === C.ACTIVE;
  const invites = mine.filter((r) => r.fields[K.f.status] === 'Invited').map((r) => ({ r, p: allCamps.get(first1(r.fields[K.f.campaign])) })).filter((x) => x.p && isActive(x.p));
  const confirmed = mine.filter((r) => r.fields[K.f.status] === 'Committed').map((r) => ({ r, p: allCamps.get(first1(r.fields[K.f.campaign])) })).filter((x) => x.p);
  const activeMine = confirmed.filter((x) => isActive(x.p));
  const pastMine = confirmed.filter((x) => !isActive(x.p));
  const pendingMine = mine.filter((r) => r.fields[K.f.status] === 'Pending').length;
  const payOf = (x) => Number(first1(x.r.fields[K.f.campaignPay])) || 0;
  const expected = confirmed.reduce((t, x) => t + payOf(x), 0);
  const paidSoFar = confirmed.filter((x) => x.r.fields[K.f.paymentStatus] === 'Paid').reduce((t, x) => t + rowAmount(x.r), 0);
  const toConfirm = confirmed.filter((x) => isPaidCampaignRow(x.r) && ['Org says paid', 'Payment due'].includes(payStatusOf(x.r)));
  const joinedIds = new Set(activeMine.map((x) => x.p.id));
  const browse = open.filter((p) => !joinedIds.has(p.id));

  const firstName = cf[M.f.firstName] || String(cf[M.f.fullName] || '').split(' ')[0] || 'there';
  const section = (title, html) => `<h2>${title}</h2>${html}`;
  const body = `
<header>${brandHtml()}<h1>Hi ${esc(firstName)} 👋</h1><p>Your campaigns, invitations and expected pay, all in one place.</p></header>
${flash && FLASH[flash] ? `<div class="flash">${esc(FLASH[flash])}</div>` : ''}
<div class="stats">
  <div class="stat"><b>${esc(money(expected) || '$0')}</b>expected pay</div>
  <div class="stat"><b>${esc(money(paidSoFar) || '$0')}</b>paid so far</div>
  <div class="stat"><b>${activeMine.length}</b>active</div>
  ${pendingMine ? `<div class="stat"><b>${pendingMine}</b>awaiting approval</div>` : ''}
  ${invites.length ? `<div class="stat"><b>${invites.length}</b>invitation${invites.length === 1 ? '' : 's'}</div>` : ''}
</div>
${toConfirm.some((x) => payStatusOf(x.r) === 'Org says paid') ? `<div class="flash">💸 A partner says they've paid you. Please confirm below whether it arrived.</div>` : ''}
${invites.length ? section('✉️ Your invitations', invites.map((x) => campaignCard(x.p, { inviteRow: x.r, token })).join('')) : ''}
${section('Open campaigns', browse.length ? browse.map((p) => campaignCard(p, { mineRow: rowFor(p), token })).join('') : '<p class="empty">No open campaigns right now. We’ll email you when new ones are posted.</p>')}
${activeMine.length ? section('Your active campaigns', activeMine.map((x) => campaignCard(x.p, { mineRow: x.r, token })).join('')) : ''}
${pastMine.length ? section('Past campaigns', `<div class="card">${pastMine.map((x) => `<div class="past">✓ <b>${esc(x.p.fields[C.f.shortName])}</b>${payOf(x) ? ` · ${esc(money(payOf(x)))}` : ''}${paymentHtml(x.r, token)}<details><summary>Contact &amp; payment details</summary>${contactHtml(x.p.fields)}</details></div>`).join('')}</div>`) : ''}
<footer>Expected pay is an estimate based on campaign rates. "Paid so far" counts payments you've confirmed you received. This page is private to you, so please don't share the link. Prefer Discord? Join our server and use <b>/link</b> with this email. Questions? Reply to any Creator Congress email.</footer>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Your campaigns · Creator Congress</title><style>${PAGE_CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

async function creatorByToken(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  return at.first(M.table, {
    formula: `{${M.names.portalToken}}=${at.q(token)}`,
    fields: [M.f.fullName, M.f.firstName, M.f.discordUserId, M.f.email, M.f.commitments, M.f.approved],
  });
}

function startWebServer() {
  const port = Number(process.env.PORT) || 3000;
  const send = (res, code, html, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', ...headers });
    res.end(html);
  };
  const simple = (title, msg) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><div class="wrap">${brandHtml()}<h1>${esc(title)}</h1><p>${esc(msg)}</p></div></body></html>`;

  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
      // Partner (org) page
      const om = url.pathname.match(/^\/o\/([a-f0-9]{32})(?:\/paid\/(rec[A-Za-z0-9]{14})|\/review\/(rec[A-Za-z0-9]{14})\/(approve|decline)|\/(invite|skip)\/(rec[A-Za-z0-9]{14})\/(rec[A-Za-z0-9]{14})|\/invitepick\/(rec[A-Za-z0-9]{14}))?\/?$/);
      if (om) {
        let [, otoken, payRowId, reviewRowId, decision, inviteVerb, invCampId, invCreatorId, pickCreatorId] = om;
        const org = await orgByToken(otoken);
        if (!org || !org.fields[O.f.approved]) return send(res, 404, simple('Link not recognized', 'This link may have expired. Contact the Creator Congress team for a new one.'));
        if (req.method === 'POST' && pickCreatorId) {
          const form = await readForm(req);
          inviteVerb = 'invite';
          invCampId = String(form.camp || '');
          invCreatorId = pickCreatorId;
          if (!/^rec[A-Za-z0-9]{14}$/.test(invCampId)) invCampId = '';
          const dir = await creatorDirectory();
          if (!dir.some((c) => c.id === invCreatorId)) invCampId = ''; // only approved creators
        }
        if (req.method === 'POST' && (reviewRowId || inviteVerb)) {
          const ids = org.fields[O.f.proposals] || [];
          const props = ids.length ? await listByIds(C.table, ids, [C.f.commitments]) : [];
          let result = 'missing';
          const orgName = `${org.fields[O.f.organization] || 'Org'} (partner page)`;
          if (reviewRowId && props.some((p) => (p.fields[C.f.commitments] || []).includes(reviewRowId))) {
            const data = await loadRequest(reviewRowId);
            if (data?.camp && data.req.fields[K.f.status] === 'Pending') {
              await applyDecision(data.req, data.camp, decision === 'approve', orgName);
              result = decision === 'approve' ? 'approved' : 'declined';
            } else result = 'decided';
          } else if (inviteVerb && invCampId && ids.includes(invCampId)) {
            const p = await at.first(C.table, { formula: `RECORD_ID()=${at.q(invCampId)}`, fields: [C.f.suggested, C.f.invited] });
            if (p) {
              const suggested = (p.fields[C.f.suggested] || []).filter((x) => x !== invCreatorId);
              const invited = new Set(p.fields[C.f.invited] || []);
              if (inviteVerb === 'invite') invited.add(invCreatorId);
              await at.update(C.table, p.id, { [C.f.suggested]: suggested, [C.f.invited]: [...invited] });
              log(`${inviteVerb === 'invite' ? 'Invited' : 'Skipped'} ${invCreatorId} for ${p.id} via partner page`);
              result = inviteVerb === 'invite' ? 'invited' : 'skipped';
            }
          }
          res.writeHead(303, { Location: `/o/${otoken}?done=${encodeURIComponent(result)}`, 'Cache-Control': 'no-store' });
          return res.end();
        }
        if (req.method === 'POST' && payRowId) {
          const form = await readForm(req);
          const props = (org.fields[O.f.proposals] || []).length ? await listByIds(C.table, org.fields[O.f.proposals], [C.f.commitments]) : [];
          const ours = props.some((p) => (p.fields[C.f.commitments] || []).includes(payRowId));
          const result = ours ? await markPaidByOrg(payRowId, { amount: form.amount, note: form.note, by: `${org.fields[O.f.organization] || 'Org'} (partner page)` }) : 'missing';
          res.writeHead(303, { Location: `/o/${otoken}?done=${encodeURIComponent(result)}`, 'Cache-Control': 'no-store' });
          return res.end();
        }
        if (req.method !== 'GET') return send(res, 405, simple('Not allowed', ''));
        return send(res, 200, await renderOrgPage(org, otoken, url.searchParams.get('done'), { query: Object.fromEntries(url.searchParams) }));
      }
      // Creator: confirm or report a payment
      const pm = url.pathname.match(/^\/c\/([a-f0-9]{32})\/pay\/(rec[A-Za-z0-9]{14})\/(yes|no)\/?$/);
      if (pm && req.method === 'POST') {
        const [, ptoken, rowId, answer] = pm;
        const creator = await creatorByToken(ptoken);
        if (!creator || !creator.fields[M.f.approved]) return send(res, 404, simple('Link not recognized', 'This link may have expired.'));
        const form = await readForm(req);
        const result = !(creator.fields[M.f.commitments] || []).includes(rowId)
          ? 'missing'
          : answer === 'yes' ? await confirmPaidByCreator(rowId) : await reportNotPaid(rowId, { note: form.note });
        res.writeHead(303, { Location: `/c/${ptoken}?done=${encodeURIComponent(result)}`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      const m = url.pathname.match(/^\/c\/([a-f0-9]{32})(?:\/(join|leave)\/(rec[A-Za-z0-9]{14})|\/invite\/(rec[A-Za-z0-9]{14})\/(accept|decline))?\/?$/);
      if (!m) return send(res, 404, simple('Page not found', 'Check the link in your Creator Congress email.'));
      const [, token, verb, campId, inviteId, inviteAction] = m;
      const creator = await creatorByToken(token);
      if (!creator || !creator.fields[M.f.approved]) return send(res, 404, simple('Link not recognized', 'This link may have expired. Reply to any Creator Congress email and we’ll send you a new one.'));

      if (req.method === 'POST') {
        let result = 'already';
        const mine = (creator.fields[M.f.commitments] || []).length
          ? await listByIds(K.table, creator.fields[M.f.commitments], [K.f.status, K.f.campaign, K.f.discordMessageId, K.f.discordUserId])
          : [];
        if (verb) {
          const camp = await at.first(C.table, { formula: `RECORD_ID()=${at.q(campId)}`, fields: Object.values(C.f) });
          if (!camp || camp.fields[C.f.status] !== C.ACTIVE) result = 'closed';
          else if (verb === 'join') {
            if (modeOf(camp.fields) === 'invite' || !camp.fields[C.f.discordMessageId]) result = 'closed';
            else result = await webJoin(creator, camp, mine);
          } else result = await webLeave(creator, camp, mine);
        } else {
          if (!mine.some((r) => r.id === inviteId)) return send(res, 403, simple('Not your invitation', 'This invitation belongs to someone else.'));
          ({ result } = await respondToInvite(inviteId, inviteAction === 'accept'));
        }
        res.writeHead(303, { Location: `/c/${token}?done=${encodeURIComponent(result)}`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (req.method !== 'GET') return send(res, 405, simple('Not allowed', ''));
      return send(res, 200, await renderCreatorPage(creator, token, url.searchParams.get('done')));
    } catch (err) {
      log('web error', err);
      return send(res, 500, simple('Something went wrong', 'Please try again in a minute.'));
    }
  }).listen(port, () => log(`Campaigns web page listening on port ${port}${PUBLIC_URL ? ` (${PUBLIC_URL})` : ' (set PUBLIC_URL to email links)'}`));
}


// ---------- CollabPortals (or any Airtable portal): process button clicks ----------
// The portal only records what the creator wants; the bot applies the same rules as Discord and the web page.

const PORTAL_RESULT = {
  joined: ["Done", "You're in! Your contact and payment details are on My Campaigns."],
  requested: ["Done", "Request sent. The partner reviews each sign-up, and you'll be emailed once you're confirmed."],
  left: ["Done", "You've left the campaign. You can rejoin anytime while it's open."],
  accepted: ["Done", "Invitation accepted. You're confirmed! The team will follow up with next steps."],
  passed: ["Done", "Thanks for letting us know. This won't affect future invitations."],
  already: ["Done", "You're already signed up for this campaign."],
  declined: ["Couldn't complete", "The partner has already made a decision on your request for this campaign."],
  full: ["Couldn't complete", 'Sorry, this campaign is full.'],
  closed: ["Couldn't complete", 'This campaign is closed.'],
  answered: ["Couldn't complete", "You've already responded to this invitation."],
  none: ["Couldn't complete", "You're not signed up for this campaign."],
  noinvite: ["Couldn't complete", "We couldn't find an invitation for you on this campaign."],
  inviteonly: ["Couldn't complete", 'This campaign is invite-only. Watch your email and portal for invitations.'],
  nocreator: ["Couldn't complete", "We couldn't find an approved Creator Congress profile with this email. Contact the team."],
  confirmedpaid: ['Done', "Thanks for confirming you were paid! We've let the partner know."],
  reported: ['Done', 'Thanks for letting us know. The partner and the Creator Congress team have been alerted.'],
  alreadypaid: ['Done', 'This payment is already confirmed.'],
  notdue: ["Couldn't complete", "This campaign hasn't ended yet, so payment isn't due."],
  missing: ["Couldn't complete", "We couldn't find your sign-up for this campaign."],
};

async function creatorForPortal({ email, creatorId }) {
  const fields = [M.f.fullName, M.f.firstName, M.f.discordUserId, M.f.email, M.f.commitments, M.f.approved];
  const rec = creatorId
    ? await at.first(M.table, { formula: `RECORD_ID()=${at.q(creatorId)}`, fields })
    : await at.first(M.table, { formula: `AND(LOWER({${M.names.email}})=LOWER(${at.q(email)}), {${M.names.approved}})`, fields });
  return rec && rec.fields[M.f.approved] ? rec : null;
}

async function myCommitments(creator) {
  const ids = creator.fields[M.f.commitments] || [];
  return ids.length ? listByIds(K.table, ids, [K.f.status, K.f.campaign, K.f.discordMessageId, K.f.discordUserId]) : [];
}

async function runPortalAction(creator, camp, action) {
  if (!camp) return 'closed';
  const mine = await myCommitments(creator);
  if (action === 'Join') {
    if (modeOf(camp.fields) === 'invite') return 'inviteonly';
    if (camp.fields[C.f.status] !== C.ACTIVE || !camp.fields[C.f.discordMessageId]) return 'closed';
    return webJoin(creator, camp, mine, 'Portal');
  }
  if (action === 'Leave') return webLeave(creator, camp, mine);
  if (action === 'I got paid' || action === "I wasn't paid") {
    const row = mine.find((r) => first1(r.fields[K.f.campaign]) === camp.id && r.fields[K.f.status] === 'Committed');
    if (!row) return 'none';
    return action === 'I got paid' ? confirmPaidByCreator(row.id) : reportNotPaid(row.id);
  }
  const inv = mine.find((r) => first1(r.fields[K.f.campaign]) === camp.id && r.fields[K.f.status] === 'Invited')
    || mine.find((r) => first1(r.fields[K.f.campaign]) === camp.id && ['Committed', 'Declined invite'].includes(r.fields[K.f.status]) && isInviteKey(r.fields[K.f.discordMessageId]));
  if (!inv) return 'noinvite';
  return (await respondToInvite(inv.id, action === 'Accept invitation')).result;
}

async function processPortalRequests() {
  const rows = await at.list(PORTAL.table, {
    formula: `AND({${PORTAL.names.status}}="", {${PORTAL.names.action}}!="")`,
    fields: [PORTAL.f.email, PORTAL.f.campaign, PORTAL.f.action, PORTAL.f.creator],
    maxRecords: 25,
  });
  for (const r of rows) {
    const action = r.fields[PORTAL.f.action];
    const creator = await creatorForPortal({ email: r.fields[PORTAL.f.email], creatorId: first1(r.fields[PORTAL.f.creator]) });
    const campId = first1(r.fields[PORTAL.f.campaign]);
    const camp = campId ? await at.first(C.table, { formula: `RECORD_ID()=${at.q(campId)}`, fields: Object.values(C.f) }) : null;
    let result = 'nocreator';
    if (creator) {
      try {
        result = await runPortalAction(creator, camp, action);
      } catch (err) {
        log('portal action error', err);
        result = 'closed';
      }
    }
    const [status, message] = PORTAL_RESULT[result] || PORTAL_RESULT.closed;
    await at.update(PORTAL.table, r.id, {
      [PORTAL.f.status]: status,
      [PORTAL.f.result]: message,
      [PORTAL.f.processedAt]: now(),
      [PORTAL.f.summary]: `${creator?.fields[M.f.fullName] || r.fields[PORTAL.f.email] || 'Unknown'} · ${action} · ${camp?.fields[C.f.shortName] || 'campaign'}`,
      ...(creator ? { [PORTAL.f.creator]: [creator.id] } : {}),
    });
    log(`Portal request ${r.id}: ${action} → ${result}`);
  }
}

// Same thing for portals that let creators edit a dropdown on their own commitment rows.
async function processRequestedActions() {
  const rows = await at.list(K.table, {
    formula: `{${K.names.requestedAction}}!=""`,
    fields: [K.f.requestedAction, K.f.creator, K.f.campaign],
    maxRecords: 25,
  });
  for (const r of rows) {
    const action = r.fields[K.f.requestedAction];
    const creator = await creatorForPortal({ creatorId: first1(r.fields[K.f.creator]) });
    const campId = first1(r.fields[K.f.campaign]);
    const camp = campId ? await at.first(C.table, { formula: `RECORD_ID()=${at.q(campId)}`, fields: Object.values(C.f) }) : null;
    let result = 'nocreator';
    if (creator) {
      try {
        result = await runPortalAction(creator, camp, action);
      } catch (err) {
        log('requested action error', err);
        result = 'closed';
      }
    }
    await at.update(K.table, r.id, { [K.f.requestedAction]: null, [K.f.actionResult]: (PORTAL_RESULT[result] || PORTAL_RESULT.closed)[1] });
    log(`Requested action on ${r.id}: ${action} → ${result}`);
  }
}

let portalBusy = false;
async function portalTick() {
  if (portalBusy) return;
  portalBusy = true;
  try {
    await processPortalRequests();
    await processRequestedActions();
  } catch (err) {
    log('portal tick error', err);
  } finally {
    portalBusy = false;
  }
}

// ---------- payments: the org marks paid, the creator confirms ----------
// A payment only counts as Paid once the creator confirms it (or after 14 days of silence once the org marked it).
// Statuses: (blank)/Not due yet → Payment due (campaign ended) → Org says paid → Paid. Issue = creator says
// not paid, or 7+ days overdue; staff are alerted. Staff can also set any status by hand in Airtable.

const PAY = {
  DUE_DAYS: 30, OVERDUE_FLAG_DAYS: 7, CREATOR_REMIND_DAYS: 7, AUTO_CONFIRM_DAYS: 14, TICK_MINUTES: 10,
  // Payments due before this date (YYYY-MM-DD) don't trigger overdue reminders or staff flags, so turning this on
  // doesn't flood orgs about campaigns paid before the system existed. Override with PAYMENTS_START in Railway.
  START: process.env.PAYMENTS_START || '2026-10-16',
};

const PAY_FIELDS = () => [
  K.f.title, K.f.status, K.f.campaign, K.f.creator, K.f.discordUserId, K.f.creatorName, K.f.campaignName, K.f.campaignStatus,
  K.f.campaignPay, K.f.campaignEndDate, K.f.orgName, K.f.creatorEmail, K.f.paymentStatus, K.f.amountPaid, K.f.orgPaidAt,
  K.f.orgPaidBy, K.f.paymentNote, K.f.creatorAskedAt, K.f.paidConfirmedAt, K.f.paidConfirmedBy, K.f.paymentReminders,
  K.f.paymentFlagged, K.f.paymentDueDate,
];

const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 0);
const rowPay = (r) => Number(first1(r.fields[K.f.campaignPay])) || 0;
const rowAmount = (r) => Number(r.fields[K.f.amountPaid]) || rowPay(r);
const rowCreatorName = (r) => first1(r.fields[K.f.creatorName]) || 'A creator';
const rowCampName = (r) => first1(r.fields[K.f.campaignName]) || 'the campaign';
const isPaidCampaignRow = (r) => rowPay(r) > 0 || Number(r.fields[K.f.amountPaid]) > 0;
function campaignEnded(r) {
  const end = first1(r.fields[K.f.campaignEndDate]);
  if (end && end < todayEt()) return true;
  return first1(r.fields[K.f.campaignStatus]) !== C.ACTIVE;
}
// What the creator/org should see, even before the bot has written a status.
function payStatusOf(r) {
  const s = r.fields[K.f.paymentStatus];
  if (s && s !== 'Not due yet') return s;
  return campaignEnded(r) ? 'Payment due' : 'Not due yet';
}
const PAY_LABEL = {
  'Not due yet': '⏳ Not due yet',
  'Payment due': '💸 Payment due',
  'Org says paid': '📤 Org says paid',
  Paid: '✅ Paid',
  Issue: '⚠️ Payment issue',
};
const PAY_EMOJI = { 'Not due yet': '⏳', 'Payment due': '💸', 'Org says paid': '📤', Paid: '✅', Issue: '⚠️' };
const stamp = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const addNote = (r, who, note) => {
  const n = String(note || '').trim();
  if (!n) return r.fields[K.f.paymentNote] || null;
  return [r.fields[K.f.paymentNote], `${who} (${stamp()}): ${n}`].filter(Boolean).join('\n').slice(0, 5000);
};

async function loadPayRow(rowId) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(rowId))) return null;
  return at.first(K.table, { formula: `RECORD_ID()=${at.q(rowId)}`, fields: PAY_FIELDS() });
}

// Plain email to an address with no creator record (org leads).
async function queueRawEmail({ to, subject, body, kind }) {
  if (!to) return false;
  await at.create(OUTBOX.table, { [OUTBOX.f.subject]: subject.slice(0, 250), [OUTBOX.f.to]: to, [OUTBOX.f.body]: body, [OUTBOX.f.kind]: kind });
  log(`Queued ${kind} email to org contact`);
  return true;
}

// Tell the org: DM every linked org contact; email the lead if nobody is linked on Discord (or always: true).
async function notifyOrg(campFields, { dmText, subject, body, always = false }) {
  if (!campFields) return;
  const orgs = (campFields[C.f.orgLinks] || []).length ? await listByIds(O.table, campFields[C.f.orgLinks], [O.f.discordUserId, O.f.pageLink]) : [];
  const ids = [...new Set(orgs.flatMap((o) => idList(o.fields[O.f.discordUserId]).filter(isSnowflake)))];
  let sent = 0;
  for (const id of ids) {
    const u = await client.users.fetch(id).catch(() => null);
    if (u) {
      await dm(u, dmText);
      sent++;
    }
  }
  const { email, name } = leadContact(campFields);
  const page = orgs.map((o) => o.fields[O.f.pageLink]).find(Boolean);
  if (email && (always || !sent)) {
    await queueRawEmail({
      to: email,
      kind: 'Payment',
      subject,
      body: `Hi ${name ? name.split(' ')[0] : 'there'},\n\n${body}${page ? `\n\n[Open your Creator Congress partner page](${page})` : ''}\n\nQuestions? Reply to the Creator Congress team.`,
    }).catch((err) => log('email error', err));
  }
}

async function payAlertStaff(r, reason) {
  await staffNote(
    `${STAFF_ROLE_ID ? `<@&${STAFF_ROLE_ID}> ` : ''}⚠️ **Payment issue:** ${rowCreatorName(r)} · **${rowCampName(r)}** · ${money(rowAmount(r)) || 'amount TBD'}\n${reason}\n_Fix it in Airtable → Campaign Commitments (Payment Status), or ask the org to mark it paid again._`
  );
}

function payButtons(rowId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`py:y:${rowId}`).setLabel('Yes, I got it').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`py:n:${rowId}`).setLabel('Not yet').setStyle(ButtonStyle.Secondary)
  );
}

// Ask the creator to confirm (DM with buttons if on Discord; email with their page link per their email setting).
async function askCreatorToConfirm(r, { reminder = false } = {}) {
  const amount = money(rowAmount(r)) || 'your payment';
  const org = first1(r.fields[K.f.orgName]) || 'The partner';
  const note = String(r.fields[K.f.paymentNote] || '').split('\n').filter((l) => l.startsWith('Org')).pop();
  const text =
    `${reminder ? '⏰ Reminder: ' : ''}💸 **${org}** says they sent **${amount}** for **${rowCampName(r)}**.` +
    (note ? `\n> ${note.replace(/^Org \([^)]*\): /, '')}` : '') +
    `\n\nDid you receive it? If you don't answer within ${PAY.AUTO_CONFIRM_DAYS} days it will be counted as received, and you can still report a problem after that.`;
  const did = r.fields[K.f.discordUserId];
  if (isSnowflake(did)) {
    const u = await client.users.fetch(did).catch(() => null);
    await u?.send({ content: text, components: [payButtons(r.id)] }).catch(() => {});
  }
  const cid = first1(r.fields[K.f.creator]);
  if (cid) {
    const creator = await at.first(M.table, { formula: `RECORD_ID()=${at.q(cid)}`, fields: CREATOR_CONTACT_FIELDS() });
    if (creator) {
      await queueEmail({
        creator,
        kind: 'Payment check',
        subject: `${reminder ? 'Reminder: ' : ''}Did you receive ${amount} for ${rowCampName(r)}?`,
        body: `${hi(creator.fields)}\n\n${text.replace(/^⏰ Reminder: /, '').replace(/💸 /, '')}\n\nPlease confirm on your campaigns page. It takes one click: **Yes, I got it** or **Not yet**.${pageLine(creator.fields)}`,
      }).catch((err) => log('email error', err));
    }
  }
  await at.update(K.table, r.id, reminder
    ? { [K.f.paymentReminders]: (Number(r.fields[K.f.paymentReminders]) || 0) + 1 }
    : { [K.f.creatorAskedAt]: now(), [K.f.paymentReminders]: 0 });
}

// Org (or staff) marks a creator paid.
async function markPaidByOrg(rowId, { amount, note, by }) {
  const r = await loadPayRow(rowId);
  if (!r || r.fields[K.f.status] !== 'Committed') return 'missing';
  if (r.fields[K.f.paymentStatus] === 'Paid') return 'alreadypaid';
  const amt = Number(String(amount ?? '').replace(/[$,\s]/g, ''));
  const fields = {
    [K.f.paymentStatus]: 'Org says paid',
    [K.f.amountPaid]: Number.isFinite(amt) && amt > 0 ? amt : rowAmount(r) || null,
    [K.f.orgPaidAt]: now(),
    [K.f.orgPaidBy]: String(by || '').slice(0, 100),
    [K.f.paymentNote]: addNote(r, 'Org', note),
    [K.f.paymentFlagged]: false,
  };
  await at.update(K.table, r.id, fields);
  Object.assign(r.fields, fields);
  await askCreatorToConfirm(r);
  log(`Payment marked paid by org: ${r.id}`);
  return 'marked';
}

// Creator confirms they got paid (works whether or not the org marked it first).
async function confirmPaidByCreator(rowId, { by = 'Creator' } = {}) {
  const r = await loadPayRow(rowId);
  if (!r || r.fields[K.f.status] !== 'Committed') return 'missing';
  if (r.fields[K.f.paymentStatus] === 'Paid' && by === 'Creator' && r.fields[K.f.paidConfirmedBy] === 'Creator') return 'alreadypaid';
  await at.update(K.table, r.id, {
    [K.f.paymentStatus]: 'Paid',
    [K.f.paidConfirmedAt]: now(),
    [K.f.paidConfirmedBy]: by,
    [K.f.amountPaid]: rowAmount(r) || null,
    [K.f.paymentFlagged]: false,
  });
  log(`Payment confirmed (${by}): ${r.id}`);
  const campFields = await campaignFieldsById(first1(r.fields[K.f.campaign]));
  const amount = money(rowAmount(r)) || 'payment';
  const msg = by === 'Creator'
    ? `✅ **${rowCreatorName(r)}** confirmed they received their **${amount}** for **${rowCampName(r)}**. Thank you!`
    : `✅ **${rowCreatorName(r)}**'s **${amount}** for **${rowCampName(r)}** is now counted as received (no reply after ${PAY.AUTO_CONFIRM_DAYS} days).`;
  await notifyOrg(campFields, { dmText: msg, subject: `Payment confirmed: ${rowCreatorName(r)} · ${rowCampName(r)}`, body: msg.replace(/\*\*/g, '') });
  return 'confirmedpaid';
}

// Creator says they haven't been paid. Reopens even an auto-confirmed payment.
async function reportNotPaid(rowId, { note } = {}) {
  const r = await loadPayRow(rowId);
  if (!r || r.fields[K.f.status] !== 'Committed') return 'missing';
  const st = r.fields[K.f.paymentStatus];
  if (st === 'Paid' && r.fields[K.f.paidConfirmedBy] === 'Creator') return 'alreadypaid';
  if (!campaignEnded(r) && st !== 'Org says paid') return 'notdue';
  await at.update(K.table, r.id, {
    [K.f.paymentStatus]: 'Issue',
    [K.f.paymentNote]: addNote(r, 'Creator', note || 'Says they have not received payment yet.'),
    [K.f.paymentFlagged]: true,
    [K.f.paidConfirmedAt]: null,
    [K.f.paidConfirmedBy]: null,
  });
  log(`Payment reported not received: ${r.id}`);
  const campFields = await campaignFieldsById(first1(r.fields[K.f.campaign]));
  const amount = money(rowAmount(r)) || 'their payment';
  const msg =
    `⚠️ **${rowCreatorName(r)}** says they haven't received **${amount}** for **${rowCampName(r)}** yet.` +
    (note ? `\n> ${String(note).slice(0, 500)}` : '') +
    `\n\nPlease check on it and reach out to them. Once it's sent, mark them paid again (\`/payments\` in Discord or your partner page) and they'll be asked to confirm.`;
  await notifyOrg(campFields, { dmText: msg, subject: `Payment not received: ${rowCreatorName(r)} · ${rowCampName(r)}`, body: msg.replace(/\*\*/g, '').replace(/`/g, ''), always: true });
  await payAlertStaff(r, `Creator reported it hasn't arrived${note ? `: "${String(note).slice(0, 300)}"` : '.'}`);
  return 'reported';
}

// Runs from poll() every ~10 minutes: due dates, reminders, auto-confirm, overdue flags.
let lastPayTick = 0;
async function paymentTick() {
  if (Date.now() - lastPayTick < PAY.TICK_MINUTES * 60_000) return;
  lastPayTick = Date.now();
  const rows = await at.list(K.table, {
    formula: `AND({${K.names.status}}="Committed", {${K.names.paymentStatus}}!="Paid")`,
    fields: PAY_FIELDS(),
  });
  const today = todayEt();
  for (const r of rows) {
    try {
      if (!isPaidCampaignRow(r)) continue;
      const st = r.fields[K.f.paymentStatus] || '';
      const reminders = Number(r.fields[K.f.paymentReminders]) || 0;

      if (st === 'Org says paid') {
        const asked = r.fields[K.f.creatorAskedAt];
        if (!asked) await askCreatorToConfirm(r); // e.g. staff or a portal set the status by hand
        else if (daysSince(asked) >= PAY.AUTO_CONFIRM_DAYS) await confirmPaidByCreator(r.id, { by: 'Auto (14 days)' });
        else if (daysSince(asked) >= PAY.CREATOR_REMIND_DAYS && reminders < 1) await askCreatorToConfirm(r, { reminder: true });
        continue;
      }
      if (st === 'Issue') {
        if (!r.fields[K.f.paymentFlagged]) {
          await payAlertStaff(r, 'Marked as an issue in Airtable.');
          await at.update(K.table, r.id, { [K.f.paymentFlagged]: true });
        }
        continue;
      }
      // Not due yet / Payment due
      const want = campaignEnded(r) ? 'Payment due' : 'Not due yet';
      if (st !== want) await at.update(K.table, r.id, { [K.f.paymentStatus]: want });
      const due = r.fields[K.f.paymentDueDate];
      if (want !== 'Payment due' || !due || due >= today) continue;
      if (due < PAY.START) continue; // older campaigns: no overdue nagging; staff/creators can still mark them paid
      const late = (new Date(today) - new Date(due)) / 86_400_000;
      const campFields = await campaignFieldsById(first1(r.fields[K.f.campaign]));
      if (reminders < 1) {
        const msg =
          `💸 **Payment reminder:** ${rowCreatorName(r)}'s **${money(rowAmount(r))}** for **${rowCampName(r)}** was due ${fmtDate(due)}.` +
          `\n\nIf you've already paid, mark it paid so they can confirm (\`/payments\` in Discord or your partner page). If something's holding it up, let the creator know.`;
        await notifyOrg(campFields, { dmText: msg, subject: `Payment due: ${rowCreatorName(r)} · ${rowCampName(r)}`, body: msg.replace(/\*\*/g, '').replace(/`/g, ''), always: true });
        await at.update(K.table, r.id, { [K.f.paymentReminders]: 1 });
      } else if (late >= PAY.OVERDUE_FLAG_DAYS && !r.fields[K.f.paymentFlagged]) {
        await at.update(K.table, r.id, {
          [K.f.paymentStatus]: 'Issue',
          [K.f.paymentFlagged]: true,
          [K.f.paymentNote]: addNote(r, 'Bot', `Not marked paid ${PAY.OVERDUE_FLAG_DAYS}+ days after the ${fmtDate(due)} due date.`),
        });
        await payAlertStaff(r, `Overdue: not marked paid ${Math.floor(late)} days after the ${fmtDate(due)} due date.`);
      }
    } catch (err) {
      log('payment tick error', r.id, err);
    }
  }
}

// ---- Discord: creator buttons (py:y / py:n), org "Mark paid" buttons (py:m) + modals ----

const PAY_RESULT_TEXT = {
  marked: '📤 Marked paid. The creator has been asked to confirm they received it.',
  confirmedpaid: "✅ Thanks for confirming! We've let the partner know.",
  reported: "Thanks for letting us know. The partner and the Creator Congress team have been alerted, and someone will follow up.",
  alreadypaid: 'This payment is already confirmed as received.',
  notdue: "This campaign hasn't ended yet, so payment isn't due. If something's wrong, message a team member.",
  missing: "We couldn't find that payment. It may have been withdrawn.",
  notallowed: "You're not a contact for this campaign.",
};

async function canManagePayment(userId, r) {
  if (await isStaff(userId)) return true;
  const campFields = await campaignFieldsById(first1(r.fields[K.f.campaign]));
  return (await orgContactIds(campFields?.[C.f.orgLinks])).includes(userId);
}

// Buttons answer within Discord's 3-second window: modals open immediately, checks run on submit.
async function handlePayButton(interaction) {
  const [, action, rowId, amountHint] = interaction.customId.split(':');
  if (action === 'm') {
    const modal = new ModalBuilder().setCustomId(`pym:m:${rowId}`).setTitle('Mark creator paid');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('amount').setLabel('Amount paid ($)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(amountHint || '')).setMaxLength(12)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('note').setLabel('Note for the creator (optional)').setPlaceholder('e.g. ACH sent 10/20, should arrive in 2-3 days').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
      )
    );
    return interaction.showModal(modal);
  }
  if (action === 'n') {
    const modal = new ModalBuilder().setCustomId(`pym:n:${rowId}`).setTitle('Payment not received');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('note').setLabel('Anything we should know? (optional)').setPlaceholder('e.g. Nothing has arrived in my bank account yet').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
      )
    );
    return interaction.showModal(modal);
  }
  // 'y': the creator confirms
  const inDm = !interaction.guildId;
  if (inDm) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await loadPayRow(rowId);
  let text;
  if (!r) text = PAY_RESULT_TEXT.missing;
  else if (r.fields[K.f.discordUserId] !== interaction.user.id) text = 'This payment belongs to someone else.';
  else text = PAY_RESULT_TEXT[await confirmPaidByCreator(r.id)];
  if (inDm) return interaction.editReply({ content: `${interaction.message.content}\n\n${text}`.slice(0, 2000), components: [] });
  return interaction.editReply(text);
}

async function handlePayModal(interaction) {
  const [, action, rowId] = interaction.customId.split(':');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await loadPayRow(rowId);
  if (!r) return interaction.editReply(PAY_RESULT_TEXT.missing);
  const note = interaction.fields.getTextInputValue('note') || '';
  if (action === 'm') {
    if (!(await canManagePayment(interaction.user.id, r))) return interaction.editReply(PAY_RESULT_TEXT.notallowed);
    const amount = interaction.fields.getTextInputValue('amount');
    const result = await markPaidByOrg(r.id, { amount, note, by: interaction.user.globalName || interaction.user.username });
    return interaction.editReply(PAY_RESULT_TEXT[result]);
  }
  if (r.fields[K.f.discordUserId] !== interaction.user.id) return interaction.editReply('This payment belongs to someone else.');
  return interaction.editReply(PAY_RESULT_TEXT[await reportNotPaid(r.id, { note })]);
}

// /payments: orgs see payment status for their confirmed creators and mark them paid. Staff see everything outstanding.
async function handlePayments(interaction) {
  const staff = await isStaff(interaction.user.id);
  const orgs = await findOrgsByDiscordId(interaction.user.id);
  if (!staff && !orgs.length) {
    return interaction.editReply("This command is for partner organizations. Run `/link` with your organization's application email first.");
  }
  let rows = [];
  if (orgs.length) {
    const ids = [...new Set(orgs.flatMap((o) => o.fields[O.f.proposals] || []))];
    const props = ids.length ? await listByIds(C.table, ids, [C.f.commitments]) : [];
    const rowIds = [...new Set(props.flatMap((p) => p.fields[C.f.commitments] || []))];
    rows = rowIds.length ? await listByIds(K.table, rowIds, PAY_FIELDS()) : [];
  } else {
    rows = await at.list(K.table, { formula: `AND({${K.names.status}}="Committed", {${K.names.paymentStatus}}!="Paid", {${K.names.paymentStatus}}!="Not due yet")`, fields: PAY_FIELDS() });
  }
  rows = rows.filter((r) => r.fields[K.f.status] === 'Committed' && isPaidCampaignRow(r));
  if (!rows.length) return interaction.editReply('No paid campaigns with confirmed creators yet.');

  const order = { Issue: 0, 'Payment due': 1, 'Org says paid': 2, 'Not due yet': 3, Paid: 4 };
  rows.sort((a, b) => order[payStatusOf(a)] - order[payStatusOf(b)] || rowCampName(a).localeCompare(rowCampName(b)));
  const byCamp = new Map();
  for (const r of rows) {
    const k = rowCampName(r);
    if (!byCamp.has(k)) byCamp.set(k, []);
    byCamp.get(k).push(r);
  }
  const count = (s) => rows.filter((r) => payStatusOf(r) === s).length;
  const paidTotal = rows.filter((r) => payStatusOf(r) === 'Paid').reduce((t, r) => t + rowAmount(r), 0);
  const owedTotal = rows.filter((r) => ['Payment due', 'Issue'].includes(payStatusOf(r))).reduce((t, r) => t + rowAmount(r), 0);
  const e = new EmbedBuilder()
    .setAuthor({ name: staff && !orgs.length ? 'CREATOR CONGRESS · OUTSTANDING PAYMENTS' : 'CREATOR CONGRESS · PARTNER PAYMENTS' })
    .setTitle('💸 Creator payments')
    .setColor(0xf1c40f)
    .setDescription(
      [
        `✅ **${count('Paid')}** paid${paidTotal ? ` (${money(paidTotal)})` : ''}`,
        `📤 **${count('Org says paid')}** waiting on creator`,
        `💸 **${count('Payment due')}** due${owedTotal ? ` (${money(owedTotal)} incl. issues)` : ''}`,
        count('Issue') ? `⚠️ **${count('Issue')}** issue${count('Issue') === 1 ? '' : 's'}` : null,
        count('Not due yet') ? `⏳ **${count('Not due yet')}** not due yet` : null,
      ].filter(Boolean).join('   ·   ')
    );
  let budget = 5200;
  for (const [camp, list] of [...byCamp].slice(0, 20)) {
    let value = list
      .map((r) => {
        const st = payStatusOf(r);
        const due = r.fields[K.f.paymentDueDate];
        const extra = st === 'Payment due' && due ? ` · due ${fmtDate(due)}` : st === 'Org says paid' ? ' · waiting on creator' : '';
        const who = isSnowflake(r.fields[K.f.discordUserId]) ? ` <@${r.fields[K.f.discordUserId]}>` : '';
        return `${PAY_EMOJI[st]} ${rowCreatorName(r)}${who} · ${money(rowAmount(r))}${extra}`;
      })
      .join('\n');
    if (value.length > 1000) value = value.slice(0, value.lastIndexOf('\n', 990)) + '\n…and more (see your partner page)';
    if (camp.length + value.length > budget) break;
    budget -= camp.length + value.length;
    e.addFields({ name: camp.slice(0, 256), value });
  }
  const page = orgs.map((o) => o.fields[O.f.pageLink]).find(Boolean);
  e.setFooter({ text: 'Paid = the creator confirmed it (or no reply 14 days after you marked it). Only you can see this.' });
  const actionable = rows.filter((r) => ['Payment due', 'Issue', 'Not due yet'].includes(payStatusOf(r))).slice(0, 20);
  const components = [];
  for (let i = 0; i < actionable.length; i += 4) {
    components.push(
      new ActionRowBuilder().addComponents(
        actionable.slice(i, i + 4).map((r) =>
          new ButtonBuilder().setCustomId(`py:m:${r.id}:${Math.round(rowAmount(r) * 100) / 100 || ''}`).setLabel(`Mark paid: ${rowCreatorName(r)}`.slice(0, 80)).setStyle(ButtonStyle.Primary)
        )
      )
    );
  }
  if (page && components.length < 5) {
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(page).setLabel('Open partner page')));
  }
  return interaction.editReply({ embeds: [e], components: components.slice(0, 5) });
}

// ---- partner (org) web page: /o/<token> ----

async function ensureOrgTokens() {
  if (!PUBLIC_URL) return;
  const rows = await at.list(O.table, { formula: `AND({${O.names.approved}}, {${O.names.pageToken}}="")`, fields: [O.f.organization], maxRecords: 50 });
  for (const r of rows) {
    const token = randomBytes(16).toString('hex');
    await at.update(O.table, r.id, { [O.f.pageToken]: token, [O.f.pageLink]: `${publicBase()}/o/${token}` });
  }
  if (rows.length) log(`Issued partner-page links to ${rows.length} org(s)`);
}

async function orgByToken(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  return at.first(O.table, {
    formula: `{${O.names.pageToken}}=${at.q(token)}`,
    fields: [O.f.organization, O.f.firstName, O.f.proposals, O.f.approved],
  });
}

const ORG_FLASH = {
  approved: '✅ Approved. The creator has been told and added to the campaign.',
  declined: 'Declined. The creator was sent a kind note; no reason was shared.',
  decided: 'Someone already made a decision on that request.',
  invited: '✉️ Invited. Their invitation goes out within 2 minutes (once the campaign is live).',
  skipped: 'Removed from your suggestions.',
  marked: '📤 Marked paid. The creator has been asked to confirm they received it.',
  alreadypaid: 'That creator already confirmed they were paid.',
  missing: "We couldn't find that creator on your campaigns.",
};

async function renderOrgPage(org, token, flash, opts = {}) {
  const ids = org.fields[O.f.proposals] || [];
  const props = ids.length ? await listByIds(C.table, ids, Object.values(C.f)) : [];
  const rowIds = [...new Set(props.flatMap((p) => p.fields[C.f.commitments] || []))];
  const rows = (rowIds.length ? await listByIds(K.table, rowIds, PAY_FIELDS()) : []).filter((r) => r.fields[K.f.status] === 'Committed');
  props.sort((a, b) => (b.fields[C.f.status] === C.ACTIVE) - (a.fields[C.f.status] === C.ACTIVE));
  const paidRows = rows.filter((r) => isPaidCampaignRow(r));
  const tot = (s) => paidRows.filter((r) => payStatusOf(r) === s).reduce((t, r) => t + rowAmount(r), 0);
  const cnt = (s) => paidRows.filter((r) => payStatusOf(r) === s).length;

  // Requests waiting for review + suggestions for invite-only campaigns
  const allRows = rowIds.length ? await listByIds(K.table, rowIds, [K.f.status, K.f.campaign, K.f.creator, K.f.requestedAt, K.f.discordUsername]) : [];
  const pending = allRows.filter((r) => r.fields[K.f.status] === 'Pending');
  const inviteCamps = props.filter((p) => p.fields[C.f.status] === C.ACTIVE && modeOf(p.fields) === 'invite');
  const profileIds = new Set(pending.map((r) => first1(r.fields[K.f.creator])).filter(Boolean));
  for (const p of inviteCamps) for (const id of [...(p.fields[C.f.suggested] || []), ...(p.fields[C.f.invited] || [])]) profileIds.add(id);
  const profiles = new Map(
    (profileIds.size
      ? await listByIds(M.table, [...profileIds], [M.f.fullName, M.f.reach, M.f.tiktok, M.f.instagram, M.f.youtube, M.f.issues, M.f.about, M.f.state])
      : []
    ).map((m) => [m.id, m.fields])
  );
  const campName = (id) => props.find((p) => p.id === id)?.fields[C.f.shortName] || 'Campaign';
  const profileHtml = (cf, fallback) => {
    const reach = Number(cf?.[M.f.reach]);
    const handles = [cf?.[M.f.tiktok] && `TikTok ${cf[M.f.tiktok]}`, cf?.[M.f.instagram] && `Instagram ${cf[M.f.instagram]}`, cf?.[M.f.youtube] && `YouTube ${cf[M.f.youtube]}`].filter(Boolean);
    const issues = Array.isArray(cf?.[M.f.issues]) ? cf[M.f.issues].slice(0, 6) : [];
    const about = String(cf?.[M.f.about] || '').trim();
    return `<b>${esc(cf?.[M.f.fullName] || fallback || 'Creator')}</b>
      <div class="meta">${cf?.[M.f.state] ? `<span>📍 ${esc(cf[M.f.state])}</span>` : ''}${Number.isFinite(reach) && reach > 0 ? `<span>👥 ${esc(reach.toLocaleString('en-US'))} followers</span>` : ''}${handles.length ? `<span>${esc(handles.join(' · '))}</span>` : ''}</div>
      ${issues.length ? `<div class="tags">${issues.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${about ? `<details><summary>About</summary><p>${esc(about.slice(0, 800))}</p></details>` : ''}`;
  };
  const reviewHtml = pending.length
    ? `<h2 id="review">🙋 Waiting for your review (${pending.length})</h2>` +
      pending
        .map((r) => {
          const req = r.fields[K.f.requestedAt];
          return `<div class="card"><p class="org">Wants to join <b>${esc(campName(first1(r.fields[K.f.campaign])))}</b>${req ? ` · requested ${esc(fmtDate(req.slice(0, 10)))}` : ''}</p>
  ${profileHtml(profiles.get(first1(r.fields[K.f.creator])), r.fields[K.f.discordUsername])}
  <div class="actions"><form method="post" action="/o/${token}/review/${r.id}/approve"><button class="primary">✅ Approve</button></form><form method="post" action="/o/${token}/review/${r.id}/decline"><button>Decline</button></form></div></div>`;
        })
        .join('') +
      `<p class="muted">Declined creators get a kind note. No reason is shared. Requests waiting 7+ days are flagged to the Creator Congress team.</p>`
    : '';
  // Find any creator (search form) for invite-only campaigns
  let findHtml = '';
  if (inviteCamps.length) {
    const dir = await creatorDirectory();
    const qp = opts.query || {};
    const crit = { q: qp.q || '', issue: qp.issue || '', state: qp.state || '', min: Number(qp.min) || 0 };
    const searching = crit.q || crit.issue || crit.state || crit.min;
    const issuesAll = [...new Set(dir.flatMap((c) => c.fields[M.f.issues] || []))].sort();
    const statesAll = [...new Set(dir.map((c) => c.fields[M.f.state]).filter(Boolean))].sort();
    const opt = (v, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`;
    const results = searching ? searchCreators(dir, crit) : [];
    const invitedTo = (cid) => inviteCamps.filter((p) => (p.fields[C.f.invited] || []).includes(cid));
    findHtml = `<h2 id="find">🔎 Find creators</h2>
  <p class="muted">Search the whole Creator Congress network and invite anyone to your invite-only campaigns. Contact info is shared only after a creator accepts.</p>
  <form method="get" action="/o/${token}#find" class="card findform">
    <input name="q" placeholder="Name or handle" value="${esc(crit.q)}">
    <select name="issue"><option value="">Any issue</option>${issuesAll.map((v) => opt(v, crit.issue)).join('')}</select>
    <select name="state"><option value="">Any state</option>${statesAll.map((v) => opt(v, crit.state)).join('')}</select>
    <select name="min"><option value="">Any reach</option>${[1000, 10000, 50000, 100000, 500000].map((n) => `<option value="${n}"${crit.min === n ? ' selected' : ''}>${reachShort(n)}+ followers</option>`).join('')}</select>
    <button class="primary">Search</button>
  </form>
  ${searching ? (results.length ? `<p class="muted">${results.length} creator${results.length === 1 ? '' : 's'} found${results.length > 30 ? ', showing the 30 with the most followers' : ''}.</p>` + results.slice(0, 30).map((c) => {
      const done = invitedTo(c.id);
      const left = inviteCamps.filter((p) => !done.includes(p));
      const action = !left.length
        ? `<span class="pill">✉️ Invited</span>`
        : `<form method="post" action="/o/${token}/invitepick/${c.id}" class="actions">${left.length > 1 ? `<select name="camp">${left.map((p) => `<option value="${p.id}">${esc(p.fields[C.f.shortName] || 'Campaign')}</option>`).join('')}</select>` : `<input type="hidden" name="camp" value="${left[0].id}">`}<button class="primary">✉️ Invite${left.length === 1 ? ` to ${esc(left[0].fields[C.f.shortName] || 'campaign')}` : ''}</button></form>`;
      return `<div class="card">${profileHtml(c.fields)}${done.length ? `<p class="muted">Already invited to ${esc(done.map((p) => p.fields[C.f.shortName]).join(', '))}</p>` : ''}${action}</div>`;
    }).join('') : '<p class="empty">No creators match. Try fewer filters.</p>') : ''}`;
  }

  const suggestHtml = inviteCamps
    .map((p) => {
      const invitedSet = new Set(p.fields[C.f.invited] || []);
      const sugg = (p.fields[C.f.suggested] || []).filter((id) => !invitedSet.has(id));
      const reasons = new Map(
        String(p.fields[C.f.suggestionNotes] || '')
          .split('\n')
          .map((l) => l.match(/^\d+\.\s+(.+?):\s+(.*)$/))
          .filter(Boolean)
          .map((m) => [m[1].trim(), m[2]])
      );
      const status = (id) => allRows.find((r) => first1(r.fields[K.f.campaign]) === p.id && first1(r.fields[K.f.creator]) === id)?.fields[K.f.status];
      const invitedList = [...invitedSet].map((id) => {
        const st = status(id);
        const label = st === 'Committed' ? '✅ accepted' : st === 'Declined invite' ? '👋 passed' : '✉️ invited';
        return `<span class="tag">${esc(profiles.get(id)?.[M.f.fullName] || 'Creator')} · ${label}</span>`;
      });
      return `<h2>✨ Suggested creators: ${esc(p.fields[C.f.shortName] || 'Campaign')}</h2>
  <p class="muted">Invite-only. Best matches first, based on shared issues, location and reach. Nobody is invited until you click Invite.</p>
  ${invitedList.length ? `<p class="muted">Already invited:</p><div class="tags">${invitedList.join('')}</div>` : ''}
  ${sugg.length ? sugg.map((id) => {
        const cf = profiles.get(id);
        const why = reasons.get(String(cf?.[M.f.fullName] || '').trim());
        return `<div class="card">${profileHtml(cf)}${why ? `<p class="muted">Why: ${esc(why)}</p>` : ''}
  <div class="actions"><form method="post" action="/o/${token}/invite/${p.id}/${id}"><button class="primary">✉️ Invite</button></form><form method="post" action="/o/${token}/skip/${p.id}/${id}"><button>Not a fit</button></form></div></div>`;
      }).join('') : '<p class="empty">No more suggestions right now. Ask the Creator Congress team to refresh them.</p>'}`;
    })
    .join('');

  const campHtml = props
    .map((p) => {
      const mine = rows.filter((r) => first1(r.fields[K.f.campaign]) === p.id);
      if (!mine.length && p.fields[C.f.status] !== C.ACTIVE) return '';
      const f = p.fields;
      const list = mine.length
        ? mine
            .map((r) => {
              const st = payStatusOf(r);
              const paid = isPaidCampaignRow(r);
              const email = first1(r.fields[K.f.creatorEmail]);
              const note = String(r.fields[K.f.paymentNote] || '').trim();
              const canMark = paid && ['Not due yet', 'Payment due', 'Issue'].includes(st);
              const due = r.fields[K.f.paymentDueDate];
              return `<div class="row">
  <div class="row-main"><b>${esc(rowCreatorName(r))}</b>${email ? ` · <a href="mailto:${esc(email)}?subject=${encodeURIComponent(f[C.f.shortName] || 'Creator Congress')}">${esc(email)}</a>` : ''}
    ${paid ? `<div class="paystat ${st.replace(/\W+/g, '').toLowerCase()}">${esc(PAY_LABEL[st])} · ${esc(money(rowAmount(r)))}${st === 'Payment due' && due ? ` · due ${esc(fmtDate(due))}` : ''}${st === 'Org says paid' ? ' · waiting for the creator to confirm' : ''}</div>` : '<div class="muted">Unpaid campaign</div>'}
    ${note ? `<details><summary>Payment notes</summary><p>${esc(note)}</p></details>` : ''}
  </div>
  ${canMark ? `<form method="post" action="/o/${token}/paid/${r.id}" class="markpaid">
    <label>Amount <input name="amount" inputmode="decimal" value="${esc(String(rowAmount(r) || ''))}" size="7"></label>
    <input name="note" placeholder="Note for the creator (optional)" maxlength="500">
    <button class="primary">Mark paid</button></form>` : ''}
</div>`;
            })
            .join('')
        : '<p class="empty">No confirmed creators yet.</p>';
      return `<div class="card"><h3>${esc(f[C.f.shortName] || 'Campaign')}</h3>
  <div class="meta"><span>${f[C.f.status] === C.ACTIVE ? '🟢 Active' : '⚪ Closed'}</span><span>💰 ${f[C.f.creatorPay] ? esc(money(Number(f[C.f.creatorPay]))) + ' per creator' : 'Unpaid / TBD'}</span>${f[C.f.endDate] ? `<span>📅 ends ${esc(fmtDate(f[C.f.endDate]))}</span>` : ''}<span>👥 ${mine.length} confirmed</span></div>
  ${list}</div>`;
    })
    .join('');

  const body = `
<header>${brandHtml('Partner page')}<h1>${esc(org.fields[O.f.organization] || 'Your organization')}</h1>
<p>Review requests, invite creators, see who's confirmed, and track payments.</p></header>
${flash && ORG_FLASH[flash] ? `<div class="flash">${esc(ORG_FLASH[flash])}</div>` : ''}
<div class="stats">
  <div class="stat"><b>${cnt('Paid')}</b>paid${tot('Paid') ? ` · ${esc(money(tot('Paid')))}` : ''}</div>
  <div class="stat"><b>${cnt('Org says paid')}</b>waiting on creator</div>
  <div class="stat"><b>${cnt('Payment due') + cnt('Issue')}</b>to pay${tot('Payment due') + tot('Issue') ? ` · ${esc(money(tot('Payment due') + tot('Issue')))}` : ''}</div>
</div>
<div class="flash">How payment confirmation works: after you pay a creator, click <b>Mark paid</b>. They're asked to confirm it arrived. It shows as <b>✅ Paid</b> once they confirm, or automatically if they don't reply within 14 days. Payments are due within 30 days of the campaign's end date.</div>
${reviewHtml}
${suggestHtml}
${findHtml}
<h2>Your campaigns</h2>
${campHtml || '<p class="empty">No campaigns yet.</p>'}
<footer>This page is private to your organization, so please don't share the link outside your team. Questions? Reply to any Creator Congress email.</footer>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Partner page · Creator Congress</title><style>${PAGE_CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

// Read a small urlencoded form body.
function readForm(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 10_000) req.destroy();
    });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(data))));
    req.on('error', () => resolve({}));
  });
}

// Creator page: payment line + buttons for a confirmed, paid campaign row.
function paymentHtml(r, token) {
  if (!r || !isPaidCampaignRow(r)) return '';
  const st = payStatusOf(r);
  const amount = money(rowAmount(r));
  const due = r.fields[K.f.paymentDueDate];
  const orgNote = String(r.fields[K.f.paymentNote] || '').split('\n').filter((l) => l.startsWith('Org')).pop();
  const yes = `<form method="post" action="/c/${token}/pay/${r.id}/yes"><button class="primary">✅ Yes, I got paid</button></form>`;
  const no = `<details class="notpaid"><summary>I haven't been paid</summary><form method="post" action="/c/${token}/pay/${r.id}/no"><textarea name="note" rows="2" maxlength="500" placeholder="Anything we should know? (optional)"></textarea><button>Report it</button></form></details>`;
  const lines = {
    'Not due yet': `Payment is due within 30 days after the campaign ends${due ? ` (by ${esc(fmtDate(due))})` : ''}.`,
    'Payment due': `The campaign has ended. Payment is due${due ? ` by ${esc(fmtDate(due))}` : ''}. Already received it? Let us know.`,
    'Org says paid': `<b>The partner says they sent ${esc(amount)}.</b> Did it arrive?${orgNote ? `<br><span class="muted">${esc(orgNote.replace(/^Org \([^)]*\): /, ''))}</span>` : ''}`,
    Paid: r.fields[K.f.paidConfirmedBy] === 'Creator' ? `You confirmed you received ${esc(amount)}. Thank you!` : `Counted as received. Not right? Let us know.`,
    Issue: 'You reported a problem with this payment. The partner and our team have been alerted.',
  };
  let actions = '';
  if (st === 'Org says paid' || st === 'Payment due') actions = yes + no;
  else if (st === 'Paid' && r.fields[K.f.paidConfirmedBy] !== 'Creator') actions = no;
  else if (st === 'Issue') actions = yes;
  return `<div class="pay ${st.replace(/\W+/g, '').toLowerCase()}"><div class="contact-h">Payment · ${esc(PAY_LABEL[st])}${amount ? ` · ${esc(amount)}` : ''}</div><p>${lines[st]}</p>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

// ---------- slash commands ----------

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Connect your Discord account to your Creator Congress or organization profile')
    .addStringOption((o) => o.setName('email').setDescription('The email you applied with').setRequired(true)),
  new SlashCommandBuilder().setName('mycampaigns').setDescription('See the campaigns you have signed up for and your expected pay'),
  new SlashCommandBuilder().setName('roster').setDescription('For organizations: see which creators signed up for your campaigns'),
  new SlashCommandBuilder().setName('review').setDescription('For organizations: approve or decline creators who asked to join your campaigns'),
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('For organizations: invite creators to your invite-only campaigns (suggestions, or search by name)')
    .addStringOption((o) => o.setName('creator').setDescription('Search any approved creator by name or handle').setAutocomplete(true).setRequired(false)),
  new SlashCommandBuilder().setName('payments').setDescription('For organizations: see payment status for your creators and mark them paid'),
  new SlashCommandBuilder().setName('help').setDescription('How Creator Congress campaigns work'),
].map((c) => c.toJSON());

const idList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function findOrgsByDiscordId(userId) {
  if (!isSnowflake(userId)) return Promise.resolve([]);
  return at.list(O.table, {
    formula: `FIND(${at.q(userId)}, {${O.names.discordUserId}}&"")>0`,
    fields: [O.f.organization, O.f.proposals, O.f.discordUserId],
  });
}

async function handleLink(interaction) {
  const email = interaction.options.getString('email', true).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return interaction.editReply("That doesn't look like an email address. Try again with the email you applied with.");
  }
  const [member, org] = await Promise.all([
    at.first(M.table, {
      formula: `AND(LOWER({${M.names.email}})=LOWER(${at.q(email)}), {${M.names.approved}})`,
      fields: [M.f.firstName, M.f.discordUserId],
    }),
    at.first(O.table, {
      formula: `AND(LOWER({${O.names.email}})=LOWER(${at.q(email)}), {${O.names.approved}})`,
      fields: [O.f.organization, O.f.discordUserId],
    }),
  ]);
  if (!member && !org) {
    return interaction.editReply(
      "I couldn't find an approved Creator Congress member or partner organization with that email. Check for typos, or message a team member for help."
    );
  }

  // Organization contacts: several staff can link to the same org.
  let orgMsg = '';
  if (org) {
    const ids = idList(org.fields[O.f.discordUserId]);
    if (!ids.includes(interaction.user.id)) {
      await at.update(O.table, org.id, { [O.f.discordUserId]: [...ids, interaction.user.id].join(',') });
    }
    orgMsg = `You're linked to **${org.fields[O.f.organization] || 'your organization'}**. Use \`/roster\` to see which creators signed up for your campaigns.`;
    const orgRec = await at.first(O.table, { formula: `RECORD_ID()=${at.q(org.id)}`, fields: [O.f.proposals] });
    const orgProposals = orgRec?.fields[O.f.proposals] || [];
    if (orgProposals.length) {
      const props = await listByIds(C.table, orgProposals, Object.values(C.f));
      for (const pr of props) if (hasThread(pr.fields) && pr.fields[C.f.status] === C.ACTIVE) await syncCampaignChannel(pr);
    }
  }
  if (!member) return interaction.editReply(orgMsg);

  const existingId = member.fields[M.f.discordUserId];
  if (existingId && existingId !== interaction.user.id) {
    return interaction.editReply(
      'That profile is already linked to a different Discord account. Please message a team member to fix it.'
    );
  }
  const already = await findMemberByDiscordId(interaction.user.id);
  if (already && already.id !== member.id) {
    return interaction.editReply('Your Discord account is already linked to a different profile. Please message a team member to fix it.');
  }
  await at.update(M.table, member.id, { [M.f.discordUserId]: interaction.user.id });

  // Attach any sign-ups they made before linking.
  const orphans = await at.list(K.table, {
    formula: `AND({${K.names.discordUserId}}=${at.q(interaction.user.id)}, {${K.names.creator}}="")`,
    fields: [K.f.title],
  });
  for (const o of orphans) await at.update(K.table, o.id, { [K.f.creator]: [member.id] });

  const savedInvites = await deliverSavedInvites(member.id, interaction.user.id);
  const name = member.fields[M.f.firstName] ? `, ${member.fields[M.f.firstName]}` : '';
  return interaction.editReply(
    `You're linked${name}! ` +
      (orphans.length ? `I attached ${orphans.length} earlier sign-up${orphans.length > 1 ? 's' : ''} to your profile. ` : '') +
      (savedInvites ? `✉️ You have ${savedInvites} campaign invitation${savedInvites > 1 ? 's' : ''} waiting, so check your DMs! ` : '') +
      'Use `/mycampaigns` any time to see what you have signed up for.' +
      (orgMsg ? `\n${orgMsg}` : '')
  );
}

async function handleMyCampaigns(interaction) {
  let rows = await at.list(K.table, {
    formula: `AND({${K.names.discordUserId}}=${at.q(interaction.user.id)}, OR({${K.names.status}}="Committed", {${K.names.status}}="Pending", {${K.names.status}}="Invited"))`,
    fields: [K.f.campaignName, K.f.campaignStatus, K.f.campaignEndDate, K.f.discordMessageId, K.f.creator, K.f.campaignPay, K.f.orgName, K.f.status, K.f.leadContact, K.f.paymentDetails, K.f.paymentStatus, K.f.amountPaid, K.f.paidConfirmedBy, K.f.paymentDueDate],
  });
  const awaiting = rows.filter((r) => r.fields[K.f.status] === 'Pending' && (Array.isArray(r.fields[K.f.campaignStatus]) ? r.fields[K.f.campaignStatus][0] : r.fields[K.f.campaignStatus]) === C.ACTIVE);
  const invitations = rows.filter((r) => r.fields[K.f.status] === 'Invited' && (Array.isArray(r.fields[K.f.campaignStatus]) ? r.fields[K.f.campaignStatus][0] : r.fields[K.f.campaignStatus]) === C.ACTIVE);
  rows = rows.filter((r) => r.fields[K.f.status] === 'Committed');
  if (!rows.length && !awaiting.length && !invitations.length) {
    return interaction.editReply(`You haven't signed up for any campaigns yet. React ${SIGNUP_EMOJI} on a post in <#${CAMPAIGN_CHANNEL_ID}> to join one.`);
  }
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const pay = (r) => {
    const n = Number(first(r.fields[K.f.campaignPay]));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const entry = (r, isActive) => {
    const name = first(r.fields[K.f.campaignName]) || 'Campaign';
    const org = first(r.fields[K.f.orgName]);
    const end = fmtDate(first(r.fields[K.f.campaignEndDate]));
    const key = r.fields[K.f.discordMessageId];
    const link = `https://discord.com/channels/${DISCORD_GUILD_ID}/${CAMPAIGN_CHANNEL_ID}/${key}`;
    const details = [pay(r) ? money(pay(r)) : null, org, end ? `${isActive ? 'ends' : 'ended'} ${end}` : null].filter(Boolean);
    const title = isInviteKey(key) ? `**${name}** ✉️` : `**[${name}](${link})**`;
    const contact = r.fields[K.f.status] === 'Committed' ? String(first(r.fields[K.f.leadContact]) || '').trim() : '';
    const hasPay = r.fields[K.f.status] === 'Committed' && String(first(r.fields[K.f.paymentDetails]) || '').trim();
    const contactLine = contact ? `\n╰ 🤝 ${contact}${hasPay ? ' · 💸 payment details posted' : ''}` : '';
    const payLine = r.fields[K.f.status] === 'Committed' && isPaidCampaignRow(r) ? `\n╰ ${PAY_LABEL[payStatusOf(r)]}${payStatusOf(r) === 'Org says paid' ? ': please confirm below' : ''}` : '';
    return `${title}${details.length ? `\n╰ ${details.join(' · ')}` : ''}${payLine}${contactLine}`;
  };
  const active = rows.filter((r) => first(r.fields[K.f.campaignStatus]) === C.ACTIVE);
  const past = rows.filter((r) => first(r.fields[K.f.campaignStatus]) !== C.ACTIVE);
  const sum = (list) => list.reduce((t, r) => t + pay(r), 0);
  const fit = (list, isActive) => {
    let out = '';
    for (const r of list) {
      const next = (out ? '\n\n' : '') + entry(r, isActive);
      if (out.length + next.length > 1000) return out + `\n\n…and ${list.length - out.split('\n\n').length} more`;
      out += next;
    }
    return out;
  };

  const paidSoFar = rows.filter((r) => r.fields[K.f.paymentStatus] === 'Paid').reduce((t, r) => t + rowAmount(r), 0);
  const summary = [
    sum(rows) ? `💰 **${money(sum(rows))}** expected` : null,
    paidSoFar ? `✅ **${money(paidSoFar)}** paid so far` : null,
    `🟢 **${active.length}** active`,
    `⚪ **${past.length}** past`,
    awaiting.length ? `⏳ **${awaiting.length}** awaiting approval` : null,
    invitations.length ? `✉️ **${invitations.length}** new invitation${invitations.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  const e = new EmbedBuilder()
    .setAuthor({ name: 'CREATOR CONGRESS' })
    .setTitle('📋 Your campaigns')
    .setColor(0x2ecc71)
    .setDescription(summary.join('   ·   '));
  if (active.length) e.addFields({ name: '━━━━  ACTIVE  ━━━━', value: fit(active, true) });
  if (invitations.length) e.addFields({ name: '━━━━  INVITATIONS  ━━━━', value: fit(invitations, true) + '\n_You were personally invited. Accept or pass with the buttons below._' });
  if (awaiting.length) e.addFields({ name: '━━━━  AWAITING APPROVAL  ━━━━', value: fit(awaiting, true) + '\n_The partner reviews these. You\'ll get a DM when you\'re confirmed._' });
  if (past.length) e.addFields({ name: '━━━━  PAST  ━━━━', value: fit(past, false) });
  if (sum(rows) > 0) {
    e.addFields({
      name: '━━━━  EXPECTED PAY  ━━━━',
      value:
        `**${money(sum(rows))}** across all your campaigns` +
        (sum(active) && sum(past) ? `\n${money(sum(active))} active · ${money(sum(past))} past` : '') +
        '\n_Estimate based on campaign rates, not confirmed payments._',
    });
  }
  const unlinked = rows.some((r) => !r.fields[K.f.creator]?.length);
  const notes = [];
  if (unlinked) notes.push('Run /link with your application email to connect these to your profile.');
  if (PORTAL_URL) notes.push(`Also on your member portal: ${PORTAL_URL}`);
  e.setFooter({ text: notes.length ? notes.join(' · ') : 'Only you can see this.' });
  const toConfirm = rows.filter((r) => isPaidCampaignRow(r) && ['Org says paid', 'Payment due'].includes(payStatusOf(r)));
  const components = invitations.slice(0, 5).map((r) => {
    const nm = String((Array.isArray(r.fields[K.f.campaignName]) ? r.fields[K.f.campaignName][0] : r.fields[K.f.campaignName]) || 'invite').slice(0, 40);
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`iv:a:${r.id}`).setLabel(`Accept: ${nm}`.slice(0, 80)).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`iv:d:${r.id}`).setLabel('No thanks').setStyle(ButtonStyle.Secondary)
    );
  });
  for (const r of toConfirm.slice(0, 5 - components.length)) {
    const nm = String(first(r.fields[K.f.campaignName]) || 'campaign').slice(0, 40);
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`py:y:${r.id}`).setLabel(`I got paid: ${nm}`.slice(0, 80)).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`py:n:${r.id}`).setLabel('Not yet').setStyle(ButtonStyle.Secondary)
      )
    );
  }
  return interaction.editReply({ embeds: [e], components });
}

async function listByIds(table, ids, fields) {
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    out.push(...(await at.list(table, { formula: `OR(${chunk.map((id) => `RECORD_ID()=${at.q(id)}`).join(',')})`, fields })));
  }
  return out;
}

async function handleRoster(interaction) {
  const orgs = await findOrgsByDiscordId(interaction.user.id);
  if (!orgs.length) {
    return interaction.editReply(
      "This command is for partner organizations. If you're an org contact, run `/link` with your organization's application email first."
    );
  }
  const proposalIds = [...new Set(orgs.flatMap((o) => o.fields[O.f.proposals] || []))];
  if (!proposalIds.length) {
    return interaction.editReply("Your organization doesn't have any campaigns connected yet. Message a Creator Congress team member if that looks wrong.");
  }
  const proposals = await listByIds(C.table, proposalIds, [C.f.shortName, C.f.status, C.f.discordMessageId, C.f.creatorsNeeded, C.f.creatorPay, C.f.endDate]);
  const messageIds = proposals.map((p) => p.fields[C.f.discordMessageId]).filter(Boolean);

  const signups = new Map(); // messageId -> confirmed rows
  const pendingBy = new Map(); // messageId -> pending rows
  const invitedBy = new Map(); // messageId -> invitations not yet answered
  const passedBy = new Map(); // messageId -> invitations declined
  for (let i = 0; i < messageIds.length; i += 40) {
    const chunk = messageIds.slice(i, i + 40);
    const rows = await at.list(K.table, {
      formula: `AND(OR({${K.names.status}}="Committed", {${K.names.status}}="Pending", {${K.names.status}}="Invited", {${K.names.status}}="Declined invite"), OR(${chunk.map((m) => `{${K.names.discordMessageId}}=${at.q(m)}`).join(',')}))`,
      fields: [K.f.creatorName, K.f.discordUserId, K.f.discordUsername, K.f.discordMessageId, K.f.status, K.f.paymentStatus, K.f.campaignPay, K.f.amountPaid, K.f.campaignEndDate, K.f.campaignStatus],
    });
    for (const r of rows) {
      if (r.fields[K.f.status] === 'Invited' || r.fields[K.f.status] === 'Declined invite') {
        const m = r.fields[K.f.discordMessageId];
        const map = r.fields[K.f.status] === 'Invited' ? invitedBy : passedBy;
        if (!map.has(m)) map.set(m, []);
        map.get(m).push(r);
        continue;
      }
      if (r.fields[K.f.status] === 'Pending') {
        const m = r.fields[K.f.discordMessageId];
        if (!pendingBy.has(m)) pendingBy.set(m, []);
        pendingBy.get(m).push(r);
        continue;
      }
      const m = r.fields[K.f.discordMessageId];
      if (!signups.has(m)) signups.set(m, []);
      signups.get(m).push(r);
    }
  }

  // Active campaigns first, then by most sign-ups.
  const count = (p) => (signups.get(p.fields[C.f.discordMessageId]) || []).length;
  proposals.sort((a, b) => (b.fields[C.f.status] === C.ACTIVE) - (a.fields[C.f.status] === C.ACTIVE) || count(b) - count(a));

  const orgName = orgs.map((o) => o.fields[O.f.organization]).filter(Boolean).join(', ') || 'Your organization';
  const activeCount = proposals.filter((p) => p.fields[C.f.status] === C.ACTIVE).length;
  const totalCreators = new Set([...signups.values()].flat().map((r) => r.fields[K.f.discordUserId])).size;
  const e = new EmbedBuilder()
    .setAuthor({ name: 'CREATOR CONGRESS · PARTNER VIEW' })
    .setTitle(`📊 ${orgName}`.slice(0, 256))
    .setColor(0x5865f2)
    .setDescription(
      `🟢 **${activeCount}** active campaign${activeCount === 1 ? '' : 's'}   ·   👥 **${totalCreators}** creator${totalCreators === 1 ? '' : 's'} confirmed` +
        ([...pendingBy.values()].flat().length ? `   ·   ⏳ **${[...pendingBy.values()].flat().length}** awaiting review` : '')
    );
  // Discord embeds allow 25 fields and ~6000 characters in total.
  let budget = 5300 - e.data.title.length - e.data.description.length;
  const shown = [];
  for (const p of proposals.slice(0, 24)) {
    const name = p.fields[C.f.shortName] || 'Campaign';
    const active = p.fields[C.f.status] === C.ACTIVE;
    const needed = Number(p.fields[C.f.creatorsNeeded]) || 0;
    const rows = signups.get(p.fields[C.f.discordMessageId]) || [];
    const meta = [
      needed ? `${progressBar(rows.length, needed)}  **${rows.length}/${needed}** filled` : `**${rows.length}** signed up`,
      p.fields[C.f.creatorPay] ? `${money(p.fields[C.f.creatorPay])} per creator` : null,
      p.fields[C.f.endDate] ? `${active ? 'ends' : 'ended'} ${fmtDate(p.fields[C.f.endDate])}` : null,
    ].filter(Boolean);
    let list;
    if (!p.fields[C.f.discordMessageId]) list = '_Not posted to Discord yet_';
    else if (!rows.length) list = '_No sign-ups yet_';
    else {
      list = rows
        .map((r) => {
          const nm = (r.fields[K.f.creatorName] || [])[0] || r.fields[K.f.discordUsername] || 'Creator';
          const payMark = isPaidCampaignRow(r) && payStatusOf(r) !== 'Not due yet' ? ` · ${PAY_EMOJI[payStatusOf(r)]}` : '';
          return `› ${nm}${isSnowflake(r.fields[K.f.discordUserId]) ? ` · <@${r.fields[K.f.discordUserId]}>` : ''}${payMark}`;
        })
        .join('\n');
      if (list.length > 800) list = list.slice(0, list.lastIndexOf('\n', 790)) + '\n› …and more (see Airtable)';
    }
    const nm = (r) => (r.fields[K.f.creatorName] || [])[0] || r.fields[K.f.discordUsername] || 'Creator';
    const inv = invitedBy.get(p.fields[C.f.discordMessageId]) || [];
    const passed = passedBy.get(p.fields[C.f.discordMessageId]) || [];
    if (inv.length) list += `\n✉️ **${inv.length} invited, no reply yet:** ${inv.slice(0, 8).map(nm).join(', ')}${inv.length > 8 ? '…' : ''}`;
    if (passed.length) list += `\n👋 **Passed:** ${passed.slice(0, 8).map(nm).join(', ')}${passed.length > 8 ? '…' : ''}`;
    if (isInviteKey(p.fields[C.f.discordMessageId]) && list.startsWith('_No sign-ups yet_')) list = list.replace('_No sign-ups yet_', '_No one has accepted yet_');
    const waiting = pendingBy.get(p.fields[C.f.discordMessageId]) || [];
    if (waiting.length) {
      const names = waiting.map((r) => (r.fields[K.f.creatorName] || [])[0] || r.fields[K.f.discordUsername] || 'Creator');
      list += `\n⏳ **${waiting.length} awaiting your review:** ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}. Run \`/review\``;
    }
    const value = `${meta.join(' · ')}\n${list}`.slice(0, 1024);
    const fieldName = `${active ? '🟢' : '⚪'}  ${name}`.slice(0, 256);
    if (fieldName.length + value.length > budget) break;
    budget -= fieldName.length + value.length;
    e.addFields({ name: fieldName, value });
    shown.push(p);
  }
  e.setFooter({
    text: (proposals.length > shown.length ? `Showing ${shown.length} of ${proposals.length} campaigns · ` : '') + 'Payments: 💸 due · 📤 waiting on creator · ✅ paid · ⚠️ issue. Use /payments to mark creators paid. Only you can see this.',
  });
  return interaction.editReply({ embeds: [e] });
}

async function handleHelp(interaction) {
  const e = new EmbedBuilder()
    .setAuthor({ name: 'CREATOR CONGRESS' })
    .setTitle('📖 How campaigns work')
    .setColor(0x2ecc71)
    .setDescription(`Partner organizations post campaigns in <#${CAMPAIGN_CHANNEL_ID}>. Here's everything you need.`)
    .addFields(
      { name: '1️⃣  Link your account (one time)', value: 'Type `/link your@email.com` using the email you applied with.' },
      { name: `2️⃣  Sign up`, value: `React ${SIGNUP_EMOJI} on any campaign in <#${CAMPAIGN_CHANNEL_ID}>. Remove your reaction to withdraw.` },
      { name: '3️⃣  Track your campaigns', value: 'Type `/mycampaigns` to see what you joined and your expected pay (an estimate, not a confirmed payment).' },
      { name: '🙋  Partner-reviewed campaigns', value: 'Some campaigns are reviewed by the partner. Your ✅ is a request, and you get a DM once you’re confirmed.' },
      { name: '✉️  Invitations', value: 'Some campaigns are invite-only. If you’re invited, you’ll get a DM with Accept / No thanks buttons (also in `/mycampaigns`).' },
      { name: '💸  Getting paid', value: 'Your contact and payment details appear once you’re confirmed. After a partner marks you paid, you’ll get a DM to confirm it arrived. A payment only counts as **Paid** once you confirm it (or 14 days pass with no reply). Not paid? Tap **Not yet** and we’ll follow up.' },
      { name: '🏢  Partner organizations', value: '`/link` with your organization’s application email, `/roster` to see who signed up, `/review` to approve or decline requests, `/invite` to pick suggested creators, and `/payments` to mark creators paid. Payments are due within 30 days of the campaign’s end.' },
      { name: '🔒  Good to know', value: 'Reactions are public. Command replies are private to you. Closed campaigns don’t take sign-ups.' }
    )
    .setFooter({ text: 'Questions? Message a Creator Congress team member.' });
  if (GUIDE_URL) e.addFields({ name: '📄  Full guide', value: `[Read the full how-to guide](${GUIDE_URL})` });
  return interaction.editReply({ embeds: [e] });
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'invite') await handleInviteAutocomplete(interaction).catch((err) => log('autocomplete error', err));
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('py:')) {
    try {
      await handlePayButton(interaction);
    } catch (err) {
      log('payment button error', err);
      const msg = { content: 'Something went wrong on our end. Please try again in a minute.', flags: MessageFlags.Ephemeral };
      (interaction.replied || interaction.deferred ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => {});
    }
    return;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('pym:')) {
    try {
      await handlePayModal(interaction);
    } catch (err) {
      log('payment modal error', err);
      const msg = 'Something went wrong on our end. Please try again in a minute.';
      (interaction.deferred ? interaction.editReply(msg) : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral })).catch(() => {});
    }
    return;
  }
  if (interaction.isButton() && /^(rv|iv|sg):/.test(interaction.customId)) {
    try {
      const kind = interaction.customId.slice(0, 2);
      if (kind === 'rv') await handleReviewButton(interaction);
      if (kind === 'iv') await handleInviteButton(interaction);
      if (kind === 'sg') await handleSuggestionButton(interaction);
    } catch (err) {
      log('review button error', err);
      const msg = { content: 'Something went wrong on our end. Please try again in a minute.', flags: MessageFlags.Ephemeral };
      (interaction.replied || interaction.deferred ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // only the member sees the reply
    if (interaction.commandName === 'link') await handleLink(interaction);
    if (interaction.commandName === 'mycampaigns') await handleMyCampaigns(interaction);
    if (interaction.commandName === 'roster') await handleRoster(interaction);
    if (interaction.commandName === 'help') await handleHelp(interaction);
    if (interaction.commandName === 'review') await handleReview(interaction);
    if (interaction.commandName === 'invite') await handleInviteCommand(interaction);
    if (interaction.commandName === 'payments') await handlePayments(interaction);
  } catch (err) {
    log('command error', err);
    const msg = 'Something went wrong on our end. Please try again in a minute.';
    interaction.deferred ? interaction.editReply(msg).catch(() => {}) : interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// ---------- startup ----------

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    await syncCampaignPosts();
    await normalizeJoinModes();
    await ensurePortalTokens();
    await syncInviteCampaigns();
    await checkStaleRequests();
    await remindInvites();
    await maybeSendWeeklyDigest();
    await ensureOrgTokens();
    await sweepCampaignThreads();
    await paymentTick();
    log('Checked Airtable for campaigns to post/close');
  } catch (err) {
    log('poll error', err);
  } finally {
    polling = false;
  }
}

client.once('clientReady', async () => {
  log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(DISCORD_GUILD_ID);
  log(guild ? `Found server: ${guild.name}` : `WARNING: bot is not in server ${DISCORD_GUILD_ID}. Check DISCORD_GUILD_ID or re-invite the bot.`);
  try {
    const ch = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
    log(`Found campaign channel: #${ch.name}`);
  } catch (err) {
    log(`WARNING: can't open campaign channel ${CAMPAIGN_CHANNEL_ID}: ${err.message}. Check CAMPAIGN_CHANNEL_ID and the bot's channel permissions.`);
  }
  try {
    await new REST().setToken(DISCORD_TOKEN.trim()).put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
    log('Slash commands registered');
  } catch (err) {
    log(`WARNING: couldn't register slash commands: ${err.message}. Check DISCORD_CLIENT_ID and DISCORD_GUILD_ID.`);
  }
  await poll();
  try {
    await reconcileOpenCampaigns();
    log('Reconciled reactions on open campaigns');
  } catch (err) {
    log('reconcile error', err);
  }
  setInterval(poll, Number(POLL_SECONDS) * 1000);
  setInterval(portalTick, 30_000); // portal clicks get handled within ~30 seconds
  portalTick();
});

// ---------- diagnostics ----------
process.on('unhandledRejection', (err) => log('UNHANDLED REJECTION', err));
process.on('uncaughtException', (err) => log('UNCAUGHT EXCEPTION', err));
client.on('error', (err) => log('Discord client error', err));
client.on('warn', (m) => log('Discord warning', m));
client.on('shardDisconnect', (e) => log(`Discord disconnected (code ${e?.code})`));
if (process.env.DEBUG) client.on('debug', (m) => log('[debug]', m));

log('Bot starting…');
startWebServer();
log(
  `Config check: token ${DISCORD_TOKEN.trim().length} chars` +
    (DISCORD_TOKEN !== DISCORD_TOKEN.trim() ? ' (HAS EXTRA SPACES — remove them)' : '') +
    `, client ID ${DISCORD_CLIENT_ID}, server ID ${DISCORD_GUILD_ID}, channel ID ${CAMPAIGN_CHANNEL_ID}`
);
setTimeout(() => {
  if (!client.isReady()) log('Still not connected to Discord after 30s. Check DISCORD_TOKEN, or set DEBUG=1 for details.');
}, 30_000);

client
  .login(DISCORD_TOKEN.trim())
  .then(() => log('Discord login accepted, waiting for ready…'))
  .catch((err) => {
    log('DISCORD LOGIN FAILED:', err.code || '', err.message);
    process.exit(1);
  });
