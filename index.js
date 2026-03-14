const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageType,
} = require('discord.js');

// Load config
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const warningsPath = path.join(__dirname, 'data', 'warnings.json');
function loadWarnings() {
  try {
    return JSON.parse(fs.readFileSync(warningsPath, 'utf8'));
  } catch {
    return {};
  }
}
function saveWarnings(data) {
  fs.mkdirSync(path.dirname(warningsPath), { recursive: true });
  fs.writeFileSync(warningsPath, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

const PREFIX = config.prefix || '!';

// Parse duration string (e.g. 10m, 1h, 1d) to milliseconds
function parseDuration(str) {
  if (!str || str === 'permanent') return null;
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return num * multipliers[unit];
}

function getWarnings(guildId, userId) {
  const data = loadWarnings();
  const key = `${guildId}-${userId}`;
  return data[key] || [];
}
function addWarning(guildId, userId, reason, modId) {
  const data = loadWarnings();
  const key = `${guildId}-${userId}`;
  if (!data[key]) data[key] = [];
  data[key].push({ reason, modId, at: Date.now() });
  saveWarnings(data);
  return data[key].length;
}
function clearWarnings(guildId, userId) {
  const data = loadWarnings();
  const key = `${guildId}-${userId}`;
  delete data[key];
  saveWarnings(data);
}

// Info message tracking (per channel)
const channelMessageCounts = new Map();
const channelLastInfoTime = new Map();

function replaceTemplate(str, obj) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (obj[k] != null ? String(obj[k]) : `{${k}}`));
}

// Build and send ticket transcript to the transcripts channel
async function sendTicketTranscript(thread) {
  const transcriptChId = config.tickets?.ticketTranscriptsChannelId;
  if (!transcriptChId) return;
  const transcriptCh = await client.channels.fetch(transcriptChId).catch(() => null);
  if (!transcriptCh) return;
  let messages = [];
  let lastId;
  do {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;
    const batch = await thread.messages.fetch(opts).catch(() => null);
    if (!batch || batch.size === 0) break;
    messages = messages.concat(Array.from(batch.values()));
    lastId = batch.last().id;
    if (batch.size < 100) break;
  } while (true);
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = messages.map((m) => {
    const date = new Date(m.createdTimestamp);
    const time = date.toISOString().replace('T', ' ').slice(0, 19);
    const author = m.author.tag;
    const content = m.content || '(no text)';
    const attachments = m.attachments.size ? m.attachments.map((a) => a.url).join(' ') : '';
    return `[${time}] ${author}: ${content}${attachments ? ' (Attachments: ' + attachments + ')' : ''}`;
  });
  const body = `Transcript: ${thread.name} (ID: ${thread.id})\nCreated: ${thread.createdAt?.toISOString?.() ?? '?'}\n${'─'.repeat(50)}\n${lines.join('\n')}`;
  const buffer = Buffer.from(body, 'utf8');
  const safeName = thread.name.replace(/[^a-z0-9-_]/gi, '_').slice(0, 80);
  await transcriptCh.send({
    embeds: [new EmbedBuilder().setTitle(`Ticket: ${thread.name}`).setColor(0x5865f2).setTimestamp()],
    files: [{ attachment: buffer, name: `transcript-${safeName}-${thread.id}.txt` }],
  }).catch(() => {});
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  const status = config.status || {};
  const typeStr = (status.type || 'WATCHING').toUpperCase();
  const activityType = ActivityType[typeStr] ?? ActivityType.Watching;
  client.user.setPresence({
    activities: [{ name: status.text || 'the server', type: activityType }],
    status: 'online',
  });
});

