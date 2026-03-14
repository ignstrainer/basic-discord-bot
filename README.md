# Basic Discord Bot

A config-driven Discord bot with **moderation**, **tickets**, **custom status**, and **random info messages** in general chat. Every message and feature can be edited in `config.json`.

## Features

- **Moderation:** `ban`, `kick`, `mute`, `unmute`, `warn`, `warnings`, `clearwarnings` with optional mod-log channel
- **Tickets:** Ticket panel with **configurable categories** (e.g. General, Bug Report, Purchase Help). Users pick a category to create a **thread** in that channel; the category appears in the thread name. Optional **support role** is pinged when a ticket opens. Close button to archive.
- **Status:** Configurable activity type (PLAYING, WATCHING, LISTENING, etc.) and text
- **Info messages:** Random messages sent in configured channels based on message count and time (e.g. “Who are we?”, tips, rules)

## Setup

1. **Node.js**  
   Install [Node.js](https://nodejs.org/) (v18+ recommended).

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Discord Developer Portal**
   - Create an application at [Discord Developer Portal](https://discord.com/developers/applications).
   - Under **Bot**, create a bot and copy the **token** into `config.json` as `token`.
   - Copy the **Application ID** as `clientId` in `config.json`.
   - Enable **Message Content Intent** and **Server Members Intent** under Bot → Privileged Gateway Intents.

4. **Invite the bot**
   - OAuth2 → URL Generator: scopes `bot`, permissions: Manage Roles, Ban Members, Kick Members, Manage Threads, Send Messages, Create Public Threads, Read Message History, View Channels, Manage Messages (or Administrator for testing).

5. **Edit `config.json`**
   - `token`: your bot token  
   - `clientId`: your application ID  
   - `prefix`: command prefix (default `!`)  
   - **Moderation:** set `modLogChannelId` to the channel ID for mod logs, and `muteRoleId` to your server’s mute role ID.  
   - **Tickets:** set `panelChannelId` to the channel where the ticket panel and threads will live. Set `supportRoleId` to ping when a ticket opens; set `supportManagerRoleId` (support manager) to ping when a ticket is escalated via `!escalate`. Set `ticketTranscriptsChannelId` to a channel where the bot will post a transcript (`.txt` file + embed) every time a ticket is closed; leave empty to disable. Add or edit `categories` to show category buttons (each has `id`, `label`, and optional `emoji`); thread names will include the category (e.g. `ticket-general-username-abc12`). When a ticket is escalated, its thread name is updated to end with `-escalated`.  
   - **Info messages:** set `channelIds` to an array of channel IDs where random info messages are allowed (e.g. `["123456789012345678"]`). Adjust `minMessagesBetween` and `minMinutesBetween` as needed.

6. **Run the bot**
   ```bash
   npm start
   ```

## Commands (prefix: `!`)

| Command | Description | Example |
|--------|-------------|---------|
| `!ticketpanel` | Send the ticket panel (use in the ticket panel channel; requires Admin) | `!ticketpanel` |
| `!add @user` | Add a user to the ticket (use inside a ticket thread; creator or Manage Threads) | `!add @Helper` |
| `!remove @user` | Remove a user from the ticket (use inside a ticket thread) | `!remove @User` |
| `!escalate` | Escalate the ticket and ping the support manager role (use inside a ticket thread) | `!escalate` |
| `!close` | Close (archive) the ticket (use inside a ticket thread) | `!close` |
| `!ban @user [reason]` | Ban a user | `!ban @User Breaking rules` |
| `!kick @user [reason]` | Kick a user | `!kick @User Spam` |
| `!mute @user [duration] [reason]` | Mute (add mute role). Duration: e.g. `10m`, `1h`, `1d` or omit for permanent | `!mute @User 1h No spoilers` |
| `!unmute @user` | Remove mute role | `!unmute @User` |
| `!warn @user [reason]` | Warn a user (stored per server) | `!warn @User Language` |
| `!warnings [@user]` | List warnings (no mention = your own) | `!warnings @User` |
| `!clearwarnings @user` | Clear all warnings for a user | `!clearwarnings @User` |

## Config overview

- **`config.json`**  
  All user-facing text, channel IDs, and behaviour are in this file. Edit it to change:
  - Moderation messages and mod-log format  
  - Ticket panel text, **categories** (id/label/emoji), support role ID, **support manager role ID** (escalate), **ticket transcripts channel ID**, add/remove/escalate messages, button labels, thread message  
  - Status type and text  
  - Info message list and channel IDs, and how often they are sent  

- **`data/warnings.json`**  
  Persisted warnings per server/user; do not edit by hand unless you know the format.

## Getting channel and role IDs

In Discord: enable Developer Mode (User Settings → App Settings → Advanced → Developer Mode). Right‑click a channel → **Copy Channel ID**; right‑click a role (in Server Settings → Roles) → **Copy Role ID**. Paste IDs into `config.json` (e.g. `modLogChannelId`, `panelChannelId`, `supportRoleId`, `supportManagerRoleId`, `ticketTranscriptsChannelId`, or `infoMessages.channelIds`).

## Ticket categories

Under `tickets.categories` in `config.json` you can define buttons for the ticket panel. Each category has:

- **`id`** – Short key used in the thread name (e.g. `general`, `bugs`). Use letters, numbers, hyphens, underscores.
- **`label`** – Text shown on the button and in the embed (e.g. `"General Support"`).
- **`emoji`** – Optional emoji for the button (e.g. `"💬"`).

Example: three categories show as three buttons; choosing “Bug Report” creates a thread named like `ticket-bugs-Username-abc12`. If `categories` is empty or omitted, the panel shows a single “Create Ticket” button and thread names have no category. Run `!ticketpanel` again after changing categories to refresh the panel.

## Mute role

Create a role (e.g. “Muted”), set its permissions so it cannot send messages or add reactions, place it **below** the bot’s role in the server role list, and put its ID in `config.json` under `moderation.muteRoleId`.
