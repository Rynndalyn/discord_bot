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
} from 'discord.js';
import * as at from './airtable.js';
import { CAMPAIGNS as C, MEMBERS as M, COMMITMENTS as K, ORGS as O } from './schema.js';

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
  CAMPAIGN_CATEGORY = 'Active Campaigns',
  ARCHIVE_CATEGORY = 'Archived Campaigns',
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

function campaignInfo(rec) {
  return {
    id: rec.id,
    name: rec.fields[C.f.shortName] || 'Campaign',
    closed: rec.fields[C.f.status] !== C.ACTIVE,
    approval: !!rec.fields[C.f.requiresApproval],
    org: (rec.fields[C.f.orgName] || [])[0] || 'the partner organization',
  };
}

async function getCampaignForMessage(messageId) {
  if (campaignByMessage.has(messageId)) return campaignByMessage.get(messageId);
  const rec = await at.first(C.table, {
    formula: `{${C.names.discordMessageId}}=${at.q(messageId)}`,
    fields: [C.f.shortName, C.f.status, C.f.discordClosed, C.f.requiresApproval, C.f.orgName],
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

function buildEmbed(fields, { closed = false } = {}) {
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
    .setAuthor({ name: closed ? '⚪  CAMPAIGN CLOSED' : '🟢  OPEN CAMPAIGN' })
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
  if (fields[C.f.requiresApproval] && !closed) {
    e.addFields({ name: '🙋 Partner-reviewed', value: `${org || 'The partner'} reviews each sign-up. React to request a spot, and you'll get a DM once you're confirmed.` });
  }
  if (fields[C.f.longTerm] && !closed) {
    e.addFields({ name: '🔒 Long-term campaign', value: 'Signing up adds you to a private channel for this campaign with the partner team.' });
  }

  e.addFields({
    name: '​',
    value: closed
      ? '**Sign-ups are closed.** Thanks to everyone who joined!'
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
        const channel = await client.channels.fetch(CAMPAIGN_CHANNEL_ID);
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ embeds: [buildEmbed(rec.fields, { closed: rec.fields[C.f.status] !== C.ACTIVE })] });
        if (rec.fields[C.f.longTerm]) await syncCampaignChannel(rec);
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
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.postToDiscord}}, {${C.names.discordMessageId}}="")`,
    fields: campaignFields,
  });
  for (const rec of toPost) {
    const msg = await channel.send({ embeds: [buildEmbed(rec.fields)] });
    await msg.react(SIGNUP_EMOJI);
    await at.update(C.table, rec.id, { [C.f.discordMessageId]: msg.id, [C.f.discordClosed]: false });
    campaignByMessage.set(msg.id, campaignInfo(rec));
    log(`Posted campaign ${rec.id} as message ${msg.id}`);
    if (rec.fields[C.f.longTerm]) await syncCampaignChannel({ ...rec, fields: { ...rec.fields, [C.f.discordMessageId]: msg.id } });
  }

  // 1b) Long-term box checked after the campaign was already posted → create its channel
  const needChannel = await at.list(C.table, {
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.longTerm}}, {${C.names.discordMessageId}}!="", {${C.names.channelId}}="")`,
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
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ embeds: [buildEmbed(rec.fields, { closed })] });
  } catch (err) {
    log(`Could not edit message ${messageId} for ${rec.id} (deleted?): ${err.message}`);
  }
  await at.update(C.table, rec.id, { [C.f.discordClosed]: closed });
  campaignByMessage.set(messageId, { ...campaignInfo(rec), closed });
  log(`${closed ? 'Closed' : 'Re-opened'} campaign ${rec.id}`);
  if (rec.fields[C.f.longTerm]) await syncCampaignChannel({ ...rec, fields: { ...rec.fields, [C.f.status]: closed ? 'closed' : C.ACTIVE } });
}

// ---------- long-term campaigns: private channel per campaign ----------

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
const POST = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];

const channelSyncs = new Map(); // campaignId -> promise, so one sync runs at a time per campaign
function syncCampaignChannel(rec) {
  const prev = channelSyncs.get(rec.id) || Promise.resolve();
  const next = prev.then(() => doSyncCampaignChannel(rec)).catch((err) => log(`Channel sync failed for ${rec.id}: ${err.message}`));
  channelSyncs.set(rec.id, next);
  return next;
}