// Moderation commands
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) {
    // Info messages: track activity in configured channels
    if (!message.author.bot && config.infoMessages?.enabled && config.infoMessages.channelIds?.length) {
      const chId = message.channel.id;
      if (config.infoMessages.channelIds.includes(chId)) {
        const count = (channelMessageCounts.get(chId) || 0) + 1;
        channelMessageCounts.set(chId, count);
        const lastTime = channelLastInfoTime.get(chId) || 0;
        const minMsg = config.infoMessages.minMessagesBetween ?? 20;
        const minMin = (config.infoMessages.minMinutesBetween ?? 30) * 60 * 1000;
        const messages = config.infoMessages.messages || [];
        if (messages.length && count >= minMsg && Date.now() - lastTime >= minMin) {
          const msg = messages[Math.floor(Math.random() * messages.length)];
          await message.channel.send(msg).catch(() => {});
          channelMessageCounts.set(chId, 0);
          channelLastInfoTime.set(chId, Date.now());
        }
      }
    }
    return;
  }

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  const mod = config.moderation;
  const modMsg = mod?.messages || {};

  // Ticket panel (must be in panel channel)
  if (command === 'ticketpanel') {
    const panelChId = config.tickets?.panelChannelId;
    if (!panelChId || message.channel.id !== panelChId) {
      if (panelChId) await message.reply({ content: 'Use this command in the ticket panel channel.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply({ content: 'You need Administrator permission.', ephemeral: true }).catch(() => {});
      return;
    }
    const t = config.tickets.messages || {};
    const categories = config.tickets?.categories || [];
    let description = t.panelDescription || 'Click a button below to open a ticket.';
    if (categories.length > 0 && t.panelCategoriesTitle) {
      const categoryLines = categories.map((c) => `${c.emoji || '•'} **${c.label}**`).join('\n');
      description += `\n\n**${t.panelCategoriesTitle}**\n${categoryLines}`;
    }
    const embed = new EmbedBuilder()
      .setTitle(t.panelTitle || 'Support Tickets')
      .setDescription(description)
      .setColor(0x5865f2);
    const rows = [];
    if (categories.length > 0) {
      for (let i = 0; i < categories.length; i += 5) {
        const chunk = categories.slice(i, i + 5);
        const row = new ActionRowBuilder().addComponents(
          chunk.map((c) =>
            new ButtonBuilder()
              .setCustomId(`create_ticket:${c.id}`)
              .setLabel(c.label.slice(0, 80))
              .setStyle(ButtonStyle.Primary)
              .setEmoji(c.emoji || '🎫')
          )
        );
        rows.push(row);
      }
    } else {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('create_ticket')
          .setLabel(t.buttonLabel || 'Create Ticket')
          .setEmoji(t.buttonEmoji || '🎫')
          .setStyle(ButtonStyle.Primary)
      );
      rows.push(row);
    }
    await message.channel.send({ embeds: [embed], components: rows });
    await message.delete().catch(() => {});
    return;
  }

  // Ticket commands (add, remove, escalate) – only inside ticket threads
  const panelChId = config.tickets?.panelChannelId;
  const isTicketThread = message.channel.isThread() && message.channel.parentId === panelChId;
  if (isTicketThread && ['add', 'remove', 'escalate', 'close'].includes(command)) {
    const canManage = message.member.permissions.has(PermissionFlagsBits.ManageThreads) || message.channel.ownerId === message.author.id;
    if (!canManage) {
      await message.reply('Only the ticket creator or staff can use ticket commands here.').catch(() => {});
      return;
    }
    const tMsg = config.tickets?.messages || {};
    if (command === 'close') {
      await message.reply(tMsg.closeSuccess || 'Ticket closed.').catch(() => {});
      await sendTicketTranscript(message.channel);
      await message.channel.setArchived(true).catch(() => {});
      return;
    }
    if (command === 'escalate') {
      const managerRoleId = config.tickets?.supportManagerRoleId;
      if (!managerRoleId) {
        await message.reply(tMsg.escalateFail || 'Escalation not configured.').catch(() => {});
        return;
      }
      const thread = message.channel;
      const currentName = thread.name;
      if (!currentName.toLowerCase().includes('escalated')) {
        const newName = (currentName + '-escalated').slice(0, 100);
        await thread.setName(newName).catch(() => {});
      }
      await thread.send(`<@&${managerRoleId}> Ticket escalated by ${message.author}.`).catch(() => {});
      await message.reply(tMsg.escalateSuccess || 'Ticket escalated.').catch(() => {});
      return;
    }
    const ticketUser = message.mentions.users.first();
    if (!ticketUser) {
      await message.reply(`Please mention a user to ${command} (e.g. \`!${command} @user\`).`).catch(() => {});
      return;
    }
    try {
      if (command === 'add') {
        await message.channel.members.add(ticketUser.id);
        await message.reply(replaceTemplate(tMsg.addSuccess || '**{user}** has been added.', { user: ticketUser.tag })).catch(() => {});
      } else {
        await message.channel.members.remove(ticketUser.id);
        await message.reply(replaceTemplate(tMsg.removeSuccess || '**{user}** has been removed.', { user: ticketUser.tag })).catch(() => {});
      }
    } catch (e) {
      const failMsg = command === 'add' ? (tMsg.addFail || 'Could not add user.') : (tMsg.removeFail || 'Could not remove user.');
      await message.reply(failMsg).catch(() => {});
    }
    return;
  }

  // Moderation: require mod permissions
  const targetUser = message.mentions.users.first();
  if (!targetUser && !['warnings'].includes(command)) {
    if (['ban', 'kick', 'mute', 'unmute', 'warn', 'clearwarnings'].includes(command)) {
      await message.reply('Please mention a user (e.g. `!ban @user reason`).').catch(() => {});
    }
    return;
  }

  const targetMember = targetUser ? await message.guild.members.fetch(targetUser.id).catch(() => null) : null;
  const reason = args.slice(1).join(' ') || 'No reason provided';
  const guildId = message.guild.id;

  switch (command) {
    case 'ban': {
      if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return;
      const reply = await message.reply('Banning...').catch(() => null);
      try {
        await message.guild.members.ban(targetUser.id, { reason });
        const text = replaceTemplate(modMsg.banSuccess, { user: targetUser.tag, reason });
        await (reply?.edit(text) || message.channel.send(text));
        const logCh = config.moderation?.modLogChannelId ? await client.channels.fetch(config.moderation.modLogChannelId).catch(() => null) : null;
        if (logCh) {
          await logCh.send(replaceTemplate(modMsg.modLogBan, { user: targetUser.tag, id: targetUser.id, mod: message.author.tag, reason }));
        }
      } catch (e) {
        await (reply?.edit(modMsg.banFail) || message.channel.send(modMsg.banFail)).catch(() => {});
      }
      break;
    }
    case 'kick': {
      if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return;
      const reply = await message.reply('Kicking...').catch(() => null);
      try {
        await targetMember.kick(reason);
        const text = replaceTemplate(modMsg.kickSuccess, { user: targetUser.tag, reason });
        await (reply?.edit(text) || message.channel.send(text));
        const logCh = config.moderation?.modLogChannelId ? await client.channels.fetch(config.moderation.modLogChannelId).catch(() => null) : null;
        if (logCh) {
          await logCh.send(replaceTemplate(modMsg.modLogKick, { user: targetUser.tag, id: targetUser.id, mod: message.author.tag, reason }));
        }
      } catch (e) {
        await (reply?.edit(modMsg.kickFail) || message.channel.send(modMsg.kickFail)).catch(() => {});
      }
      break;
    }
    case 'mute': {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const possibleDuration = args[1] && !args[1].startsWith('<') ? args[1] : null;
      const durationMs = parseDuration(possibleDuration);
      const durationStr = durationMs ? possibleDuration : 'permanent';
      const muteReason = durationMs ? args.slice(2).join(' ') : (args.slice(1).join(' ') || 'No reason provided');
      const reply = await message.reply('Muting...').catch(() => null);
      const muteRoleId = config.moderation?.muteRoleId;
      if (!muteRoleId) {
        await (reply?.edit('Mute role is not configured. Set `moderation.muteRoleId` in config.') || message.channel.send('Mute role not configured.')).catch(() => {});
        return;
      }
      try {
        await targetMember.roles.add(muteRoleId);
        const durationDisplay = durationStr === 'permanent' ? 'Permanent' : durationStr;
        const text = replaceTemplate(modMsg.muteSuccess, { user: targetUser.tag, duration: durationDisplay, reason: muteReason });
        await (reply?.edit(text) || message.channel.send(text));
        const logCh = config.moderation?.modLogChannelId ? await client.channels.fetch(config.moderation.modLogChannelId).catch(() => null) : null;
        if (logCh) {
          await logCh.send(replaceTemplate(modMsg.modLogMute, { user: targetUser.tag, id: targetUser.id, mod: message.author.tag, duration: durationDisplay, reason: muteReason }));
        }
        if (durationMs) {
          setTimeout(async () => {
            const m = await message.guild.members.fetch(targetUser.id).catch(() => null);
            if (m) await m.roles.remove(muteRoleId).catch(() => {});
          }, durationMs);
        }
      } catch (e) {
        await (reply?.edit(modMsg.muteFail) || message.channel.send(modMsg.muteFail)).catch(() => {});
      }
      break;
    }
    case 'unmute': {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const reply = await message.reply('Unmuting...').catch(() => null);
      try {
        await targetMember.roles.remove(config.moderation?.muteRoleId);
        await (reply?.edit(replaceTemplate(modMsg.unmuteSuccess, { user: targetUser.tag })) || message.channel.send(replaceTemplate(modMsg.unmuteSuccess, { user: targetUser.tag })));
        const logCh = config.moderation?.modLogChannelId ? await client.channels.fetch(config.moderation.modLogChannelId).catch(() => null) : null;
        if (logCh) {
          await logCh.send(replaceTemplate(modMsg.modLogUnmute, { user: targetUser.tag, id: targetUser.id, mod: message.author.tag }));
        }
      } catch (e) {
        await (reply?.edit('Could not unmute.') || message.channel.send('Could not unmute.')).catch(() => {});
      }
      break;
    }
    case 'warn': {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const count = addWarning(guildId, targetUser.id, reason, message.author.id);
      await message.reply(replaceTemplate(modMsg.warnSuccess, { user: targetUser.tag, count, reason })).catch(() => {});
      const logCh = config.moderation?.modLogChannelId ? await client.channels.fetch(config.moderation.modLogChannelId).catch(() => null) : null;
      if (logCh) {
        await logCh.send(replaceTemplate(modMsg.modLogWarn, { user: targetUser.tag, id: targetUser.id, mod: message.author.tag, reason, count }));
      }
      break;
    }
    case 'warnings': {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      const user = targetUser || message.author;
      const list = getWarnings(guildId, user.id);
      if (list.length === 0) {
        await message.reply(replaceTemplate(modMsg.noWarnings, { user: user.tag })).catch(() => {});
      } else {
        const lines = list.map((w, i) => `${i + 1}. ${w.reason} (by <@${w.modId}>)`);
        await message.reply(replaceTemplate(modMsg.warningsList, { user: user.tag, warnings: lines.join('\n') })).catch(() => {});
      }
      break;
    }
    case 'clearwarnings': {
      if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;
      clearWarnings(guildId, targetUser.id);
      await message.reply(replaceTemplate(modMsg.warningsCleared, { user: targetUser.tag })).catch(() => {});
      break;
    }
    default:
      break;
  }
});

