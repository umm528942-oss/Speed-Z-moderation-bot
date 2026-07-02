import { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, ChannelType, Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle, InteractionType } from 'discord.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import * as fs from 'fs';
import * as path from 'path';

const TOKEN = process.env.DISCORD_TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const OWNER_LOG_CHANNEL_ID = '1522015523335045320';
const MOD_LOG_CHANNEL_ID = '1521993995180441731';
const SERVER_ID = process.env.SERVER_ID;
const TICKET_SERVER_ID = '1522047199133958274';
const TICKET_CATEGORY_ID = '1522054281023459391';
const TICKET_PANEL_CHANNEL_ID = '1522053070668955728';
const TICKET_STATUS_CHANNEL_ID = '1522047484644561037';

const ROLE_IDS = {
 'Trial Support': '1504483925546897619',
 'Support': '1504484055050359037',
 'Staff': '1522011789360107550',
 'Trusted Staff': '1522012720696787107',
 'Manager': '1522013542432243846',
 'Founder': '1504484101971906614',
};

const client = new Client({
 intents: [
 GatewayIntentBits.Guilds,
 GatewayIntentBits.GuildMembers,
 GatewayIntentBits.GuildMessages,
 GatewayIntentBits.MessageContent,
 GatewayIntentBits.DirectMessages,
 ],
});

const commands = new Collection();
const activeTickets = new Map();
let ticketSystemEnabled = true; // Track if ticket system is enabled

// Utility functions
function getWarningsFile(guildId) {
 return `warnings_${guildId}.json`;
}

function loadWarnings(guildId) {
 const file = getWarningsFile(guildId);
 if (fs.existsSync(file)) {
 return JSON.parse(fs.readFileSync(file, 'utf-8'));
 }
 return {};
}

function saveWarnings(guildId, data) {
 const file = getWarningsFile(guildId);
 fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function hasRequiredRole(member) {
 if (!member) return false;
 return member.roles.cache.some(role => Object.values(ROLE_IDS).includes(role.id));
}

function checkDiscordPerms(member, ...perms) {
 if (!member) return false;
 return perms.every(perm => member.permissions.has(perm));
}

async function logModAction(guild, user, actionType, reason, moderator, duration = null, offenseCount = null, proofUrl = null) {
 const isOwnerAction = actionType === 'ban' || actionType === 'unban';
 const logChannelId = isOwnerAction ? OWNER_LOG_CHANNEL_ID : MOD_LOG_CHANNEL_ID;
 const channel = await client.channels.fetch(logChannelId).catch(() => null);
 if (!channel || !channel.isTextBased()) return;

 const colors = {
 ban: 0xFF0000,
 unban: 0x00FF00,
 kick: 0xFFA500,
 mute: 0xFFD700,
 unmute: 0x90EE90,
 warn: 0x808080,
 };

 const embed = new EmbedBuilder()
 .setTitle(`${actionType.toUpperCase()} Action`)
 .setColor(colors[actionType.toLowerCase()] || 0x808080)
 .addFields(
 { name: 'User', value: `<@${user.id}> (@${user.username})`, inline: false },
 { name: 'UserID', value: user.id, inline: false },
 { name: 'Moderator', value: `<@${moderator.id}> (@${moderator.username})`, inline: false },
 { name: 'Reason', value: reason || 'No reason provided', inline: false }
 )
 .setThumbnail(guild.iconURL())
 .setFooter({ text: `${client.user.username} | ${new Date().toISOString().split('T')[0]}` })
 .setTimestamp();

 if (duration) {
 embed.addFields({ name: 'Mute Duration', value: duration, inline: false });
 }
 if (offenseCount) {
 embed.addFields({ name: 'Offenses', value: `${offenseCount} offense${offenseCount > 1 ? 's' : ''}`, inline: false });
 }
 if (proofUrl) {
 embed.setImage(proofUrl);
 } else if (actionType !== 'unmute' && actionType !== 'unban') {
 embed.addFields({ name: 'Proof', value: 'None provided', inline: false });
 }

 await channel.send({ embeds: [embed] });
}

function getProofUrl(message) {
 if (message.attachments.size > 0) {
 return message.attachments.first().url;
 }
 const args = message.content.split(/\s+/);
 const lastArg = args[args.length - 1];
 if (lastArg && (lastArg.startsWith('http://') || lastArg.startsWith('https://'))) {
 return lastArg;
 }
 return null;
}

async function createTicket(user, guild) {
 if (!ticketSystemEnabled) {
 return { success: false, message: '❌ The ticket system is currently disabled.' };
 }

 const ticketGuild = await client.guilds.fetch(TICKET_SERVER_ID).catch(() => null);
 if (!ticketGuild) {
 return { success: false, message: '❌ Ticket server not found.' };
 }

 const category = await ticketGuild.channels.fetch(TICKET_CATEGORY_ID).catch(() => null);
 if (!category || category.type !== ChannelType.GuildCategory) {
 return { success: false, message: '❌ Ticket category not found.' };
 }

 if (activeTickets.has(user.id)) {
 return { success: false, message: '❌ You already have an open ticket. Please wait for support to respond.' };
 }

 try {
 const ticketChannel = await ticketGuild.channels.create({
 name: `ticket-${user.username}`,
 type: ChannelType.GuildText,
 parent: TICKET_CATEGORY_ID,
 permissionOverwrites: [
 {
 id: ticketGuild.id,
 deny: [PermissionFlagsBits.ViewChannel],
 },
 ],
 });

 activeTickets.set(user.id, ticketChannel.id);

 const ticketEmbed = new EmbedBuilder()
 .setTitle('New Support Ticket')
 .setDescription(`**User:** ${user.username}\n**UserID:** ${user.id}`)
 .setColor(0x5865F2)
 .setTimestamp();

 await ticketChannel.send({ embeds: [ticketEmbed] });
 await user.send('Please describe your issue and we\'ll get back to you as soon as possible.').catch(() => null);

 return { success: true, message: '✅ Support ticket opened! Check your DMs.' };
 } catch (error) {
 console.error('Error creating ticket:', error);
 return { success: false, message: '❌ Failed to create ticket.' };
 }
}

client.on('ready', () => {
 console.log(`✅ Bot logged in as ${client.user.tag}`);
 client.user.setActivity('S?help', { type: 'WATCHING' });
});

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
 if (interaction.isButton()) {
 if (interaction.customId === 'open_ticket_button') {
 await interaction.deferReply({ ephemeral: true });
 const result = await createTicket(interaction.user, interaction.guild);
 await interaction.editReply(result.message);
 }
 }
});

