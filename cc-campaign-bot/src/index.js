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
import { CAMPAIGNS as C, MEMBERS as M, COMMITMENTS as K, ORGS as O } from './schema.js';

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
    log(`Could not edit message ${messageId} for ${rec.id} (deleted?): ${err.message}`);
  }
  await at.update(C.table, rec.id, { [C.f.discordClosed]: closed });
  campaignByMessage.set(messageId, { id: rec.id, name: rec.fields[C.f.shortName] || 'Campaign', closed });
  log(`${closed ? 'Closed' : 'Re-opened'} campaign ${rec.id}`);
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
  const fields = {
    [K.f.title]: `${memberName} → ${campaign.name}`,
    [K.f.campaign]: [campaign.id],
    [K.f.status]: 'Committed',
    [K.f.committedAt]: now(),
    [K.f.withdrawnAt]: null,
    [K.f.discordUserId]: user.id,
    [K.f.discordUsername]: user.username,
    [K.f.discordMessageId]: messageId,
  };
  if (member) fields[K.f.creator] = [member.id];

  if (existing) {
    if (existing.fields[K.f.status] === 'Committed') return { member, changed: false };
    await at.update(K.table, existing.id, fields);
  } else {
    await at.create(K.table, fields);
  }
  log(`Committed: ${user.username} (${user.id}) → ${campaign.name}`);
  scheduleRefresh(messageId, campaign.id);
  return { member, changed: true };
}

async function withdraw(user, messageId, campaign) {
  const existing = await findCommitment(user.id, messageId);
  if (!existing || existing.fields[K.f.status] === 'Withdrawn') return false;
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
    const { member, changed } = await commit(user, hit.messageId, hit.campaign);
    if (changed && !member && (await isFirstSignup(user.id))) {
      await dm(
        user,
        `Thanks for signing up for **${hit.campaign.name}**! We've recorded it, but your Discord account isn't linked to your Creator Congress profile yet. ` +
          'Run `/link` with the email you applied with, in the server, so this shows up on your profile.'
      );
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
    fields: [C.f.shortName, C.f.discordMessageId],
  });
  for (const rec of open) {
    const messageId = rec.fields[C.f.discordMessageId];
    const campaign = { id: rec.id, name: rec.fields[C.f.shortName] || 'Campaign', closed: false };
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
      formula: `AND({${K.names.discordMessageId}}=${at.q(messageId)}, {${K.names.status}}="Committed")`,
      fields: [K.f.discordUserId],
    });
    const recordedIds = new Set(recorded.map((r) => r.fields[K.f.discordUserId]));
    for (const [id, u] of reactors) if (!recordedIds.has(id)) await commit(u, messageId, campaign);
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

// ---------- slash commands ----------

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Connect your Discord account to your Creator Congress or organization profile')
    .addStringOption((o) => o.setName('email').setDescription('The email you applied with').setRequired(true)),
  new SlashCommandBuilder().setName('mycampaigns').setDescription('See the campaigns you have signed up for and your expected pay'),
  new SlashCommandBuilder().setName('roster').setDescription('For organizations: see which creators signed up for your campaigns'),
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
  const rows = await at.list(K.table, {
    formula: `AND({${K.names.discordUserId}}=${at.q(interaction.user.id)}, {${K.names.status}}="Committed")`,
    fields: [K.f.campaignName, K.f.campaignStatus, K.f.campaignEndDate, K.f.discordMessageId, K.f.creator, K.f.campaignPay, K.f.orgName],
  });
  if (!rows.length) {
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
  ].filter(Boolean);
  const e = new EmbedBuilder()
    .setAuthor({ name: 'CREATOR CONGRESS' })
    .setTitle('📋 Your campaigns')
    .setColor(0x2ecc71)
    .setDescription(summary.join('   ·   '));
  if (active.length) e.addFields({ name: '━━━━  ACTIVE  ━━━━', value: fit(active, true) });
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

  const signups = new Map(); // messageId -> rows
  for (let i = 0; i < messageIds.length; i += 40) {
    const chunk = messageIds.slice(i, i + 40);
    const rows = await at.list(K.table, {
      formula: `AND({${K.names.status}}="Committed", OR(${chunk.map((m) => `{${K.names.discordMessageId}}=${at.q(m)}`).join(',')}))`,
      fields: [K.f.creatorName, K.f.discordUserId, K.f.discordUsername, K.f.discordMessageId],
    });
    for (const r of rows) {
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
    .setDescription(`🟢 **${activeCount}** active campaign${activeCount === 1 ? '' : 's'}   ·   👥 **${totalCreators}** creator${totalCreators === 1 ? '' : 's'} signed up`);
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

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // only the member sees the reply
    if (interaction.commandName === 'link') await handleLink(interaction);
    if (interaction.commandName === 'mycampaigns') await handleMyCampaigns(interaction);
    if (interaction.commandName === 'roster') await handleRoster(interaction);
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