async function doSyncCampaignChannel(rec) {
  const f = rec.fields;
  if (!f[C.f.longTerm] || !f[C.f.discordMessageId]) return;
  const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
  const closed = f[C.f.status] !== C.ACTIVE;
  const name = f[C.f.shortName] || 'Campaign';

  // Re-read the channel ID from Airtable in case an earlier sync just created it.
  const fresh = await at.first(C.table, { formula: `RECORD_ID()=${at.q(rec.id)}`, fields: [C.f.channelId] });
  const channelId = fresh?.fields[C.f.channelId] || f[C.f.channelId];
  let channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  const isNew = !channel;
  if (!channel) {
    if (closed) return; // never create a channel for a closed campaign
    const parent = await ensureCategory(guild, CAMPAIGN_CATEGORY);
    channel = await guild.channels.create({
      name: slug(name),
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: `Private space for "${name}". Everyone who signs up is added automatically.`.slice(0, 1024),
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: client.user.id, allow: [...VIEW, ...POST, PermissionFlagsBits.ManageChannels] },
      ],
    });
    await at.update(C.table, rec.id, { [C.f.channelId]: channel.id });
    log(`Created channel #${channel.name} for ${rec.id}`);
  }

  // Who belongs: committed creators + the partner org's linked contacts (+ staff role).
  const signups = await at.list(K.table, {
    formula: `AND({${K.names.discordMessageId}}=${at.q(f[C.f.discordMessageId])}, {${K.names.status}}="Committed")`,
    fields: [K.f.discordUserId],
  });
  const creatorIds = new Set(signups.map((r) => r.fields[K.f.discordUserId]).filter(isSnowflake));
  const orgIds = new Set();
  const orgLinks = f[C.f.orgLinks] || [];
  if (orgLinks.length) {
    const orgs = await listByIds(O.table, orgLinks, [O.f.discordUserId]);
    orgs.forEach((o) => idList(o.fields[O.f.discordUserId]).filter(isSnowflake).forEach((id) => orgIds.add(id)));
  }

  const memberPerms = closed ? { allow: VIEW, deny: POST } : { allow: [...VIEW, ...POST] };
  const desired = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: client.user.id, allow: [...VIEW, ...POST, PermissionFlagsBits.ManageChannels] },
  ];
  if (STAFF_ROLE_ID) desired.push({ id: STAFF_ROLE_ID, allow: [...VIEW, ...POST] });
  const members = [...new Set([...creatorIds, ...orgIds])];
  for (const id of members) desired.push({ id, ...memberPerms });

  const before = new Set(channel.permissionOverwrites.cache.filter((o) => o.type === 1).map((o) => o.id)); // 1 = member overwrite
  await channel.permissionOverwrites.set(desired);

  // Keep it in the right category: Active vs Archived.
  const wantParent = await ensureCategory(guild, closed ? ARCHIVE_CATEGORY : CAMPAIGN_CATEGORY);
  if (channel.parentId !== wantParent.id) {
    await channel.setParent(wantParent.id, { lockPermissions: false });
    await channel.permissionOverwrites.set(desired);
    if (!isNew) await channel.send(
      closed
        ? '📦 This campaign is now closed. The channel is archived and read-only. Thanks, everyone!'
        : '🔓 This campaign has been reopened. Welcome back!'
    );
  }

  if (isNew) {
    const postLink = `https://discord.com/channels/${DISCORD_GUILD_ID}/${CAMPAIGN_CHANNEL_ID}/${f[C.f.discordMessageId]}`;
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`👋 Welcome to ${name}`.slice(0, 256))
          .setColor(0x2ecc71)
          .setDescription(
            `This is the private channel for this long-term campaign. [See the campaign post](${postLink}).\n\n` +
              'Creators who sign up are added here automatically, along with the partner organization and the Creator Congress team. ' +
              'Removing your sign-up removes you from this channel.'
          ),
      ],
    });
  }
  const newcomers = members.filter((id) => !before.has(id));
  if (!closed && newcomers.length) {
    await channel.send(`👋 Welcome ${newcomers.map((id) => `<@${id}>`).join(' ')}!`);
  }
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
  return campaign ? { campaign, messageId: reaction.message.id } : null;
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
    } else if (linkNote) {
      await dm(user, `Thanks for signing up for **${hit.campaign.name}**! We've recorded it.${linkNote}`);
    }
  } catch (err) {
    log('reactionAdd error', err);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    const hit = await resolveReaction(reaction, user);
    if (!hit || hit.campaign.closed) return; // removals on closed posts (incl. our own cleanup) don't withdraw
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
    fields: [C.f.shortName, C.f.discordMessageId, C.f.status, C.f.requiresApproval, C.f.orgName],
  });
  for (const rec of open) {
    const messageId = rec.fields[C.f.discordMessageId];
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
      fields: [K.f.discordUserId],
    });
    const recordedIds = new Set(recorded.map((r) => r.fields[K.f.discordUserId]));
    for (const [id, u] of reactors) {
      if (recordedIds.has(id)) continue;
      const res = await commit(u, messageId, campaign);
      if (res.declined) await reaction.users.remove(id).catch(() => {});
    }
    for (const r of recorded) {
      const uid = r.fields[K.f.discordUserId];
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
    ? await at.first(C.table, { formula: `RECORD_ID()=${at.q(campaignId)}`, fields: [C.f.shortName, C.f.orgName, C.f.orgLinks, C.f.longTerm, C.f.channelId, C.f.discordMessageId] })
    : null;
  const creatorId = (req.fields[K.f.creator] || [])[0];
  const creator = creatorId
    ? await at.first(M.table, {
        formula: `RECORD_ID()=${at.q(creatorId)}`,
        fields: [M.f.fullName, M.f.reach, M.f.tiktok, M.f.instagram, M.f.youtube, M.f.issues, M.f.about],
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
        `Discord: <@${req.fields[K.f.discordUserId]}>`,
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
  log(`Review request ${recordId} sent to ${delivered} org contact(s)${reminder ? ' (reminder)' : ''}`);
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
  await at.update(K.table, req.id, {
    [K.f.status]: approve ? 'Committed' : 'Declined',
    ...(approve ? { [K.f.committedAt]: now() } : {}),
    [K.f.reviewedBy]: reviewer,
    [K.f.reviewedAt]: now(),
  });
  const campName = camp.fields[C.f.shortName] || 'the campaign';
  const messageId = req.fields[K.f.discordMessageId];
  const creatorUser = await client.users.fetch(req.fields[K.f.discordUserId]).catch(() => null);

  if (approve) {
    const channelNote = camp.fields[C.f.longTerm] ? ' You’ll be added to the campaign’s private channel in a moment.' : '';
    if (creatorUser) await dm(creatorUser, `🎉 You're in! You've been confirmed for **${campName}**.${channelNote} The Creator Congress team will follow up with next steps.`);
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

  const done = EmbedBuilder.from(interaction.message.embeds[0])
    .setAuthor({ name: approve ? `✅  APPROVED by ${reviewer}` : `✖️  DECLINED by ${reviewer}` })
    .setColor(approve ? 0x2ecc71 : 0x4f545c)
    .setFooter({ text: approve ? 'The creator has been notified and added.' : 'The creator was sent a kind, private note. No reason was shared.' });
  log(`${approve ? 'Approved' : 'Declined'} ${req.id} by ${reviewer}`);
  return interaction.update({ embeds: [done], components: [] });
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

// ---------- slash commands ----------

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Connect your Discord account to your Creator Congress or organization profile')
    .addStringOption((o) => o.setName('email').setDescription('The email you applied with').setRequired(true)),
  new SlashCommandBuilder().setName('mycampaigns').setDescription('See the campaigns you have signed up for and your expected pay'),
  new SlashCommandBuilder().setName('roster').setDescription('For organizations: see which creators signed up for your campaigns'),
  new SlashCommandBuilder().setName('review').setDescription('For organizations: approve or decline creators who asked to join your campaigns'),
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
      for (const pr of props) if (pr.fields[C.f.longTerm] && pr.fields[C.f.status] === C.ACTIVE) await syncCampaignChannel(pr);
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

  const name = member.fields[M.f.firstName] ? `, ${member.fields[M.f.firstName]}` : '';
  return interaction.editReply(
    `You're linked${name}! ` +
      (orphans.length ? `I attached ${orphans.length} earlier sign-up${orphans.length > 1 ? 's' : ''} to your profile. ` : '') +
      'Use `/mycampaigns` any time to see what you have signed up for.' +
      (orgMsg ? `\n${orgMsg}` : '')
  );
}

async function handleMyCampaigns(interaction) {
  let rows = await at.list(K.table, {
    formula: `AND({${K.names.discordUserId}}=${at.q(interaction.user.id)}, OR({${K.names.status}}="Committed", {${K.names.status}}="Pending"))`,
    fields: [K.f.campaignName, K.f.campaignStatus, K.f.campaignEndDate, K.f.discordMessageId, K.f.creator, K.f.campaignPay, K.f.orgName, K.f.status],
  });
  const awaiting = rows.filter((r) => r.fields[K.f.status] === 'Pending' && (Array.isArray(r.fields[K.f.campaignStatus]) ? r.fields[K.f.campaignStatus][0] : r.fields[K.f.campaignStatus]) === C.ACTIVE);
  rows = rows.filter((r) => r.fields[K.f.status] === 'Committed');
  if (!rows.length && !awaiting.length) {
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
    const link = `https://discord.com/channels/${DISCORD_GUILD_ID}/${CAMPAIGN_CHANNEL_ID}/${r.fields[K.f.discordMessageId]}`;
    const details = [pay(r) ? money(pay(r)) : null, org, end ? `${isActive ? 'ends' : 'ended'} ${end}` : null].filter(Boolean);
    return `**[${name}](${link})**${details.length ? `\n╰ ${details.join(' · ')}` : ''}`;
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

  const summary = [
    sum(rows) ? `💰 **${money(sum(rows))}** expected` : null,
    `🟢 **${active.length}** active`,
    `⚪ **${past.length}** past`,
    awaiting.length ? `⏳ **${awaiting.length}** awaiting approval` : null,
  ].filter(Boolean);
  const e = new EmbedBuilder()
    .setAuthor({ name: 'CREATOR CONGRESS' })
    .setTitle('📋 Your campaigns')
    .setColor(0x2ecc71)
    .setDescription(summary.join('   ·   '));
  if (active.length) e.addFields({ name: '━━━━  ACTIVE  ━━━━', value: fit(active, true) });
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
  return interaction.editReply({ embeds: [e] });
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
  for (let i = 0; i < messageIds.length; i += 40) {
    const chunk = messageIds.slice(i, i + 40);
    const rows = await at.list(K.table, {
      formula: `AND(OR({${K.names.status}}="Committed", {${K.names.status}}="Pending"), OR(${chunk.map((m) => `{${K.names.discordMessageId}}=${at.q(m)}`).join(',')}))`,
      fields: [K.f.creatorName, K.f.discordUserId, K.f.discordUsername, K.f.discordMessageId, K.f.status],
    });
    for (const r of rows) {
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
          return `› ${nm} · <@${r.fields[K.f.discordUserId]}>`;
        })
        .join('\n');
      if (list.length > 800) list = list.slice(0, list.lastIndexOf('\n', 790)) + '\n› …and more (see Airtable)';
    }
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
    text: (proposals.length > shown.length ? `Showing ${shown.length} of ${proposals.length} campaigns · ` : '') + 'Only you can see this.',
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
      { name: '🏢  Partner organizations', value: '`/link` with your organization’s application email, `/roster` to see who signed up, and `/review` to approve or decline requests.' },
      { name: '🔒  Good to know', value: 'Reactions are public. Command replies are private to you. Closed campaigns don’t take sign-ups.' }
    )
    .setFooter({ text: 'Questions? Message a Creator Congress team member.' });
  if (GUIDE_URL) e.addFields({ name: '📄  Full guide', value: `[Read the full how-to guide](${GUIDE_URL})` });
  return interaction.editReply({ embeds: [e] });
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('rv:')) {
    try {
      await handleReviewButton(interaction);
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
    await checkStaleRequests();
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
});

// ---------- diagnostics ----------
process.on('unhandledRejection', (err) => log('UNHANDLED REJECTION', err));
process.on('uncaughtException', (err) => log('UNCAUGHT EXCEPTION', err));
client.on('error', (err) => log('Discord client error', err));
client.on('warn', (m) => log('Discord warning', m));
client.on('shardDisconnect', (e) => log(`Discord disconnected (code ${e?.code})`));
if (process.env.DEBUG) client.on('debug', (m) => log('[debug]', m));

log('Bot starting…');
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
