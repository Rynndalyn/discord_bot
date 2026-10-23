// Public how-to guide, served at /guide (and the site root). Edit the text here; no other file needs to change.
// index.js passes in the shared page CSS and the branded header so this page matches the creator and partner pages.

export function guideHtml({ css, brand, discordInvite = '', signup = '✅' }) {
  const join = discordInvite
    ? `<a class="btn" href="${discordInvite}">Join the Discord</a>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>How Creator Congress campaigns work</title>
<meta name="description" content="How creators and partner organizations work together on Creator Congress campaigns: joining, posting, reviewing and getting paid.">
<style>${css}${GUIDE_CSS}</style></head><body><div class="wrap">
${brand}
<header class="hero">
  <h1>How Creator Congress campaigns work</h1>
  <p>Partner organizations post paid and volunteer campaigns. Creators join, make posts and get paid. Here's how it all works, step by step.</p>
  <div class="cta"><a class="btn" href="/portal">Sign in to the portal</a>${join}<a class="btn ghost" href="#creators">For creators</a><a class="btn ghost" href="#partners">For partner orgs</a><a class="btn ghost" href="/orgs">Orgs to get involved with</a></div>
</header>

<nav class="toc" aria-label="On this page">
  <div><b>Creators</b>
    <a href="#c-setup">Get set up</a><a href="#c-join">Join a campaign</a><a href="#c-confirmed">After you're confirmed</a><a href="#c-posts">Submit your posts</a><a href="#c-paid">Get paid</a><a href="#c-commands">Commands</a>
  </div>
  <div><b>Partner orgs</b>
    <a href="#p-setup">Get set up</a><a href="#p-choose">Choose creators</a><a href="#p-posts">Review posts</a><a href="#p-pay">Pay creators</a><a href="#p-commands">Commands</a>
  </div>
</nav>

<section id="creators">
<p class="eyebrow">For creators</p>

<h2 id="c-setup">1. Get set up</h2>
<ol class="steps">
  <li><b>Get approved.</b> Apply to Creator Congress. Once you're approved, you'll get an email with your personal <b>campaigns page</b> link. Bookmark it.</li>
  <li><b>Join the Discord (optional).</b> On your campaigns page, click <b>Join on Discord</b>. One click links your account and adds you to the server. Already in the server? Type <code>/link</code> followed by the email you applied with instead. Everything also works from your campaigns page, so Discord is optional.</li>
  <li><b>Turn on DMs.</b> The bot sends confirmations, invitations and payment check-ins by direct message. Right-click the server icon → <b>Privacy Settings</b> → turn on <b>Direct Messages</b>.</li>
</ol>

<h2 id="c-join">2. Find and join a campaign</h2>
<p>Every open campaign has its own post in <b>#active-campaigns</b>. The list shows the topline; click a post for the full brief.</p>
<ul>
  <li><b>Filter</b> with the tags at the top of the channel: 💰 Paid, 🤝 Unpaid, 🟢 Open, 🙋 Partner-reviewed, plus issue areas.</li>
  <li><b>Join</b> by reacting ${signup} on the campaign post, or with the <b>Join</b> button on your campaigns page.</li>
  <li><b>Spots</b> on each post counts everyone who's joined, including on the web, so it can be higher than the ${signup} count.</li>
  <li><b>Ask questions</b> by replying inside that campaign's post. Keep it on topic and respectful.</li>
</ul>
<div class="grid3">
  <div class="card"><h3>🟢 Open</h3><p>Your ${signup} confirms you right away.</p></div>
  <div class="card"><h3>🙋 Partner-reviewed</h3><p>Your ${signup} is a request. The org reviews your profile, and you'll get a DM either way.</p></div>
  <div class="card"><h3>✉️ Invite-only</h3><p>Not listed publicly. If an org invites you, you'll get a DM with <b>Accept</b> / <b>No thanks</b>.</p></div>
</div>
<p class="note"><b>Changed your mind?</b> Remove your ${signup} to drop out. If you'd already started the work, let the org know in your campaign thread.</p>

<h2 id="c-confirmed">3. After you're confirmed</h2>
<ul>
  <li>You're added to a <b>private thread</b> with the partner org. That's where the brief, questions and coordination happen.</li>
  <li>Your <b>lead contact</b> and the org's <b>payment details</b> (how to invoice or what they need from you) appear in that thread, on your campaigns page and in <code>/mycampaigns</code>.</li>
  <li>Keep contact and payment details from your thread private.</li>
</ul>

<h2 id="c-posts">4. Submit your posts</h2>
<p>If a campaign asks for posts, log each one as soon as it's live.</p>
<ol class="steps">
  <li>In Discord, type <code>/submit</code>, paste your post link, pick the campaign, and attach a screenshot of the post's insights (views, likes, comments, shares) if you can. You can also submit from your campaigns page, or just email the link (and a screenshot) to <a href="mailto:hello@creatorcongress.net">hello@creatorcongress.net</a> from the email you applied with. If you're on more than one campaign, put the campaign name in the subject. We'll reply to confirm.</li>
  <li>Some orgs review posts before they count. If they ask for changes, you'll get a DM with their note. Fix the post and submit it again.</li>
  <li>Track your progress (for example <i>2 of 3 posts</i>) in <code>/mycampaigns</code> or on your campaigns page.</li>
</ol>
<p class="note">Screenshots of your insights help us show partners the impact of your work. Numbers are read automatically, so nobody has to type them in.</p>

<h2 id="c-paid">5. Get paid</h2>
<div class="flow" aria-label="Payment steps">
  <span>⏳ Not due yet</span><i>→</i><span>📝 Waiting on posts</span><i>→</i><span>💸 Payment due</span><i>→</i><span>🏢 Org says paid</span><i>→</i><span class="ok">✅ Paid</span>
</div>
<ul>
  <li><b>When it's due:</b> payment is due within <b>30 days</b> after the campaign ends. If posts are required, it comes due once all of yours are in.</li>
  <li><b>Confirm it arrived:</b> when the org marks you paid, you'll get a DM asking you to confirm. Tap <b>Yes, I got paid</b>. You can also confirm on your campaigns page.</li>
  <li><b>If you don't reply</b> within 14 days, it's marked paid automatically.</li>
  <li><b>Not paid, or the amount's wrong?</b> Tap <b>Not yet</b> and add a note. The Creator Congress team follows up with the org.</li>
</ul>
<p class="note">Pay shown in <code>/mycampaigns</code> is an estimate until the org confirms payment.</p>

<h2 id="c-commands">Creator commands</h2>
<table><tbody>
  <tr><td><code>/link</code></td><td>Connect your Discord to your Creator Congress profile (one time)</td></tr>
  <tr><td><code>/mycampaigns</code></td><td>Your campaigns, invitations, post progress and payment status</td></tr>
  <tr><td><code>/submit</code></td><td>Log a post for a campaign</td></tr>
  <tr><td><code>/help</code></td><td>A quick summary inside Discord</td></tr>
</tbody></table>
<p class="muted small">Command replies are private to you. Reactions on campaign posts are public.</p>
</section>

<section id="partners">
<p class="eyebrow">For partner organizations</p>

<h2 id="p-setup">1. Get set up</h2>
<ul>
  <li><b>Your partner page.</b> Once your organization is approved, you'll get an email with a private <b>partner page</b> link. You can do everything from it without using Discord: review requests, find and invite creators, review posts and mark creators paid. Treat the link like a password.</li>
  <li><b>On Discord?</b> Click <b>Join on Discord</b> on your partner page, or type <code>/link</code> with the email from your organization's application. Your team gets a private channel under <b>Partner Organizations</b>, with a private thread for each campaign that includes only your confirmed creators and the Creator Congress team.</li>
  <li><b>Submit a campaign</b> through the campaign proposal form. Choose how creators join (Open, Partner-reviewed or Invite-only), whether you want suggested creators, the pay, dates, number of posts and whether you want to review posts.</li>
</ul>

<h2 id="p-choose">2. Choose your creators</h2>
<div class="grid3">
  <div class="card"><h3>🟢 Open</h3><p>Anyone who reacts ${signup} is confirmed. Best for broad reach.</p></div>
  <div class="card"><h3>🙋 Partner-reviewed</h3><p>Each request comes to you with the creator's profile. Approve or decline it by DM, with <code>/review</code> or on your partner page.</p></div>
  <div class="card"><h3>✉️ Invite-only</h3><p>Pick creators yourself from our suggestions, or search the whole network by name, issue, state and reach.</p></div>
</div>
<div class="card suggest"><h3>✨ Suggested creators (optional, any campaign)</h3><p>Check <b>Suggest Creators</b> on your proposal and we'll build a shortlist of creators who match your issues, location and reach, with a note on why each one fits. Invite the ones you want from your partner page or with <code>/invite</code>. It's always on for Invite-only campaigns, and you can add it to Open or Partner-reviewed campaigns to reach people who might not see the post. Want a fresh list later? Ask the Creator Congress team to refresh it.</p></div>
<ul>
  <li><b>Inviting creators:</b> use <b>Find creators</b> on your partner page, or <code>/invite</code> in Discord. You'll see profiles, issue areas and reach. Invited creators get a DM or email with <b>Accept</b> / <b>No thanks</b>. Contact info is shared only after a creator accepts.</li>
  <li><b>See who's in:</b> <code>/roster</code> or your partner page lists everyone confirmed on each campaign.</li>
  <li><b>Don't wait:</b> requests pending 7+ days are flagged to the Creator Congress team.</li>
</ul>

<h2 id="p-posts">3. Review posts</h2>
<p>If you turned on post review, each submitted post appears on your partner page (and by DM if you're on Discord) with <b>Approve</b> and <b>Ask for changes</b>. Only approved posts count toward the creator's total. If you ask for changes, the creator gets your note and can resubmit. With review off, posts count as soon as they're submitted.</p>

<h2 id="p-pay">4. Pay creators</h2>
<ol class="steps">
  <li>Confirmed creators see your lead contact and the <b>payment details</b> you entered on your proposal, so they know how to invoice you or what you need.</li>
  <li>Payment is due within <b>30 days</b> after the campaign ends, and only once the creator's required posts are in.</li>
  <li>When you've paid, click <b>Mark paid</b> on your partner page (or use <code>/payments</code>). You can adjust the amount if it differs.</li>
  <li>The creator is asked to confirm. It shows as <b>Paid</b> once they confirm, or automatically after 14 days with no reply.</li>
</ol>
<p class="note">Payments still unpaid 7+ days after the due date, and any "not paid" reports, go to the Creator Congress team to help sort out.</p>

<h2 id="p-commands">Partner commands</h2>
<table><tbody>
  <tr><td><code>/link</code></td><td>Connect your Discord to your organization (use your application email)</td></tr>
  <tr><td><code>/roster</code></td><td>Who's signed up for each of your campaigns</td></tr>
  <tr><td><code>/review</code></td><td>Approve or decline requests to join</td></tr>
  <tr><td><code>/invite</code></td><td>Invite suggested creators, or search for anyone by name</td></tr>
  <tr><td><code>/payments</code></td><td>Payment status for your creators, and mark them paid</td></tr>
</tbody></table>
</section>

<section class="help">
  <h2>Need help?</h2>
  <p>Creators: ask in your campaign thread or message a Creator Congress team member on Discord. Partner organizations: reply to any Creator Congress email.</p>
  <p class="muted small">Be respectful to partner organizations, staff and other creators. The Creator Congress code of conduct applies everywhere.</p>
</section>
</div></body></html>`;
}