// Ticket button -> create thread; close button -> archive thread
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const panelChId = config.tickets?.panelChannelId;

  if (interaction.customId === 'close_ticket') {
    if (!interaction.channel.isThread()) return;
    const isOwner = interaction.channel.ownerId === interaction.user.id;
    const isMod = interaction.member.permissions.has(PermissionFlagsBits.ManageThreads);
    if (!isOwner && !isMod) {
      await interaction.reply({ content: 'Only the ticket creator or staff can close this ticket.', ephemeral: true }).catch(() => {});
      return;
    }
    await interaction.deferReply();
    await sendTicketTranscript(interaction.channel);
    await interaction.channel.setArchived(true).catch(() => {});
    await interaction.editReply({ content: 'Ticket closed.' }).catch(() => {});
    return;
  }

  const isCreateTicket = interaction.customId === 'create_ticket' || interaction.customId.startsWith('create_ticket:');
  if (!isCreateTicket) return;
  if (!panelChId || interaction.channel.id !== panelChId) return;

  const categoryId = interaction.customId.includes(':') ? interaction.customId.slice('create_ticket:'.length) : '';
  const categories = config.tickets?.categories || [];
  const category = categories.find((c) => c.id === categoryId);

  await interaction.deferReply({ ephemeral: true });
  const t = config.tickets.messages || {};
  const prefix = t.threadNamePrefix || 'ticket-';
  const slug = categoryId ? categoryId.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) : '';
  const namePart = slug ? `${prefix}${slug}-${interaction.user.username}` : `${prefix}${interaction.user.username}`;
  const name = `${namePart}-${Date.now().toString(36)}`;
  try {
    const thread = await interaction.channel.threads.create({
      name: name.slice(0, 100),
      reason: `Ticket by ${interaction.user.tag}`,
      type: 11, // PUBLIC_THREAD
    });
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel(t.closeButtonLabel || 'Close Ticket')
        .setEmoji(t.closeButtonEmoji || '🔒')
        .setStyle(ButtonStyle.Secondary)
    );
    const body = [replaceTemplate(t.threadCreated || 'Your ticket has been created!', {}), t.closeInstruction].filter(Boolean).join('\n\n');
    const supportRoleId = config.tickets?.supportRoleId;
    const content = (supportRoleId ? `<@&${supportRoleId}> ` : '') + body;
    await thread.send({ content, components: [closeRow] });
    const parent = interaction.channel;
    const recent = await parent.messages.fetch({ limit: 5 }).catch(() => null);
    if (recent) {
      const threadCreatedMsg = recent.find((m) => m.type === MessageType.ThreadCreated);
      if (threadCreatedMsg) await threadCreatedMsg.delete().catch(() => {});
    }
    await interaction.editReply({ content: `Ticket created: ${thread}` }).catch(() => {});
  } catch (e) {
    await interaction.editReply({ content: 'Failed to create ticket. Check bot permissions (Create Public Threads).' }).catch(() => {});
  }
});

client.login(config.token).catch((e) => {
  console.error('Login failed:', e.message);
  process.exit(1);
});