client.on('messageCreate', async (message) => {
 // Handle modmail replies in DMs
 if (message.isDMBased() && !message.author.bot) {
 const ticketChannelId = activeTickets.get(message.author.id);
 
 if (ticketChannelId) {
 try {
 const ticketChannel = await client.channels.fetch(ticketChannelId).catch(() => null);
 
 if (ticketChannel && ticketChannel.isTextBased()) {
 const embed = new EmbedBuilder()
 .setAuthor({ name: message.author.username, iconURL: message.author.avatarURL() })
 .setDescription(message.content)
 .setColor(0x5865F2)
 .setTimestamp();
 if (message.attachments.size > 0) {
 embed.setImage(message.attachments.first().url);
 }
 await ticketChannel.send({ embeds: [embed] });
 await message.react('✅');
 await message.reply('Your message has been sent to our support team. We\'ll get back to you soon.');
 }
 } catch (error) {
 console.error('Error handling modmail:', error);
 }
 }
 return;
 }

 if (!message.content.startsWith('S?') || message.author.bot) return;

 const args = message.content.slice(2).trim().split(/\s+/);
 const command = args.shift().toLowerCase();
 const member = message.member;
 const guild = message.guild;

 const hasRole = hasRequiredRole(member);
 if (!hasRole && command !== 'help' && command !== 'modmail') {
 return message.reply('❌ You do not have permission to use this command.');
 }

 try {
 // MODMAIL
 if (command === 'modmail') {
 const result = await createTicket(message.author, guild);
 return message.reply(result.message);
 }

 // TICKETPANEL - Send button panel to channel
 if (command === 'ticketpanel') {
 const isFounder = member.roles.cache.has(ROLE_IDS['Founder']);
 if (!isFounder) {
 return message.reply('❌ This command is for Founder only.');
 }

 try {
 const panelChannel = await client.channels.fetch(TICKET_PANEL_CHANNEL_ID).catch(() => null);
 if (!panelChannel || !panelChannel.isTextBased()) {
 return message.reply('❌ Ticket panel channel not found.');
 }

 const panelEmbed = new EmbedBuilder()
 .setTitle('📬 Support Ticket System')
 .setDescription('Click the button below to open a support ticket. Our team will assist you as soon as possible.')
 .setColor(0x5865F2)
 .setFooter({ text: `${client.user.username}` })
 .setTimestamp();

 const row = new ActionRowBuilder()
 .addComponents(
 new ButtonBuilder()
 .setCustomId('open_ticket_button')
 .setLabel('Open Ticket')
 .setStyle(ButtonStyle.Primary)
 .setEmoji('📬')
 );

 await panelChannel.send({ embeds: [panelEmbed], components: [row] });
 return message.reply('✅ Ticket panel sent to the designated channel.');
 } catch (error) {
 console.error('Error sending ticket panel:', error);
 return message.reply('❌ Failed to send ticket panel.');
 }
 }

 // TICKETSYSTEM - Toggle ticket system on/off
 if (command === 'ticketsystem') {
 const isFounder = member.roles.cache.has(ROLE_IDS['Founder']);
 if (!isFounder) {
 return message.reply('❌ This command is for Founder only.');
 }

 const action = args[0]?.toLowerCase();
 if (!action || !['on', 'off', 'toggle'].includes(action)) {
 return message.reply('Usage: `S?ticketsystem <on|off|toggle>`');
 }

 if (action === 'toggle') {
 ticketSystemEnabled = !ticketSystemEnabled;
 } else if (action === 'on') {
 ticketSystemEnabled = true;
 } else if (action === 'off') {
 ticketSystemEnabled = false;
 }

 try {
 const statusChannel = await client.channels.fetch(TICKET_STATUS_CHANNEL_ID).catch(() => null);
 if (!statusChannel || !statusChannel.isTextBased()) {
 return message.reply('❌ Ticket status channel not found.');
 }

 const statusEmbed = new EmbedBuilder()
 .setTitle('🎫 Ticket System Status')
 .setDescription(ticketSystemEnabled ? '✅ **ENABLED** - Users can open support tickets.' : '❌ **DISABLED** - Ticket system is currently offline.')
 .setColor(ticketSystemEnabled ? 0x00FF00 : 0xFF0000)
 .addFields(
 { name: 'Updated By', value: `<@${member.user.id}>`, inline: false },
 { name: 'Timestamp', value: new Date().toISOString(), inline: false }
 )
 .setFooter({ text: `${client.user.username}` })
 .setTimestamp();

 await statusChannel.send({ embeds: [statusEmbed] });
 return message.reply(`✅ Ticket system is now **${ticketSystemEnabled ? 'ENABLED' : 'DISABLED'}**.`);
 } catch (error) {
 console.error('Error updating ticket system status:', error);
 return message.reply('❌ Failed to update ticket system status.');
 }
 }

 // MUTE (formerly timeout)
 if (command === 'mute') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.ModerateMembers)) {
 return message.reply('❌ You need `Moderate Members` permission.');
 }
 const user = message.mentions.members.first();
 const duration = args[1];
 const reason = args.slice(2).join(' ') || 'No reason provided';
 if (!user || !duration) {
 return message.reply('Usage: `S?mute @user <duration> <reason> [proof]`');
 }
 const durationMs = parseDuration(duration);
 if (!durationMs) {
 return message.reply('❌ Invalid duration format. Use: 5m, 1h, 2d');
 }
 await user.timeout(durationMs, reason);
 const proofUrl = getProofUrl(message);
 await logModAction(guild, user.user, 'mute', reason, member.user, duration, 1, proofUrl);
 return message.reply(`✅ ${user} has been muted for ${duration}.`);
 }

 // UNMUTE
 if (command === 'unmute') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.ModerateMembers)) {
 return message.reply('❌ You need `Moderate Members` permission.');
 }
 const user = message.mentions.members.first();
 const reason = args.slice(1).join(' ') || 'No reason provided';
 if (!user) {
 return message.reply('Usage: `S?unmute @user [reason]`');
 }
 await user.timeout(null, reason);
 await logModAction(guild, user.user, 'unmute', reason, member.user);
 return message.reply(`✅ ${user} has been unmuted.`);
 }

 // BAN
 if (command === 'ban') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.BanMembers)) {
 return message.reply('❌ You need `Ban Members` permission.');
 }
 const user = message.mentions.users.first();
 const reason = args.slice(1).join(' ') || 'No reason provided';
 if (!user) {
 return message.reply('Usage: `S?ban @user <reason> [proof]`');
 }
 await guild.bans.create(user, { reason });
 const proofUrl = getProofUrl(message);
 await logModAction(guild, user, 'ban', reason, member.user, null, 1, proofUrl);
 return message.reply(`✅ ${user.username} has been banned.`);
 }

 // UNBAN
 if (command === 'unban') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.BanMembers)) {
 return message.reply('❌ You need `Ban Members` permission.');
 }
 const userId = args[0];
 if (!userId) {
 return message.reply('Usage: `S?unban <userID>`');
 }
 try {
 const user = await client.users.fetch(userId);
 await guild.bans.remove(user);
 await logModAction(guild, user, 'unban', 'Unbanned', member.user);
 return message.reply(`✅ ${user.username} has been unbanned.`);
 } catch {
 return message.reply('❌ User not found.');
 }
 }

 // KICK
 if (command === 'kick') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.KickMembers)) {
 return message.reply('❌ You need `Kick Members` permission.');
 }
 const user = message.mentions.members.first();
 const reason = args.slice(1).join(' ') || 'No reason provided';
 if (!user) {
 return message.reply('Usage: `S?kick @user <reason>`');
 }
 await user.kick(reason);
 const proofUrl = getProofUrl(message);
 await logModAction(guild, user.user, 'kick', reason, member.user, null, 1, proofUrl);
 return message.reply(`✅ ${user} has been kicked.`);
 }

 // WARN
 if (command === 'warn') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageMessages)) {
 return message.reply('❌ You need `Kick Members` and `Manage Messages` permissions.');
 }
 const user = message.mentions.members.first();
 const reason = args.slice(1).join(' ') || 'No reason provided';
 if (!user) {
 return message.reply('Usage: `S?warn @user <reason> [proof]`');
 }
 const warnings = loadWarnings(guild.id);
 const userId = user.id;
 if (!warnings[userId]) {
 warnings[userId] = { count: 0, history: [] };
 }
 warnings[userId].count += 1;
 warnings[userId].history.push({
 reason,
 timestamp: new Date().toISOString(),
 moderator: member.user.username,
 });
 saveWarnings(guild.id, warnings);
 const proofUrl = getProofUrl(message);
 await logModAction(guild, user.user, 'warn', reason, member.user, null, warnings[userId].count, proofUrl);
 return message.reply(`✅ ${user} has been warned. (Offense #${warnings[userId].count})`);
 }

 // WARNINGS
 if (command === 'warnings') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageMessages)) {
 return message.reply('❌ You need `Kick Members` and `Manage Messages` permissions.');
 }
 const user = message.mentions.members.first();
 if (!user) {
 return message.reply('Usage: `S?warnings @user`');
 }
 const warnings = loadWarnings(guild.id);
 const userId = user.id;
 if (!warnings[userId] || warnings[userId].count === 0) {
 return message.reply(`${user} has no warnings.`);
 }
 const embed = new EmbedBuilder()
 .setTitle(`Warnings for ${user.user.username}`)
 .setColor(0x808080)
 .addFields({ name: 'Total Warnings', value: String(warnings[userId].count), inline: false })
 .setFooter({ text: `${client.user.username}` })
 .setTimestamp();
 warnings[userId].history.forEach((warn, i) => {
 embed.addFields({
 name: `Warning #${i + 1}`,
 value: `**Reason:** ${warn.reason}\n**Moderator:** ${warn.moderator}\n**Date:** ${warn.timestamp}`,
 inline: false,
 });
 });
 return message.reply({ embeds: [embed] });
 }

 // CLEAR
 if (command === 'clear') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.ManageMessages)) {
 return message.reply('❌ You need `Manage Messages` permission.');
 }
 const amount = parseInt(args[0]);
 if (!amount || amount <= 0) {
 return message.reply('❌ Amount must be greater than 0.');
 }
 const deleted = await message.channel.bulkDelete(amount);
 return message.reply(`✅ Deleted ${deleted.size} messages.`);
 }

 // ROLE
 if (command === 'role') {
 if (!checkDiscordPerms(member, PermissionFlagsBits.ManageRoles)) {
 return message.reply('❌ You need `Manage Roles` permission.');
 }
 const user = message.mentions.members.first();
 const role = message.mentions.roles.first();
 if (!user || !role) {
 return message.reply('Usage: `S?role @user @role`');
 }
 await user.roles.add(role);
 return message.reply(`✅ ${role} has been assigned to ${user}.`);
 }

 // USERINFO
 if (command === 'userinfo') {
 const user = message.mentions.members.first() || member;
 const embed = new EmbedBuilder()
 .setTitle(`User Info: ${user.user.username}`)
 .setColor(user.displayColor)
 .setThumbnail(user.user.avatarURL())
 .addFields(
 { name: 'UserID', value: user.id, inline: false },
 { name: 'Joined Server', value: user.joinedAt?.toISOString().split('T')[0] || 'Unknown', inline: false },
 { name: 'Account Created', value: user.user.createdAt.toISOString().split('T')[0], inline: false },
 { name: 'Roles', value: user.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).join(', ') || 'None', inline: false },
 { name: 'Top Role', value: user.roles.highest.toString(), inline: false }
 )
 .setFooter({ text: `${client.user.username}` })
 .setTimestamp();
 return message.reply({ embeds: [embed] });
 }

 // SERVERINFO
 if (command === 'serverinfo') {
 const embed = new EmbedBuilder()
 .setTitle(`Server Info: ${guild.name}`)
 .setColor(0x0099FF)
 .setThumbnail(guild.iconURL())
 .addFields(
 { name: 'Server ID', value: guild.id, inline: false },
 { name: 'Owner', value: (await guild.fetchOwner()).toString(), inline: false },
 { name: 'Members', value: String(guild.memberCount), inline: false },
 { name: 'Channels', value: String(guild.channels.cache.size), inline: false },
 { name: 'Roles', value: String(guild.roles.cache.size), inline: false },
 { name: 'Created', value: guild.createdAt.toISOString().split('T')[0], inline: false }
 )
 .setFooter({ text: `${client.user.username}` })
 .setTimestamp();
 return message.reply({ embeds: [embed] });
 }

 // SETPERMS - Single role
 if (command === 'setperms') {
 const isFounder = member.roles.cache.has(ROLE_IDS['Founder']);
 if (!isFounder) {
 return message.reply('❌ This command is for Founder only.');
 }
 const channel = message.mentions.channels.first();
 const roles = message.mentions.roles;
 if (!channel || roles.size === 0) {
 return message.reply('Usage: `S?setperms <#channel> <@role> [@role2] [@role3]...`');
 }
 for (const role of roles.values()) {
 await channel.permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: false });
 }
 const roleList = roles.map(r => r.toString()).join(', ');
 return message.reply(`✅ ${roleList} can now view ${channel} but cannot send messages.`);
 }

 // LOCKPERMS - Lock multiple roles
 if (command === 'lockperms') {
 const isFounder = member.roles.cache.has(ROLE_IDS['Founder']);
 if (!isFounder) {
 return message.reply('❌ This command is for Founder only.');
 }
 const channel = message.mentions.channels.first();
 const roles = message.mentions.roles;
 if (!channel || roles.size === 0) {
 return message.reply('Usage: `S?lockperms <#channel> <@role> [@role2] [@role3]...`');
 }
 for (const role of roles.values()) {
 await channel.permissionOverwrites.edit(role, { ViewChannel: false });
 }
 const roleList = roles.map(r => r.toString()).join(', ');
 return message.reply(`✅ ${roleList} can no longer view ${channel}.`);
 }

 // OPENPERMS - Open multiple roles
 if (command === 'openperms') {
 const isFounder = member.roles.cache.has(ROLE_IDS['Founder']);
 if (!isFounder) {
 return message.reply('❌ This command is for Founder only.');
 }
 const channel = message.mentions.channels.first();
 const roles = message.mentions.roles;
 if (!channel || roles.size === 0) {
 return message.reply('Usage: `S?openperms <#channel> <@role> [@role2] [@role3]...`');
 }
 for (const role of roles.values()) {
 await channel.permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: true });
 }
 const roleList = roles.map(r => r.toString()).join(', ');
 return message.reply(`✅ ${roleList} can now view and send messages in ${channel}.`);
 }

 // VIEWONLY - Set multiple roles to view-only (all other perms off)
 if (command === 'viewonly') {
 const isFounder = member.roles.cache.has(ROLE_IDS['Founder']);
 if (!isFounder) {
 return message.reply('❌ This command is for Founder only.');
 }
 const channel = message.mentions.channels.first();
 const roles = message.mentions.roles;
 if (!channel || roles.size === 0) {
 return message.reply('Usage: `S?viewonly <#channel> <@role> [@role2] [@role3]...`');
 }
 const denyPerms = Object.values(PermissionFlagsBits).filter(perm => 
 typeof perm === 'bigint' && 
 perm !== PermissionFlagsBits.ViewChannel && 
 perm !== PermissionFlagsBits.ReadMessageHistory
 );
 for (const role of roles.values()) {
 const permOverwrite = {
 ViewChannel: true,
 ReadMessageHistory: true,
 };
 denyPerms.forEach(perm => {
 const permName = Object.keys(PermissionFlagsBits).find(key => PermissionFlagsBits[key] === perm);
 if (permName) {
 permOverwrite[permName] = false;
 }
 });
 await channel.permissionOverwrites.edit(role, permOverwrite);
 }
 const roleList = roles.map(r => r.toString()).join(', ');
 return message.reply(`✅ ${roleList} can now only view and read message history in ${channel}. All other permissions are disabled.`);
 }

 // HELP
 if (command === 'help') {
 const isFounder = member.roles.cache.has(ROLE_IDS['Founder']);
 const embed = new EmbedBuilder()
 .setTitle('Bot Commands')
 .setColor(0x5865F2)
 .setFooter({ text: `${client.user.username}` })
 .setTimestamp();
 embed.addFields(
 {
 name: '📬 Support',
 value: '`S?modmail` - Open a support ticket',
 inline: false,
 }
 );
 if (hasRole) {
 embed.addFields(
 {
 name: '📋 Moderation',
 value: '`S?mute @user <duration> <reason> [proof]`\n`S?unmute @user [reason]`\n`S?ban @user <reason> [proof]`\n`S?unban <userID>`\n`S?kick @user <reason>`\n`S?warn @user <reason> [proof]`\n`S?warnings @user`\n`S?clear <amount>`\n`S?role @user @role`',
 inline: false,
 },
 {
 name: '🔍 Utility',
 value: '`S?userinfo [@user]`\n`S?serverinfo`',
 inline: false,
 }
 );
 }
 if (isFounder) {
 embed.addFields({
 name: '👑 Founder Only',
 value: '`S?setperms <#channel> <@role> [@role2]...` - View only\n`S?viewonly <#channel> <@role> [@role2]...` - View & read history only\n`S?lockperms <#channel> <@role> [@role2]...` - Hide channel\n`S?openperms <#channel> <@role> [@role2]...` - Full access\n`S?ticketpanel` - Send ticket button panel\n`S?ticketsystem <on|off|toggle>` - Control ticket system',
 inline: false,
 });
 }
 if (!hasRole && !isFounder) {
 embed.setDescription('❌ You do not have permission to use any commands.');
 }
 return message.reply({ embeds: [embed] });
 }
 } catch (error) {
 console.error(error);
 return message.reply(`❌ An error occurred: ${error.message}`);
 }
});

function parseDuration(duration) {
 const match = duration.match(/^(\d+)([mhd])$/);
 if (!match) return null;
 const amount = parseInt(match[1]);
 const unit = match[2];
 const ms = {
 m: amount * 60 * 1000,
 h: amount * 60 * 60 * 1000,
 d: amount * 24 * 60 * 60 * 1000,
 };
 return ms[unit] || null;
}

client.login(TOKEN);