const GUIDE_CSS = `
.hero{margin:18px 0 20px}.hero h1{font-size:34px;line-height:1.15;margin:6px 0 10px}.hero p{font-size:18px;color:var(--muted);margin:0}
.cta{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.btn{display:inline-block;padding:10px 16px;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent2));color:#fff;text-decoration:none;font-weight:700}
.btn.ghost{background:var(--card);color:var(--accent);border:1px solid var(--line)}
.toc{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:8px 0 28px}
.toc div{display:flex;flex-direction:column;gap:4px}.toc b{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.toc a{color:var(--ink);text-decoration:none}.toc a:hover{color:var(--accent)}
section{margin-top:36px}section+section{border-top:1px solid var(--line);padding-top:12px}
.eyebrow{display:inline-block;margin:0 0 4px;padding:4px 10px;border-radius:999px;background:var(--soft);color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
h2{font-size:22px;margin:28px 0 8px;scroll-margin-top:12px}h3{font-size:16px;margin:0 0 4px}
.steps{padding-left:22px}.steps li{margin:8px 0}
ul{padding-left:20px}ul li{margin:6px 0}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.card p{margin:0;color:var(--muted);font-size:15px}
.note{background:var(--warn-soft);border-left:4px solid var(--accent2);border-radius:8px;padding:10px 14px;margin:12px 0}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:12px 0}
.flow span{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:5px 10px;font-size:14px}.flow span.ok{background:var(--ok-soft);color:var(--ok);border-color:transparent}.flow i{color:var(--muted);font-style:normal}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
td{padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}tr:first-child td{border-top:0}td:first-child{white-space:nowrap;width:1%}
code{background:var(--soft);color:var(--violet);padding:1px 6px;border-radius:6px;font-size:.92em}
.suggest{margin:12px 0;border-color:var(--accent);background:var(--soft)}.suggest p{color:var(--ink)}
.emo{height:1.25em;width:auto;vertical-align:-0.25em}
.muted{color:var(--muted)}.small{font-size:14px}
.help{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:4px 18px 10px}
@media (max-width:640px){.grid3{grid-template-columns:1fr}.toc{grid-template-columns:1fr}.hero h1{font-size:28px}}
`;

