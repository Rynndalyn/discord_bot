// Public how-to guide, served at /guide (and the site root). Edit the text here; no other file needs to change.
// index.js passes in the shared page CSS and the branded header so this page matches the creator and partner pages.

export function guideHtml({ css, brand, discordInvite = '' }) {
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
  <div class="cta">${join}<a class="btn ghost" href="#creators">For creators</a><a class="btn ghost" href="#partners">For partner orgs</a></div>
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
  <li><b>Join</b> by reacting ✅ on the campaign post, or with the <b>Join</b> button on your campaigns page.</li>
  <li><b>Spots</b> on each post counts everyone who's joined, including on the web, so it can be higher than the ✅ count.</li>
  <li><b>Ask questions</b> by replying inside that campaign's post. Keep it on topic and respectful.</li>
</ul>
<div class="grid3">
  <div class="card"><h3>🟢 Open</h3><p>Your ✅ confirms you right away.</p></div>
  <div class="card"><h3>🙋 Partner-reviewed</h3><p>Your ✅ is a request. The org reviews your profile, and you'll get a DM either way.</p></div>
  <div class="card"><h3>✉️ Invite-only</h3><p>Not listed publicly. If an org invites you, you'll get a DM with <b>Accept</b> / <b>No thanks</b>.</p></div>
</div>
<p class="note"><b>Changed your mind?</b> Remove your ✅ to drop out. If you'd already started the work, let the org know in your campaign thread.</p>

<h2 id="c-confirmed">3. After you're confirmed</h2>
<ul>
  <li>You're added to a <b>private thread</b> with the partner org. That's where the brief, questions and coordination happen.</li>
  <li>Your <b>lead contact</b> and the org's <b>payment details</b> (how to invoice or what they need from you) appear in that thread, on your campaigns page and in <code>/mycampaigns</code>.</li>
  <li>Keep contact and payment details from your thread private.</li>
</ul>

<h2 id="c-posts">4. Submit your posts</h2>
<p>If a campaign asks for posts, log each one as soon as it's live.</p>
<ol class="steps">
  <li>In Discord, type <code>/submit</code>, paste your post link, pick the campaign, and attach a screenshot of the post's insights (views, likes, comments, shares) if you can. You can also submit from your campaigns page.</li>
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
  <div class="card"><h3>🟢 Open</h3><p>Anyone who reacts ✅ is confirmed. Best for broad reach.</p></div>
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
.muted{color:var(--muted)}.small{font-size:14px}
.help{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:4px 18px 10px}
@media (max-width:640px){.grid3{grid-template-columns:1fr}.toc{grid-template-columns:1fr}.hero h1{font-size:28px}}
`;
