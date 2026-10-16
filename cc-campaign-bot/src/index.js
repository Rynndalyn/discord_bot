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
  if (fields[C.f.longTerm] && !closed) {
    e.addFields({ name: '🔒 Long-term campaign', value: 'Signing up adds you to a private channel for this campaign with the partner team.' });
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
    formula: `AND({${C.names.status}}=${at.q(C.ACTIVE)}, {${C.names.postToDiscord}}, {${C.names.discordMessageId}}="", {${C.names.joinMode}}!="Invite-only")`,
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
            `This is the private channel for this long-term campaign.${isInviteKey(f[C.f.discordMessageId]) ? '' : ` [See the campaign post](${postLink}).`}\n\n` +
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
      if (['Web page', 'Invitation', 'Portal'].includes(r.fields[K.f.joinedVia])) continue; // joined outside Discord
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
  const creatorUser = isSnowflake(req.fields[K.f.discordUserId]) ? await client.users.fetch(req.fields[K.f.discordUserId]).catch(() => null) : null;

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
  const cid = (req.fields[K.f.creator] || [])[0];
  if (cid) {
    const contact = await at.first(M.table, { formula: `RECORD_ID()=${at.q(cid)}`, fields: CREATOR_CONTACT_FIELDS() });
    if (contact) await emailDecision(contact, campName, approve, !!camp.fields[C.f.longTerm]).catch((err) => log('email error', err));
  }

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
  const row = await at.first(K.table, { formula: `RECORD_ID()=${at.q(rowId)}`, fields: [K.f.status, K.f.discordUserId, K.f.campaign, K.f.discordMessageId] });
  if (!row) return interaction.reply({ content: 'This invitation no longer exists.', flags: MessageFlags.Ephemeral });
  if (row.fields[K.f.discordUserId] !== interaction.user.id) return interaction.reply({ content: 'This invitation is for someone else.', flags: MessageFlags.Ephemeral });
  const campaignId = (row.fields[K.f.campaign] || [])[0];
  const camp = await at.first(C.table, { formula: `RECORD_ID()=${at.q(campaignId)}`, fields: [C.f.shortName, C.f.status, C.f.longTerm] });
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
  const base = interaction.message.embeds[0] ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder().setTitle(name);
  base
    .setAuthor({ name: accept ? '✅  YOU’RE IN' : '👋  NO THANKS SENT' })
    .setColor(accept ? 0x2ecc71 : 0x4f545c)
    .setFooter({
      text: accept
        ? `Confirmed! The Creator Congress team will follow up with next steps.${camp?.fields[C.f.longTerm] ? ' You’ll be added to the private campaign channel in a moment.' : ''}`
        : 'Thanks for letting us know. This won’t affect future invitations.',
    });
  return interaction.update({ embeds: [base], components: [] });
}