// ---------- The same guide inside Discord ----------
// The bot keeps one post per topic in the channel set by GUIDE_CHANNEL_ID (a text channel, or a Forum), creating any
// that are missing and updating any whose text changed here. To give a topic its own channel (e.g. for Discord
// Onboarding resource pages), set GUIDE_CHANNELS like start:123,paid:456 using the keys below, or set
// GUIDE_RESOURCES=true and the bot makes a read-only channel per topic (named below) under a Resources category. {guide} becomes the guide page link, {campaigns} the campaigns channel.
export const DISCORD_GUIDE = [
  {
    key: 'start',
    channel: 'start-here',
    about: 'Start here: link your account, turn on DMs and find your campaigns page.',
    title: '🚀 Start here: get set up',
    pin: true,
    body: `**Welcome to Creator Congress campaigns!** Partner organizations post paid and volunteer campaigns, and creators join, post and get paid. Three things to do once:

**1. Link your account**
Click **Join on Discord** on your campaigns page, or type \`/link\` followed by the email you applied with. This connects your Discord to your Creator Congress profile.

**2. Turn on DMs**
The bot sends confirmations, invitations and payment check-ins by DM. Right-click the server icon → **Privacy Settings** → turn on **Direct Messages**.

**3. Bookmark your campaigns page**
Your approval email has a private link to your campaigns page. It shows everything you've joined, your posts and your payments.

Then head to {campaigns} to find your first campaign. The other posts here walk through each step.
📄 Full guide: {guide}`,
  },
  {
    key: 'join',
    channel: 'how-to-join',
    about: 'How to find and join campaigns, and what Open, Partner-reviewed and Invite-only mean.',
    title: '✅ How to join a campaign',
    body: `Every open campaign has its own post in {campaigns}. Use the tags at the top to filter, and click a post for the full brief.

**To join, react {signup} on the campaign post**, or use the **Join** button on your campaigns page.
🟢 **Open:** you're confirmed right away.
🙋 **Partner-reviewed:** your {signup} is a request. The org reviews your profile, and you'll get a DM either way.
✉️ **Invite-only:** these aren't listed. If an org invites you, you'll get a DM with **Accept** / **No thanks**.

**Spots** on each post counts everyone who's joined, including on the web, so it can be higher than the {signup} count.
**Questions?** Reply inside the campaign's post.
**Changed your mind?** Remove your {signup} to drop out. If you'd already started, let the org know in your campaign thread.

📄 {guide}#c-join`,
  },
  {
    key: 'confirmed',
    channel: 'after-youre-confirmed',
    about: 'Your private campaign thread, lead contact and payment details.',
    title: "🤝 After you're confirmed",
    body: `Once you're confirmed:

• You're added to a **private thread** with the partner org. That's where the brief, questions and coordination happen.
• Your **lead contact** and the org's **payment details** (how to invoice them or what they need from you) appear in that thread, on your campaigns page and in \`/mycampaigns\`.
• Keep contact and payment details from your thread private.

📄 {guide}#c-confirmed`,
  },
  {
    key: 'posts',
    channel: 'submitting-posts',
    about: 'How to log your posts with /submit and what happens when an org reviews them.',
    title: '📝 How to submit your posts',
    body: `If a campaign asks for posts, log each one as soon as it's live.

**1.** Type \`/submit\`, paste your post link and pick the campaign.
**2.** Attach a screenshot of the post's insights (views, likes, comments, shares) if you can. We read the numbers automatically.
**3.** Some orgs review posts before they count. If they ask for changes, you'll get a DM with their note. Fix it and submit again.

You can also submit from your campaigns page, or email the link (and a screenshot) to hello@creatorcongress.net from the email you applied with. On more than one campaign? Put the campaign name in the subject. Check your progress (like *2 of 3 posts*) in \`/mycampaigns\`.

📄 {guide}#c-posts`,
  },
  {
    key: 'paid',
    channel: 'getting-paid',
    about: "When payment is due, how to confirm it arrived, and what to do if it didn't.",
    title: '💸 How you get paid',
    body: `⏳ Not due yet → 📝 Waiting on posts → 💸 Payment due → 🏢 Org says paid → ✅ Paid

• **When:** payment is due within **30 days** after the campaign ends. If posts are required, it comes due once all of yours are in.
• **Confirm it arrived:** when the org marks you paid, you'll get a DM. Tap **Yes, I got paid**. You can also confirm on your campaigns page.
• **No reply in 14 days?** It's marked paid automatically.
• **Not paid, or the amount's wrong?** Tap **Not yet** and add a note. Our team follows up with the org.

Pay shown in \`/mycampaigns\` is an estimate until the org confirms.
📄 {guide}#c-paid`,
  },
  {
    key: 'commands',
    channel: 'commands',
    about: 'Every Creator Congress command for creators and partner orgs.',
    title: '⌨️ Commands',
    body: `**For creators**
\`/link\` – connect your Discord to your profile (one time)
\`/mycampaigns\` – your campaigns, invitations, post progress and payment status
\`/submit\` – log a post for a campaign
\`/help\` – quick summary

**For partner orgs**
\`/link\` – connect with your organization's application email
\`/roster\` – who's signed up for your campaigns
\`/review\` – approve or decline requests to join
\`/invite\` – invite suggested creators, or search anyone by name
\`/payments\` – payment status, and mark creators paid

Command replies are private to you. Reactions on campaign posts are public.
📄 {guide}`,
  },
  {
    key: 'partners',
    channel: 'for-partners',
    about: 'For partner organizations: choosing creators, reviewing posts and paying creators.',
    title: '🏢 For partner organizations',
    body: `**Your partner page.** Approved orgs get an email with a private partner page link. From it you can review requests, find and invite creators, review posts and mark creators paid, no Discord needed. Treat the link like a password.

**Choosing creators**
🟢 Open: anyone who reacts {signup} is confirmed.
🙋 Partner-reviewed: approve or decline each request by DM, with \`/review\` or on your partner page.
✉️ Invite-only: pick from our suggestions, or search the whole network by name, issue, state and reach with **Find creators** or \`/invite\`. Contact info is shared only after a creator accepts.
✨ Suggested creators (any campaign): check **Suggest Creators** on your proposal to get a shortlist of matching creators, with a note on why each fits. Invite the ones you want from your partner page or with \`/invite\`.

**Reviewing posts.** If post review is on, approve each post or ask for changes. Only approved posts count.

**Paying creators.** Payment is due within 30 days after the campaign ends, once required posts are in. Click **Mark paid** (or \`/payments\`). It shows as Paid once the creator confirms, or after 14 days.

📄 {guide}#partners`,
  },
  {
    key: 'orgs',
    channel: 'org-guide',
    about: 'Organizations to get involved with: creator networks, state programs, newsrooms and strategy groups.',
    title: '🗺️ Organizations to get involved with',
    body: `A map of the movement media landscape: where creators can find paid work, training, reporting to build on and community.

**Get paid:** creator networks and agencies like People First, Social Currant and Vocal Media.
**Go local:** state creator programs in Iowa, Maine, Michigan, Minnesota, New Hampshire, North Carolina, Pennsylvania, Wisconsin and the South.
**Find the story:** independent and creator-led newsrooms that take tips and pitches.
**Sharpen the message:** narrative and culture strategy groups with free messaging guides.
**Fight the noise:** media accountability, tech and AI groups.

**Before you take paid work, ask:** who's funding it (the Code of Conduct asks you to share who pays you somewhere public), whether you keep editorial control, and how and when you get paid.

🗺️ Browse and search all of them: {orgs}`,
  },
  {
    key: 'help',
    channel: 'need-help',
    about: 'Where to ask questions and get help.',
    title: '🆘 Need help?',
    body: `• **About a campaign:** ask in that campaign's post, or in your private campaign thread once you're confirmed.
• **About payment or anything personal:** use your private thread, or message a Creator Congress team member.
• **Partner orgs:** reply to any Creator Congress email.

Be respectful to partner orgs, staff and other creators. Our code of conduct applies everywhere.
📄 Full guide: {guide}`,
  },
];

// ---------- Org guide page (/orgs) ----------
// Generated from the "Organizations to Get Involved With" doc. {{LOGO}} is swapped for the logo by index.js.
export const ORGS_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Creator Congress Org Guide</title>
<meta name="claude:viewport-fit-sides" content="cover">

