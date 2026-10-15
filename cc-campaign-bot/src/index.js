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
    .setDescription(details.length > 3900 ? details.slice(0, 3900) + '…' : details || '​')
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
  return { member, changed: true };
}

async function withdraw(user, messageId, campaign) {
  const existing = await findCommitment(user.id, messageId);
  if (!existing || existing.fields[K.f.status] === 'Withdrawn') return false;
  await at.update(K.table, existing.id, { [K.f.status]: 'Withdrawn', [K.f.withdrawnAt]: now() });
  log(`Withdrawn: ${user.username} (${user.id}) ✗ ${campaign.name}`);
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
    if (changed && !member) {
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
  }
}

// ---------- slash commands ----------

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Connect your Discord account to your Creator Congress profile')
    .addStringOption((o) => o.setName('email').setDescription('The email you applied with').setRequired(true)),
  new SlashCommandBuilder().setName('mycampaigns').setDescription('See the campaigns you have signed up for'),
].map((c) => c.toJSON());

async function handleLink(interaction) {
  const email = interaction.options.getString('email', true).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return interaction.editReply("That doesn't look like an email address. Try again with the email you applied with.");
  }
  const member = await at.first(M.table, {
    formula: `AND(LOWER({${M.names.email}})=LOWER(${at.q(email)}), {${M.names.approved}})`,
    fields: [M.f.firstName, M.f.discordUserId],
  });
  if (!member) {
    return interaction.editReply(
      "I couldn't find an approved Creator Congress member with that email. Check for typos, or message a team member for help."
    );
  }
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
      'Use `/mycampaigns` any time to see what you have signed up for.'
  );
}

async function handleMyCampaigns(interaction) {
  const rows = await at.list(K.table, {
    formula: `AND({${K.names.discordUserId}}=${at.q(interaction.user.id)}, {${K.names.status}}="Committed")`,
    fields: [K.f.campaignName, K.f.campaignStatus, K.f.campaignEndDate, K.f.discordMessageId, K.f.creator],
  });
  if (!rows.length) {
    return interaction.editReply(`You haven't signed up for any campaigns yet. React ${SIGNUP_EMOJI} on a post in <#${CAMPAIGN_CHANNEL_ID}> to join one.`);
  }
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const line = (r) => {
    const name = first(r.fields[K.f.campaignName]) || 'Campaign';
    const end = fmtDate(first(r.fields[K.f.campaignEndDate]));
    const link = `https://discord.com/channels/${DISCORD_GUILD_ID}/${CAMPAIGN_CHANNEL_ID}/${r.fields[K.f.discordMessageId]}`;
    return `• [${name}](${link})${end ? ` · ends ${end}` : ''}`;
  };
  const active = rows.filter((r) => first(r.fields[K.f.campaignStatus]) === C.ACTIVE);
  const past = rows.filter((r) => first(r.fields[K.f.campaignStatus]) !== C.ACTIVE);

  const e = new EmbedBuilder().setTitle('Your campaigns').setColor(0x2ecc71);
  if (active.length) e.addFields({ name: `Active (${active.length})`, value: active.map(line).join('\n').slice(0, 1024) });
  if (past.length) e.addFields({ name: `Past (${past.length})`, value: past.map(line).join('\n').slice(0, 1024) });
  const unlinked = rows.some((r) => !r.fields[K.f.creator]?.length);
  const notes = [];
  if (unlinked) notes.push('Run /link with your application email to connect these to your profile.');
  if (PORTAL_URL) notes.push(`Also on your member portal: ${PORTAL_URL}`);
  if (notes.length) e.setFooter({ text: notes.join(' · ') });
  return interaction.editReply({ embeds: [e] });
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // only the member sees the reply
    if (interaction.commandName === 'link') await handleLink(interaction);
    if (interaction.commandName === 'mycampaigns') await handleMyCampaigns(interaction);
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
  } catch (err) {
    log('poll error', err);
  } finally {
    polling = false;
  }
}

client.once('clientReady', async () => {
  log(`Logged in as ${client.user.tag}`);
  await new REST().setToken(DISCORD_TOKEN).put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
  log('Slash commands registered');
  await poll();
  try {
    await reconcileOpenCampaigns();
    log('Reconciled reactions on open campaigns');
  } catch (err) {
    log('reconcile error', err);
  }
  setInterval(poll, Number(POLL_SECONDS) * 1000);
});

client.login(DISCORD_TOKEN);