// Org (or staff) picks from the bot's suggestions in Discord.
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

  const picks = [];
  for (const p of campaigns) {
    const invited = new Set(p.fields[C.f.invited] || []);
    for (const id of p.fields[C.f.suggested] || []) if (!invited.has(id)) picks.push({ p, id });
  }
  if (!picks.length) {
    const names = campaigns.map((p) => `**${p.fields[C.f.shortName]}** (${(p.fields[C.f.invited] || []).length} invited)`).join(', ');
    return interaction.editReply(`No new suggestions right now for ${names}. Use \`/roster\` to see who has responded.`);
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
    content: `**${picks.length}** suggested creator${picks.length === 1 ? '' : 's'} to consider, best matches first.${picks.length > 5 ? ' Showing 5. Run `/invite` again for more.' : ''}`,
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

async function emailDecision(creator, campaignName, approved, longTerm) {
  const cf = creator.fields;
  return queueEmail({
    creator,
    kind: approved ? 'Confirmed' : 'Not selected',
    subject: approved ? `You're in: ${campaignName}` : `Update on ${campaignName}`,
    body: approved
      ? `${hi(cf)}\n\nGood news: you've been confirmed for **${campaignName}**! The Creator Congress team will follow up with next steps.` +
        (longTerm ? '\n\nThis campaign coordinates in a private Discord channel. If you’re not on Discord, the team will help you get set up or keep you updated by email.' : '') +
        pageLine(cf)
      : `${hi(cf)}\n\nThanks so much for your interest in **${campaignName}**. The partner wasn't able to bring you on for this one, but that's no reflection on your work. Partners often have very specific needs for each campaign.\n\nThere are always more opportunities coming. We'd love to see you on the next one!` +
        pageLine(cf),
  });
}

// Every approved creator gets a private page token + link (needs PUBLIC_URL).
async function ensurePortalTokens() {
  if (!PUBLIC_URL) return;
  const rows = await at.list(M.table, {
    formula: `AND({${M.names.approved}}, {${M.names.portalToken}}="")`,
    fields: CREATOR_CONTACT_FIELDS(),
    maxRecords: 50,
  });
  for (const r of rows) {
    const token = randomBytes(16).toString('hex');
    const link = `${PUBLIC_URL.replace(/\/$/, '')}/c/${token}`;
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
  else scheduleRefresh(key, camp.id);
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
  const camp = await at.first(C.table, { formula: `RECORD_ID()=${at.q(campaignId)}`, fields: [C.f.shortName, C.f.status, C.f.longTerm] });
  if (row.fields[K.f.status] !== 'Invited') return { result: 'answered', row, camp };
  if (camp?.fields[C.f.status] !== C.ACTIVE) return { result: 'closed', row, camp };
  await at.update(K.table, row.id, {
    [K.f.status]: accept ? 'Committed' : 'Declined invite',
    ...(accept ? { [K.f.committedAt]: now() } : {}),
    [K.f.reviewedAt]: now(),
  });
  scheduleRefresh(row.fields[K.f.discordMessageId], campaignId);
  log(`Invite ${row.id} ${accept ? 'accepted' : 'declined'}`);
  return { result: accept ? 'accepted' : 'passed', row, camp };
}

// ---- the page ----

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PAGE_CSS = `
:root{--bg:#f6f7f4;--card:#fff;--ink:#1d2320;--muted:#5d6762;--line:#e3e6e1;--accent:#1f7a4d;--accent-ink:#fff;--soft:#e8f3ec;--warn:#8a5a00;--warn-soft:#fbf1dc;--violet:#5b3fa6;--violet-soft:#efeafb}
@media (prefers-color-scheme:dark){:root{--bg:#121513;--card:#1b1f1c;--ink:#ecefeb;--muted:#a3ada7;--line:#2c322e;--accent:#4cc38a;--accent-ink:#0d1a12;--soft:#1f3329;--warn:#f0c46b;--warn-soft:#3a2f17;--violet:#b9a4f2;--violet-soft:#2a2340}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px 64px}
header h1{font-size:26px;margin:4px 0 2px}header p{margin:0;color:var(--muted)}
.brand{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 8px}.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:14px}.stat b{font-size:18px;display:block}
h2{font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:32px 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 12px}
.card h3{margin:0 0 2px;font-size:18px}.org{color:var(--muted);font-size:14px;margin:0 0 10px}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;margin:8px 0}.meta span{white-space:nowrap}
.bar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin:4px 0 8px;max-width:220px}.bar i{display:block;height:100%;background:var(--accent)}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--muted)}
details{margin:6px 0 10px;font-size:14px;color:var(--muted)}details summary{cursor:pointer;color:var(--ink)}details p{white-space:pre-wrap}
.note{font-size:13px;border-radius:8px;padding:6px 10px;margin:8px 0;background:var(--warn-soft);color:var(--warn)}
.note.violet{background:var(--violet-soft);color:var(--violet)}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}form{margin:0}
button{font:inherit;font-weight:600;border-radius:8px;padding:9px 16px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}button:disabled{opacity:.55;cursor:default}
.pill{font-size:13px;font-weight:600;border-radius:999px;padding:4px 10px;background:var(--soft);color:var(--accent)}
.pill.wait{background:var(--warn-soft);color:var(--warn)}.pill.gray{background:var(--line);color:var(--muted)}
.flash{border-radius:10px;padding:12px 14px;margin:16px 0;background:var(--soft);color:var(--ink);border:1px solid var(--line)}
.empty{color:var(--muted);font-size:15px}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
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
  ${f[C.f.longTerm] ? `<div class="note violet">🔒 Long-term: this campaign coordinates in a private Discord channel. Not on Discord? The team will keep you posted by email.</div>` : ''}
  <div class="actions">${actions}</div>
</div>`;
}

const FLASH = {
  joined: "🎉 You're in! The Creator Congress team will follow up with next steps.",
  requested: "🙋 Request sent! The partner reviews each sign-up and you'll get an email once you're confirmed.",
  left: "You've left the campaign. You can rejoin anytime while it's open.",
  accepted: "🎉 You've accepted the invitation and you're confirmed! The team will follow up with next steps.",
  passed: "Thanks for letting us know. This won't affect future invitations.",
  already: "You're already signed up for that one.",
  declined: "The partner has already made a decision on your request for this campaign.",
  full: 'Sorry, that campaign just filled up.',
  closed: 'That campaign has closed.',
  answered: "You've already responded to that invitation.",
};

async function renderCreatorPage(creator, token, flash) {
  const cf = creator.fields;
  const mine = (cf[M.f.commitments] || []).length
    ? await listByIds(K.table, cf[M.f.commitments], [K.f.status, K.f.campaign, K.f.discordMessageId, K.f.discordUserId, K.f.campaignPay])
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
  const joinedIds = new Set(activeMine.map((x) => x.p.id));
  const browse = open.filter((p) => !joinedIds.has(p.id));

  const firstName = cf[M.f.firstName] || String(cf[M.f.fullName] || '').split(' ')[0] || 'there';
  const section = (title, html) => `<h2>${title}</h2>${html}`;
  const body = `
<header><div class="brand">Creator Congress</div><h1>Hi ${esc(firstName)} 👋</h1><p>Your campaigns, invitations and expected pay, all in one place.</p></header>
${flash && FLASH[flash] ? `<div class="flash">${esc(FLASH[flash])}</div>` : ''}
<div class="stats">
  <div class="stat"><b>${esc(money(expected) || '$0')}</b>expected pay</div>
  <div class="stat"><b>${activeMine.length}</b>active</div>
  ${pendingMine ? `<div class="stat"><b>${pendingMine}</b>awaiting approval</div>` : ''}
  ${invites.length ? `<div class="stat"><b>${invites.length}</b>invitation${invites.length === 1 ? '' : 's'}</div>` : ''}
</div>
${invites.length ? section('✉️ Your invitations', invites.map((x) => campaignCard(x.p, { inviteRow: x.r, token })).join('')) : ''}
${section('Open campaigns', browse.length ? browse.map((p) => campaignCard(p, { mineRow: rowFor(p), token })).join('') : '<p class="empty">No open campaigns right now. We’ll email you when new ones are posted.</p>')}
${activeMine.length ? section('Your active campaigns', activeMine.map((x) => campaignCard(x.p, { mineRow: x.r, token })).join('')) : ''}
${pastMine.length ? section('Past campaigns', `<div class="card">${pastMine.map((x) => `<div>✓ <b>${esc(x.p.fields[C.f.shortName])}</b>${payOf(x) ? ` · ${esc(money(payOf(x)))}` : ''}</div>`).join('')}</div>`) : ''}
<footer>Expected pay is an estimate based on campaign rates, not a confirmed payment. This page is private to you, so please don't share the link. Prefer Discord? Join our server and use <b>/link</b> with this email. Questions? Reply to any Creator Congress email.</footer>`;
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
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><div class="wrap"><div class="brand">Creator Congress</div><h1>${esc(title)}</h1><p>${esc(msg)}</p></div></body></html>`;

  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
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
  joined: ["Done", "You're in! The Creator Congress team will follow up with next steps."],
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

// ---------- slash commands ----------

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Connect your Discord account to your Creator Congress or organization profile')
    .addStringOption((o) => o.setName('email').setDescription('The email you applied with').setRequired(true)),
  new SlashCommandBuilder().setName('mycampaigns').setDescription('See the campaigns you have signed up for and your expected pay'),
  new SlashCommandBuilder().setName('roster').setDescription('For organizations: see which creators signed up for your campaigns'),
  new SlashCommandBuilder().setName('review').setDescription('For organizations: approve or decline creators who asked to join your campaigns'),
  new SlashCommandBuilder().setName('invite').setDescription('For organizations: pick suggested creators to invite to your invite-only campaigns'),
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
    fields: [K.f.campaignName, K.f.campaignStatus, K.f.campaignEndDate, K.f.discordMessageId, K.f.creator, K.f.campaignPay, K.f.orgName, K.f.status],
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
    return `${title}${details.length ? `\n╰ ${details.join(' · ')}` : ''}`;
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
  const components = invitations.slice(0, 5).map((r) => {
    const nm = String((Array.isArray(r.fields[K.f.campaignName]) ? r.fields[K.f.campaignName][0] : r.fields[K.f.campaignName]) || 'invite').slice(0, 40);
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`iv:a:${r.id}`).setLabel(`Accept: ${nm}`.slice(0, 80)).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`iv:d:${r.id}`).setLabel('No thanks').setStyle(ButtonStyle.Secondary)
    );
  });
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
      fields: [K.f.creatorName, K.f.discordUserId, K.f.discordUsername, K.f.discordMessageId, K.f.status],
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
          return `› ${nm} · <@${r.fields[K.f.discordUserId]}>`;
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
      { name: '✉️  Invitations', value: 'Some campaigns are invite-only. If you’re invited, you’ll get a DM with Accept / No thanks buttons (also in `/mycampaigns`).' },
      { name: '🏢  Partner organizations', value: '`/link` with your organization’s application email, `/roster` to see who signed up, and `/review` to approve or decline requests, `/invite` to pick suggested creators for invite-only campaigns.' },
      { name: '🔒  Good to know', value: 'Reactions are public. Command replies are private to you. Closed campaigns don’t take sign-ups.' }
    )
    .setFooter({ text: 'Questions? Message a Creator Congress team member.' });
  if (GUIDE_URL) e.addFields({ name: '📄  Full guide', value: `[Read the full how-to guide](${GUIDE_URL})` });
  return interaction.editReply({ embeds: [e] });
}

client.on('interactionCreate', async (interaction) => {
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