<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Instrument+Sans:wght@400;600;700&display=swap">
<style>
/* Layout: pink-to-orange masthead band, sticky section chips, then sections of org cards in a 2-col grid. */
:root{
  --bg:#fff8f5; --card:#ffffff; --ink:#24151c; --muted:#6e5a63; --line:#f1dfe4;
  --pink:#e6287e; --orange:#ff7a1f; --soft:#fde8f1; --on-brand:#ffffff;
  --display:"Bricolage Grotesque", "Arial Black", system-ui, sans-serif;
  --body:"Instrument Sans", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#170f13; --card:#22161c; --ink:#f6ecef; --muted:#c0a9b3; --line:#3a2630;
  --pink:#ff5fa2; --orange:#ff9a4d; --soft:#3a1a2a; --on-brand:#1a0a11; color-scheme:dark}
}

:root[data-theme="dark"]{
  --bg:#170f13; --card:#22161c; --ink:#f6ecef; --muted:#c0a9b3; --line:#3a2630;
  --pink:#ff5fa2; --orange:#ff9a4d; --soft:#3a1a2a; --on-brand:#1a0a11; color-scheme:dark}

*{box-sizing:border-box}

body{background:var(--bg);color:var(--ink);font:16px/1.55 var(--body);margin:0}

a{color:var(--pink)}
 a:hover{color:var(--orange)}

a:focus-visible,input:focus-visible{outline:2px solid var(--orange);outline-offset:2px;border-radius:6px}

.wrap{max-width:1080px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}

.mast{background:linear-gradient(115deg,var(--pink),var(--orange));color:var(--on-brand)}

.mast .wrap{padding-block:40px 44px;display:grid;gap:14px}

.wordmark{font:800 13px/1 var(--display);letter-spacing:.18em;text-transform:uppercase;display:flex;align-items:center;gap:10px}

.wordmark img{height:34px;width:auto;display:block;background:#fff;border-radius:8px;padding:3px 6px}
.wordmark i{width:26px;height:26px;border-radius:50%;background:var(--on-brand);color:var(--pink);display:grid;place-items:center;font-style:normal;font-size:14px;letter-spacing:0}

h1{font:800 clamp(34px,6vw,60px)/1.02 var(--display);margin:0;letter-spacing:-.02em;text-wrap:balance;max-width:16ch}

.lede{font-size:18px;max-width:58ch;margin:0;opacity:.95}

.count{font:600 13px/1 var(--body);letter-spacing:.08em;text-transform:uppercase;opacity:.9}

.chips{position:sticky;top:env(safe-area-inset-top,0px);z-index:5;background:var(--bg);border-bottom:1px solid var(--line)}

body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--bg)}

.chips .wrap{display:flex;gap:8px;align-items:center;padding-block:10px;overflow-x:auto;scrollbar-width:none}

.chip{flex:none;font:600 14px/1 var(--body);text-decoration:none;color:var(--ink);border:1px solid var(--line);background:var(--card);padding:9px 14px;border-radius:999px;white-space:nowrap}

.chip:hover{border-color:var(--pink);color:var(--pink)}

.search{flex:1 0 180px;min-width:160px;font:15px var(--body);padding:9px 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink)}

main .wrap{padding-block:28px 56px;display:grid;gap:52px}

.start{display:grid;grid-template-columns:1.2fr 1fr;gap:20px}

.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px}

.panel h2{font:800 22px/1.15 var(--display);margin:0 0 12px}

.route{display:grid;gap:2px;margin:0;padding:0;list-style:none}

.route a{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px dashed var(--line);text-decoration:none;color:var(--ink)}

.route a span:last-child{color:var(--pink);font-weight:600;text-align:right}

.route li:last-child a{border-bottom:0}

.asks{margin:0;padding-left:22px;display:grid;gap:10px}

.asks b{display:block}

.panel.hot{background:var(--soft);border-color:transparent}

section{display:grid;gap:16px;scroll-margin-top:72px}

.kicker{font:700 12px/1 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--orange)}

section h2{font:800 clamp(26px,3.6vw,36px)/1.08 var(--display);margin:6px 0 0;letter-spacing:-.01em;text-wrap:balance}

.intro{margin:0;color:var(--muted);max-width:62ch}

.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}

.org{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 18px 16px;display:grid;gap:8px;align-content:start;min-width:0}

.org h3{font:700 19px/1.2 var(--display);margin:0;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}

.org h3 a{color:var(--ink);text-decoration:none;background:linear-gradient(var(--pink),var(--pink)) 0 100%/0 2px no-repeat;transition:background-size .2s}

.org h3 a:hover{background-size:100% 2px}

.org h3 .arrow{color:var(--pink);font-size:15px}

.state{font:700 11px/1 var(--body);letter-spacing:.08em;text-transform:uppercase;background:var(--soft);color:var(--pink);padding:5px 8px;border-radius:999px}

.what{margin:0;font-size:15px}

.how{margin:0;font-size:14px;color:var(--muted);border-top:1px solid var(--line);padding-top:8px}

.how b{color:var(--ink)}

.nolink{font:600 11px var(--body);color:var(--muted);letter-spacing:.04em}

.empty{display:none;color:var(--muted)}

.sources{font-size:14px;color:var(--muted)}

.sources ul{margin:8px 0 0;padding-left:18px;display:grid;gap:4px}

.foot{background:var(--soft)}

.foot .wrap{padding-block:28px;display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between;align-items:center}

.foot p{margin:0;font-weight:600}

.btn{display:inline-block;padding:11px 18px;border-radius:999px;background:linear-gradient(90deg,var(--pink),var(--orange));color:var(--on-brand);text-decoration:none;font-weight:700}

.btn:hover{color:var(--on-brand);filter:brightness(1.05)}

@media (max-width:760px){.grid,.start{grid-template-columns:1fr}
}

@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}
}

html{scroll-behavior:smooth}

</style>
</head><body><header class="mast"><div class="wrap">
<div class="wordmark">{{LOGO}}Creator Congress</div>
<h1>Organizations to Get Involved With</h1>
<p class="lede">A map of the movement media landscape: the networks, newsrooms and strategy shops where creators can find paid work, training, reporting to build on and a community.</p>
<div class="count">56 organizations · 5 lanes · Updated October 2026</div>
</div></header>
<nav class="chips" aria-label="Sections"><div class="wrap"><a class="chip" href="#networks">Get paid</a><a class="chip" href="#states">Go local</a><a class="chip" href="#news">Find the story</a><a class="chip" href="#narrative">Sharpen the message</a><a class="chip" href="#tech">Fight the noise</a><input id="q" class="search" type="search" placeholder="Search orgs, states, topics" aria-label="Search organizations"></div></nav>
<main><div class="wrap">
<div class="start">
<div class="panel"><h2>Start here</h2><ul class="route"><li><a href="#networks"><span>Get paid for political or advocacy content</span><span>Creator networks &amp; agencies →</span></a></li>
<li><a href="#states"><span>Get trained and work on races near you</span><span>State creator programs →</span></a></li>
<li><a href="#news"><span>Find reporting to explain, or pitch a story</span><span>Independent &amp; creator-led news →</span></a></li>
<li><a href="#narrative"><span>Sharpen how you talk about the issues</span><span>Narrative &amp; culture strategy →</span></a></li>
<li><a href="#tech"><span>Fight disinformation or cover tech</span><span>Media accountability, tech &amp; information integrity →</span></a></li>
</ul></div>
<div class="panel hot"><h2>Before you take paid work, ask:</h2><ol class="asks">
<li><b>Who's funding this, and can I disclose it?</b>Disclosure laws vary by state and platform. The Creator Congress Code of Conduct asks you to share who pays you somewhere public, and to follow the rules wherever you post.</li>

