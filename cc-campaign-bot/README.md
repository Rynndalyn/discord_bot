# Creator Congress Campaign Bot

This bot posts active campaigns into your Discord campaign channel and tracks who signs up with ✅. It saves every sign-up to Airtable, and members can see their own list in Discord or in the member portal.

## How it works

1. In Airtable, open **Proposals**, set **Active / Inactive** to 🟢 Active, and check **Post to Discord**.
2. Within about 2 minutes, the bot posts the campaign in the campaign channel with a ✅ reaction already on it.
3. A member reacts ✅ and a row appears in **Campaign Commitments** with Status = Committed.
4. If the member removes their reaction, the row changes to Status = Withdrawn. The row stays, so you keep the history.
5. When you set the proposal to 🟡 Inactive, the bot marks the post **[CLOSED]** and stops taking sign-ups. Setting it back to Active reopens the post.
6. Members type `/mycampaigns` to see their active and past campaigns. Only they can see the reply.
7. Members run `/link their@email.com` once to connect their Discord account to their Creator Applications record. Sign-ups made before linking are still recorded and get attached when they link.

If the bot goes offline, it checks every open post when it restarts and catches up on any reactions it missed.

## What was added to the Creator Congress Base

Nothing that already existed was changed or deleted.

| Table | New field(s) |
|---|---|
| Proposals | Post to Discord, Discord Message ID, Discord Closed, Discord Sign-ups (count of current commitments), Campaign Commitments (link) |
| Creator Applications | Discord User ID, Campaign Commitments (link) |
| **Campaign Commitments** (new table) | Commitment, Creator, Campaign, Status, Committed At, Withdrawn At, Discord User ID, Discord Username, Discord Message ID, Is Committed, Campaign Name, Campaign Status, Campaign End Date, Creator Email |

## One-time setup (about 30 minutes)

### 1. Create the Discord bot
1. Go to https://discord.com/developers/applications and click **New Application**. Name it something like "Creator Congress".
2. Under **Bot**, click **Reset Token** and copy the token. This is `DISCORD_TOKEN`.
3. Under **General Information**, copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
4. Under **OAuth2 → URL Generator**, tick the scopes `bot` and `applications.commands`. Then tick these bot permissions: View Channels, Send Messages, Embed Links, Add Reactions, Read Message History, and Manage Messages. Manage Messages lets the bot remove reactions on closed posts. Open the generated URL and add the bot to your server.
5. In Discord, turn on Developer Mode (User Settings → Advanced). Then right-click your server and choose Copy Server ID (`DISCORD_GUILD_ID`), and right-click the campaign channel and choose Copy Channel ID (`CAMPAIGN_CHANNEL_ID`).
6. Recommended: make the campaign channel read-only for members (no Send Messages) but leave Add Reactions on.

### 2. Create an Airtable token
At https://airtable.com/create/tokens, create a token with the scopes `data.records:read` and `data.records:write`, and give it access to **Creator Congress Base** only. This is `AIRTABLE_TOKEN`.

### 3. Host the bot
The bot has to stay running to see reactions. Railway is the simplest option (about $5 a month):
1. Push this folder to a private GitHub repo, or use `railway up` from the folder.
2. Create a new Railway project from the repo.
3. Under **Variables**, paste every value from `.env.example`.
4. Deploy. The logs should show `Logged in as …`, `Slash commands registered`, and `Reconciled reactions…`.

Render (Background Worker) or any small server running `npm install && npm start` also works. It needs Node 20 or newer.

To run it locally for testing, copy `.env.example` to `.env`, fill it in, then run `npm install` and `npm start`.

### 4. Member portal page
Add a list or table block on the **Campaign Commitments** table with two filters:
- **Creator Email** contains the logged-in user's email
- **Status** is Committed

Show these columns: Campaign Name, Campaign Status, Campaign End Date, Committed At. Set `PORTAL_URL` to this page so `/mycampaigns` can link to it. This works the same way in Softr or in whichever portal tool you switch to.

### 5. Tell members
Here's a sample announcement:
> Campaigns are now posted in #campaigns. React ✅ to sign up, and remove your reaction to drop out. First, run `/link your@email.com` (the email you applied with) so your sign-ups show up on your profile. Type `/mycampaigns` any time to see yours.

## Good to know
- The bot only counts ✅ on posts it made itself. You can change the emoji with `SIGNUP_EMOJI`.
- To re-post a campaign, clear its **Discord Message ID** in Airtable.
- `/link` only matches **Approved** members. Once a profile is linked, nobody else can claim it, so if someone links to the wrong person, a staff member has to clear **Discord User ID** on that record.
- Discord usernames are saved for reference, but matching uses the numeric Discord User ID, which never changes.
- Sign-ups are recorded publicly in Discord because reactions are visible to everyone. It's worth saying so in the channel description.