<li><b>Do I keep editorial control?</b>The best programs give you a brief, not a script.</li>

<li><b>How and when do I get paid?</b>Get the rate, the deliverables and the payment date in writing.</li>

</ol></div></div>
<section id="networks"><div><div class="kicker">Get paid</div><h2>Creator networks &amp; agencies</h2></div><p class="intro">These groups match creators with campaigns, causes and paid opportunities.</p><div class="grid"><article class="org" data-q="creator congress that&#x27;s us. a creator-led network with a code of conduct, campaign briefs and paid opportunities from partner orgs. you&#x27;re probably already in. invite a creator you trust. "><h3><a href="https://creatorcongress.net" target="_blank" rel="noopener">Creator Congress</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">That&#x27;s us. A creator-led network with a Code of Conduct, campaign briefs and paid opportunities from partner orgs.</p><p class="how"><b>How to plug in:</b> You&#x27;re probably already in. Invite a creator you trust.</p></article>
<article class="org" data-q="people first one of the largest influencer communities in social impact, with 22,000+ verified creators matched to campaigns, nonprofits and advocacy groups. join the creator community, get the influencer impact: creator edition newsletter, and work toward creator studio, its curated membership tier. "><h3><a href="https://peoplefirst.cc" target="_blank" rel="noopener">People First</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">One of the largest influencer communities in social impact, with 22,000+ verified creators matched to campaigns, nonprofits and advocacy groups.</p><p class="how"><b>How to plug in:</b> Join the creator community, get the Influencer Impact: Creator Edition newsletter, and work toward Creator Studio, its curated membership tier.</p></article>
<article class="org" data-q="social currant connects mission-driven orgs with creators on tiktok, instagram and youtube, and handles contracts, payments and tax forms. strong on local and state campaigns. a good route into paid campaign work, whoever you know. sign up through its site. "><h3><a href="https://socialcurrant.co" target="_blank" rel="noopener">Social Currant</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Connects mission-driven orgs with creators on TikTok, Instagram and YouTube, and handles contracts, payments and tax forms. Strong on local and state campaigns.</p><p class="how"><b>How to plug in:</b> A good route into paid campaign work, whoever you know. Sign up through its site.</p></article>
<article class="org" data-q="vocal media a mission-driven media company that connects social change movements with internet culture through influencer campaigns. check its site and job board for creator and campaign roles. "><h3><a href="https://vocal-media.io/" target="_blank" rel="noopener">Vocal Media</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A mission-driven media company that connects social change movements with internet culture through influencer campaigns.</p><p class="how"><b>How to plug in:</b> Check its site and job board for creator and campaign roles.</p></article>
<article class="org" data-q="chorus a nonprofit founded by strategist stuart perelmuter and creator brian tyler cohen to connect progressive creators with lawmakers and build funding for independent progressive voices online. it&#x27;s the nonprofit arm of good influence, an influencer agency. access to briefings with elected officials. ask about disclosure terms first. "><h3>Chorus <span class="nolink">no site listed</span></h3><p class="what">A nonprofit founded by strategist Stuart Perelmuter and creator Brian Tyler Cohen to connect progressive creators with lawmakers and build funding for independent progressive voices online. It&#x27;s the nonprofit arm of Good Influence, an influencer agency.</p><p class="how"><b>How to plug in:</b> Access to briefings with elected officials. Ask about disclosure terms first.</p></article>
<article class="org" data-q="double tap democracy runs paid creator programs for statewide races, including the 2025 virginia and new jersey governor&#x27;s races. it brings in creators from all niches and eases them into political content. a fit if you don&#x27;t usually post about politics but want to start. "><h3>Double Tap Democracy <span class="nolink">no site listed</span></h3><p class="what">Runs paid creator programs for statewide races, including the 2025 Virginia and New Jersey governor&#x27;s races. It brings in creators from all niches and eases them into political content.</p><p class="how"><b>How to plug in:</b> A fit if you don&#x27;t usually post about politics but want to start.</p></article>
<article class="org" data-q="gen-z for change a youth-led coalition of creators using tiktok and other platforms for progressive advocacy and civic education. join a creator coalition of your peers. "><h3><a href="https://genzforchange.org" target="_blank" rel="noopener">Gen-Z for Change</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A youth-led coalition of creators using TikTok and other platforms for progressive advocacy and civic education.</p><p class="how"><b>How to plug in:</b> Join a creator coalition of your peers.</p></article>
<article class="org" data-q="digital ground game a national, community-driven nonprofit doing evidence-based political action, from online mobilization to canvassing. an active discord and a creator corner. "><h3><a href="https://digitalgroundgame.org" target="_blank" rel="noopener">Digital Ground Game</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A national, community-driven nonprofit doing evidence-based political action, from online mobilization to canvassing.</p><p class="how"><b>How to plug in:</b> An active Discord and a Creator Corner.</p></article>
<article class="org" data-q="american accountability network a consortium of creators, organizers and influencers that shapes political narratives and recruits field volunteers. supports democratic and progressive candidates. a peer network of political creators. "><h3><a href="https://americanaccountabilitynetwork.org/" target="_blank" rel="noopener">American Accountability Network</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A consortium of creators, organizers and influencers that shapes political narratives and recruits field volunteers. Supports Democratic and progressive candidates.</p><p class="how"><b>How to plug in:</b> A peer network of political creators.</p></article>
<article class="org" data-q="just win a team of creators founded by qasim rashid, using storytelling and relational messaging on economic justice, climate and democracy. creator-to-creator collaboration. "><h3><a href="https://justwinteam.com" target="_blank" rel="noopener">Just Win</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A team of creators founded by Qasim Rashid, using storytelling and relational messaging on economic justice, climate and democracy.</p><p class="how"><b>How to plug in:</b> Creator-to-creator collaboration.</p></article>
</div><p class="empty">No matches in this section.</p></section>
<section id="states"><div><div class="kicker">Go local</div><h2>State creator programs</h2></div><p class="intro">State cohorts are the fastest way to get trained, briefed and often paid for local content, on the races and issues where a few thousand votes decide things.</p><div class="grid"><article class="org" data-q="iowa creator corps trains iowa creators to make fact-based, pro-democracy content for local audiences. apply for a future cohort on the site. iowa"><h3><a href="https://iowacreatorcorps.com" target="_blank" rel="noopener">Iowa Creator Corps</a><span class="arrow" aria-hidden="true">↗</span><span class="state">Iowa</span></h3><p class="what">Trains Iowa creators to make fact-based, pro-democracy content for local audiences.</p><p class="how"><b>How to plug in:</b> Apply for a future cohort on the site.</p></article>
<article class="org" data-q="mainframe a creator and amplifier network on affordability and everyday life in maine. content that moves people to participate, without partisan framing. maine"><h3><a href="https://mainframenow.org" target="_blank" rel="noopener">MainFrame</a><span class="arrow" aria-hidden="true">↗</span><span class="state">Maine</span></h3><p class="what">A creator and amplifier network on affordability and everyday life in Maine.</p><p class="how"><b>How to plug in:</b> Content that moves people to participate, without partisan framing.</p></article>
<article class="org" data-q="engage michigan communications, media and research support for grassroots groups in bipoc, low-income and rural communities. home of michigan&#x27;s creator collaborative on local issues. michigan"><h3><a href="https://engagemichigan.org" target="_blank" rel="noopener">Engage Michigan</a><span class="arrow" aria-hidden="true">↗</span><span class="state">Michigan</span></h3><p class="what">Communications, media and research support for grassroots groups in BIPOC, low-income and rural communities.</p><p class="how"><b>How to plug in:</b> Home of Michigan&#x27;s creator collaborative on local issues.</p></article>
<article class="org" data-q="groundwork institute political education and organizing training, including a creator cohort that grows creators&#x27; existing platforms. training plus paid activations. minnesota"><h3><a href="https://groundworkmn.org" target="_blank" rel="noopener">Groundwork Institute</a><span class="arrow" aria-hidden="true">↗</span><span class="state">Minnesota</span></h3><p class="what">Political education and organizing training, including a creator cohort that grows creators&#x27; existing platforms.</p><p class="how"><b>How to plug in:</b> Training plus paid activations.</p></article>
<article class="org" data-q="unrig new hampshire a pilot with values-aligned creators reaching granite staters on instagram and tiktok. creators speak in their own voice. partners, not ad placements. new hampshire"><h3>Unrig New Hampshire <span class="nolink">no site listed</span><span class="state">New Hampshire</span></h3><p class="what">A pilot with values-aligned creators reaching Granite Staters on Instagram and TikTok.</p><p class="how"><b>How to plug in:</b> Creators speak in their own voice. Partners, not ad placements.</p></article>
<article class="org" data-q="influence nc a nonpartisan nonprofit informing young people about state and local government and voting. a paid, year-round program open to any nc-based creator. north carolina"><h3><a href="https://www.influencenc.org/" target="_blank" rel="noopener">Influence NC</a><span class="arrow" aria-hidden="true">↗</span><span class="state">North Carolina</span></h3><p class="what">A nonpartisan nonprofit informing young people about state and local government and voting.</p><p class="how"><b>How to plug in:</b> A paid, year-round program open to any NC-based creator.</p></article>
<article class="org" data-q="red wine &amp; blue “a sisterhood of diverse communities” standing up to extremism, with local groups and online events. a great fit if your audience is suburban women and moms. ohio"><h3><a href="https://redwine.blue" target="_blank" rel="noopener">Red Wine &amp; Blue</a><span class="arrow" aria-hidden="true">↗</span><span class="state">Ohio</span></h3><p class="what">“A sisterhood of diverse communities” standing up to extremism, with local groups and online events.</p><p class="how"><b>How to plug in:</b> A great fit if your audience is suburban women and moms.</p></article>
<article class="org" data-q="one pennsylvania statewide organizing with briefings and paid post opportunities on voting, election protection and the economy. the most developed state creator program in the network. pennsylvania"><h3><a href="https://www.onepa.org/" target="_blank" rel="noopener">One Pennsylvania</a><span class="arrow" aria-hidden="true">↗</span><span class="state">Pennsylvania</span></h3><p class="what">Statewide organizing with briefings and paid post opportunities on voting, election protection and the economy.</p><p class="how"><b>How to plug in:</b> The most developed state creator program in the network.</p></article>
<article class="org" data-q="all in wisconsin a communications org building a narrative foundation for racial justice, with messaging guides and toolkits. creator briefs and trainings. wisconsin"><h3><a href="https://allinwi.org" target="_blank" rel="noopener">All In Wisconsin</a><span class="arrow" aria-hidden="true">↗</span><span class="state">Wisconsin</span></h3><p class="what">A communications org building a narrative foundation for racial justice, with messaging guides and toolkits.</p><p class="how"><b>How to plug in:</b> Creator briefs and trainings.</p></article>
<article class="org" data-q="y&#x27;all vote founded by three southern creators to share plain-language information on state and local elections. sign up on the site and join hundreds of creators. the south"><h3><a href="https://yallvote.org" target="_blank" rel="noopener">Y&#x27;all Vote</a><span class="arrow" aria-hidden="true">↗</span><span class="state">The South</span></h3><p class="what">Founded by three Southern creators to share plain-language information on state and local elections.</p><p class="how"><b>How to plug in:</b> Sign up on the site and join hundreds of creators.</p></article>
<article class="org" data-q="onyx impact strengthens black communities by countering harmful online information. it made we all we got, a “digital green book.” fact-checked tools for your audience and comments. ga, va, la +"><h3><a href="https://onyximpact.org" target="_blank" rel="noopener">Onyx Impact</a><span class="arrow" aria-hidden="true">↗</span><span class="state">GA, VA, LA +</span></h3><p class="what">Strengthens Black communities by countering harmful online information. It made We All We Got, a “Digital Green Book.”</p><p class="how"><b>How to plug in:</b> Fact-checked tools for your audience and comments.</p></article>
<article class="org" data-q="progressnow a progressive communications network with state affiliates. find your state affiliate for local rapid response. 28 states"><h3><a href="https://progressnow.org" target="_blank" rel="noopener">ProgressNow</a><span class="arrow" aria-hidden="true">↗</span><span class="state">28 states</span></h3><p class="what">A progressive communications network with state affiliates.</p><p class="how"><b>How to plug in:</b> Find your state affiliate for local rapid response.</p></article>
</div><p class="empty">No matches in this section.</p></section>
<section id="news"><div><div class="kicker">Find the story</div><h2>Independent &amp; creator-led news</h2></div><p class="intro">Reporting to build explainers on, plus newsrooms that take tips, pitches and contributors.</p><div class="grid"><article class="org" data-q="more perfect union a nonprofit journalism and advocacy org that builds power for working people. send tips and story ideas from your audience. "><h3><a href="https://perfectunion.us" target="_blank" rel="noopener">More Perfect Union</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A nonprofit journalism and advocacy org that builds power for working people.</p><p class="how"><b>How to plug in:</b> Send tips and story ideas from your audience.</p></article>
<article class="org" data-q="courier newsroom a network of local digital newsrooms covering state and community news. shareable local reporting and election-season creator activations. "><h3><a href="https://couriernewsroom.com" target="_blank" rel="noopener">Courier Newsroom</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A network of local digital newsrooms covering state and community news.</p><p class="how"><b>How to plug in:</b> Shareable local reporting and election-season creator activations.</p></article>
<article class="org" data-q="nowmedia nowthis combined with accelerate change&#x27;s publishers (pushblack, pulso, parentstogether), reaching 190m+ people a month. huge reach to audiences political media misses. "><h3><a href="https://acceleratechange.org" target="_blank" rel="noopener">NowMedia</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">NowThis combined with Accelerate Change&#x27;s publishers (PushBlack, Pulso, ParentsTogether), reaching 190M+ people a month.</p><p class="how"><b>How to plug in:</b> Huge reach to audiences political media misses.</p></article>
<article class="org" data-q="watering hole media video-first social and podcast content that counters disinformation with culturally relevant, honest material. a distributed model that brings creators in to produce content. "><h3><a href="https://www.wateringholemedia.com/" target="_blank" rel="noopener">Watering Hole Media</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Video-first social and podcast content that counters disinformation with culturally relevant, honest material.</p><p class="how"><b>How to plug in:</b> A distributed model that brings creators in to produce content.</p></article>
<article class="org" data-q="meidastouch a creator-founded progressive news network on youtube, podcasts and social. proof creator-led news can scale. follow and collaborate. "><h3><a href="https://www.meidastouch.com" target="_blank" rel="noopener">MeidasTouch</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A creator-founded progressive news network on YouTube, podcasts and social.</p><p class="how"><b>How to plug in:</b> Proof creator-led news can scale. Follow and collaborate.</p></article>
<article class="org" data-q="crooked media the progressive podcast and media company behind pod save america. crooked&#x27;s vote save america mobilizes listeners around elections. "><h3><a href="https://crooked.com" target="_blank" rel="noopener">Crooked Media</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">The progressive podcast and media company behind Pod Save America.</p><p class="how"><b>How to plug in:</b> Crooked&#x27;s Vote Save America mobilizes listeners around elections.</p></article>
<article class="org" data-q="zeteo mehdi hasan&#x27;s independent, subscriber-funded news and opinion outlet. a model for going independent on substack-style platforms. "><h3><a href="https://zeteo.com" target="_blank" rel="noopener">Zeteo</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Mehdi Hasan&#x27;s independent, subscriber-funded news and opinion outlet.</p><p class="how"><b>How to plug in:</b> A model for going independent on Substack-style platforms.</p></article>
<article class="org" data-q="capital b a nonprofit newsroom for black communities, with national and local coverage. reporting to cite and amplify. "><h3><a href="https://capitalbnews.org" target="_blank" rel="noopener">Capital B</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A nonprofit newsroom for Black communities, with national and local coverage.</p><p class="how"><b>How to plug in:</b> Reporting to cite and amplify.</p></article>
<article class="org" data-q="the 19th a nonprofit newsroom covering gender, politics and policy. explainers on policy that hits women and lgbtq+ people. "><h3><a href="https://19thnews.org" target="_blank" rel="noopener">The 19th</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A nonprofit newsroom covering gender, politics and policy.</p><p class="how"><b>How to plug in:</b> Explainers on policy that hits women and LGBTQ+ people.</p></article>
<article class="org" data-q="bolts covers the local races and offices, like das, sheriffs and courts, that shape criminal justice and democracy. down-ballot explainers you can stitch. "><h3><a href="https://boltsmag.org" target="_blank" rel="noopener">Bolts</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Covers the local races and offices, like DAs, sheriffs and courts, that shape criminal justice and democracy.</p><p class="how"><b>How to plug in:</b> Down-ballot explainers you can stitch.</p></article>
<article class="org" data-q="votebeat nonpartisan reporting on how elections are run. accurate facts for election protection content. "><h3><a href="https://www.votebeat.org" target="_blank" rel="noopener">Votebeat</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Nonpartisan reporting on how elections are run.</p><p class="how"><b>How to plug in:</b> Accurate facts for election protection content.</p></article>
<article class="org" data-q="the barbed wire “texas news with teeth”: investigations, perspectives and its queer texas section. check its contributors page. "><h3><a href="https://thebarbedwire.com" target="_blank" rel="noopener">The Barbed Wire</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">“Texas News with Teeth”: investigations, perspectives and its Queer Texas section.</p><p class="how"><b>How to plug in:</b> Check its contributors page.</p></article>
<article class="org" data-q="city bureau documenters trains and pays community members to document local public meetings. get paid to cover city council and school board meetings in many cities. "><h3><a href="https://citybureau.org" target="_blank" rel="noopener">City Bureau Documenters</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Trains and pays community members to document local public meetings.</p><p class="how"><b>How to plug in:</b> Get paid to cover city council and school board meetings in many cities.</p></article>
<article class="org" data-q="her campus a college media network with student writers and creators nationwide. a channel for campus and student audiences. "><h3><a href="https://www.hercampus.com" target="_blank" rel="noopener">Her Campus</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A college media network with student writers and creators nationwide.</p><p class="how"><b>How to plug in:</b> A channel for campus and student audiences.</p></article>
<article class="org" data-q="civics made easy (pbs) a public media series explaining how government works. trusted, nonpartisan explainers to cite. "><h3><a href="https://pbs.org/show/civics-made-easy" target="_blank" rel="noopener">Civics Made Easy (PBS)</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A public media series explaining how government works.</p><p class="how"><b>How to plug in:</b> Trusted, nonpartisan explainers to cite.</p></article>
</div><p class="empty">No matches in this section.</p></section>
<section id="narrative"><div><div class="kicker">Sharpen the message</div><h2>Narrative &amp; culture strategy</h2></div><p class="intro">Research, messaging guidance and culture-change shops that help you talk about the issues in ways that land.</p><div class="grid"><article class="org" data-q="pop culture collaborative a philanthropic resource that funds and connects people using pop culture to shift narratives about people of color, immigrants, refugees, muslims and indigenous people. fellowships, gatherings and research on culture change. "><h3><a href="https://popcollab.org" target="_blank" rel="noopener">Pop Culture Collaborative</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A philanthropic resource that funds and connects people using pop culture to shift narratives about people of color, immigrants, refugees, Muslims and Indigenous people.</p><p class="how"><b>How to plug in:</b> Fellowships, gatherings and research on culture change.</p></article>
<article class="org" data-q="the opportunity agenda a social justice communications lab with public opinion research and messaging guides. free message guides on immigration, race, economy and more. "><h3><a href="https://www.opportunityagenda.org" target="_blank" rel="noopener">The Opportunity Agenda</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A social justice communications lab with public opinion research and messaging guides.</p><p class="how"><b>How to plug in:</b> Free message guides on immigration, race, economy and more.</p></article>
<article class="org" data-q="harmony labs researches media audiences and how narratives spread across platforms. data on what your audience is actually watching. "><h3><a href="https://harmonylabs.org" target="_blank" rel="noopener">Harmony Labs</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Researches media audiences and how narratives spread across platforms.</p><p class="how"><b>How to plug in:</b> Data on what your audience is actually watching.</p></article>
<article class="org" data-q="define american a culture change org that uses storytelling to shift how america sees immigrants. resources and consulting for immigration storytelling. "><h3><a href="https://defineamerican.com" target="_blank" rel="noopener">Define American</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A culture change org that uses storytelling to shift how America sees immigrants.</p><p class="how"><b>How to plug in:</b> Resources and consulting for immigration storytelling.</p></article>
<article class="org" data-q="color of change a racial justice organization with major work on media, hollywood and tech accountability. campaigns to amplify and creator partnerships. "><h3><a href="https://colorofchange.org" target="_blank" rel="noopener">Color Of Change</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A racial justice organization with major work on media, Hollywood and tech accountability.</p><p class="how"><b>How to plug in:</b> Campaigns to amplify and creator partnerships.</p></article>
<article class="org" data-q="way to rise a nonpartisan fund and strategy center for multiracial democracy in the south and southwest, investing in leaders, data and narrative. concert pop-ups and short-form social around early voting. "><h3><a href="https://www.waytorise.org" target="_blank" rel="noopener">Way to Rise</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A nonpartisan fund and strategy center for multiracial democracy in the South and Southwest, investing in leaders, data and narrative.</p><p class="how"><b>How to plug in:</b> Concert pop-ups and short-form social around early voting.</p></article>
<article class="org" data-q="center for nonviolent conflict research research and education on how nonviolent movements win, including the hum podcast. strategy for organizing around new fights like data centers and ai. "><h3><a href="https://nonviolent-conflict.org" target="_blank" rel="noopener">Center for Nonviolent Conflict Research</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Research and education on how nonviolent movements win, including The Hum podcast.</p><p class="how"><b>How to plug in:</b> Strategy for organizing around new fights like data centers and AI.</p></article>
<article class="org" data-q="addition reaches working-class people, trains organizers and uses storytelling to challenge narratives that write off people and places. a fit for rural and working-class audiences. "><h3><a href="https://www.additionproject.org/" target="_blank" rel="noopener">ADDITION</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Reaches working-class people, trains organizers and uses storytelling to challenge narratives that write off people and places.</p><p class="how"><b>How to plug in:</b> A fit for rural and working-class audiences.</p></article>
<article class="org" data-q="public democracy america uses digital tools with partners on affordability, ethical ai and veteran poll worker recruitment. concrete asks, like poll worker sign-ups. "><h3><a href="https://www.publicdemocracyamerica.org" target="_blank" rel="noopener">Public Democracy America</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Uses digital tools with partners on affordability, ethical AI and veteran poll worker recruitment.</p><p class="how"><b>How to plug in:</b> Concrete asks, like poll worker sign-ups.</p></article>
<article class="org" data-q="kairos fellowship digital campaigns and trainings on using the internet to build power for racial and economic justice. level up your digital organizing skills. "><h3><a href="https://kairosfellows.org" target="_blank" rel="noopener">Kairos Fellowship</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Digital campaigns and trainings on using the internet to build power for racial and economic justice.</p><p class="how"><b>How to plug in:</b> Level up your digital organizing skills.</p></article>
<article class="org" data-q="harness brings artists and changemakers together in curated spaces for collaboration and shared learning. community with artists working on social change. "><h3><a href="https://iwillharness.com" target="_blank" rel="noopener">HARNESS</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Brings artists and changemakers together in curated spaces for collaboration and shared learning.</p><p class="how"><b>How to plug in:</b> Community with artists working on social change.</p></article>
</div><p class="empty">No matches in this section.</p></section>
<section id="tech"><div><div class="kicker">Fight the noise</div><h2>Media accountability, tech &amp; information integrity</h2></div><p class="intro">Watchdogs, researchers and campaigns working on disinformation, platforms and AI.</p><div class="grid"><article class="org" data-q="free press fights for media and tech policy that serves the public, from local news funding to platform accountability. not the bari weiss free press. campaigns and explainers on who controls the media. "><h3><a href="https://www.freepress.net" target="_blank" rel="noopener">Free Press</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Fights for media and tech policy that serves the public, from local news funding to platform accountability. Not the Bari Weiss Free Press.</p><p class="how"><b>How to plug in:</b> Campaigns and explainers on who controls the media.</p></article>
<article class="org" data-q="media matters for america monitors and corrects misinformation in conservative media. fast research to cite in rapid response. "><h3><a href="https://www.mediamatters.org" target="_blank" rel="noopener">Media Matters for America</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Monitors and corrects misinformation in conservative media.</p><p class="how"><b>How to plug in:</b> Fast research to cite in rapid response.</p></article>
<article class="org" data-q="mediajustice fights for racial, economic and gender justice in a digital age. organizing on surveillance, broadband access and tech harms. "><h3><a href="https://mediajustice.org" target="_blank" rel="noopener">MediaJustice</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Fights for racial, economic and gender justice in a digital age.</p><p class="how"><b>How to plug in:</b> Organizing on surveillance, broadband access and tech harms.</p></article>
<article class="org" data-q="news literacy project nonpartisan education to help people tell credible information from misinformation. free tools like rumorguard for debunk content. "><h3><a href="https://newslit.org" target="_blank" rel="noopener">News Literacy Project</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Nonpartisan education to help people tell credible information from misinformation.</p><p class="how"><b>How to plug in:</b> Free tools like RumorGuard for debunk content.</p></article>
<article class="org" data-q="center for countering digital hate researches online hate and disinformation and pushes platforms to act. research on what spreads and why. "><h3><a href="https://counterhate.com" target="_blank" rel="noopener">Center for Countering Digital Hate</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">Researches online hate and disinformation and pushes platforms to act.</p><p class="how"><b>How to plug in:</b> Research on what spreads and why.</p></article>
<article class="org" data-q="irreplaceable a new advocacy org pushing for ai regulation and giving everyday people a say in how ai is used. sign the “freeze ai now” petition and follow its student organizing. "><h3><a href="http://irreplaceable.org" target="_blank" rel="noopener">Irreplaceable</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A new advocacy org pushing for AI regulation and giving everyday people a say in how AI is used.</p><p class="how"><b>How to plug in:</b> Sign the “Freeze AI Now” petition and follow its student organizing.</p></article>
<article class="org" data-q="guardrails alliance a political campaign group opposing ai industry money in elections and backing ai safeguards. sourced research on who funds ai politics. "><h3><a href="https://guardrailsalliance.org" target="_blank" rel="noopener">Guardrails Alliance</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A political campaign group opposing AI industry money in elections and backing AI safeguards.</p><p class="how"><b>How to plug in:</b> Sourced research on who funds AI politics.</p></article>
<article class="org" data-q="the ai pact a five-plank candidate pledge on ai from the political integrity project. check whether your candidates have signed. "><h3><a href="https://theaipact.com" target="_blank" rel="noopener">The AI Pact</a><span class="arrow" aria-hidden="true">↗</span></h3><p class="what">A five-plank candidate pledge on AI from the Political Integrity Project.</p><p class="how"><b>How to plug in:</b> Check whether your candidates have signed.</p></article>
</div><p class="empty">No matches in this section.</p></section>
<div class="sources"><b>Sources.</b> Descriptions come from each org's public website, linked above, and from:<ul><li><a href="https://www.usermag.co/p/inside-the-democrats-struggle-to-win-over-content-creators-dnc-influencer-strategy-chorus" target="_blank" rel="noopener">Inside the Democrats&#x27; struggle to win over content creators</a> (User Mag)</li>
<li><a href="https://campaignsandelections.com/industry-news/how-campaigns-are-adapting-to-the-creator-economy/" target="_blank" rel="noopener">How campaigns are adapting to the creator economy</a> (Campaigns &amp; Elections)</li>
<li><a href="https://highergroundlabs.com/meet-social-currant/" target="_blank" rel="noopener">Meet Social Currant</a> (Higher Ground Labs)</li>
<li><a href="https://people1st.substack.com/p/building-the-infrastructure-behind" target="_blank" rel="noopener">Building the infrastructure behind the political creator economy</a> (People First)</li>
<li><a href="https://civictech.guide/listing/vocal-media" target="_blank" rel="noopener">Vocal Media listing</a> (Civic Tech Field Guide)</li>
<li><a href="https://www.adweek.com/media/nowthis-nowmedia-accelerate-change/" target="_blank" rel="noopener">NowThis combines with Accelerate Change portfolio to become NowMedia</a> (Adweek)</li>
<li><a href="https://www.upworthy.com/southern-content-creators-unite-to-create-bottom-up-voter-education-to-combat-voter-apathy/" target="_blank" rel="noopener">Southern content creators unite to create &#x27;bottom up&#x27; voter education</a> (Upworthy)</li>
<li><a href="https://nnpa.org/onyx-impact-unveils-cutting-edge-platform-to-combat-digital-deception" target="_blank" rel="noopener">Onyx Impact unveils platform to combat digital deception</a> (NNPA)</li>
</ul></div>
</div></main>
<footer class="foot"><div class="wrap"><p>Know an org that should be here? Tell us in the Creator Congress Discord.</p><a class="btn" href="/guide">Read the creator guide</a></div></footer>
<script>
(function(){var q=document.getElementById('q');if(!q)return;q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();document.querySelectorAll('main section').forEach(function(sec){var n=0;sec.querySelectorAll('.org').forEach(function(c){var hit=!v||c.dataset.q.indexOf(v)>-1;c.hidden=!hit;if(hit)n++;});sec.querySelector('.empty').style.display=n?'none':'block';sec.hidden=!!v&&n===0;});});})();
</script></body></html>`;
