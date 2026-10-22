// Airtable IDs for the Creator Congress Base.
// Field IDs are used for reading/writing so renaming a field in Airtable won't break the bot.
// Field NAMES are only used inside filterByFormula, which needs names.

export const BASE_ID = process.env.AIRTABLE_BASE_ID || 'apprhrQB4w4vhe06h';

export const CAMPAIGNS = {
  table: 'tblibDZjNZOzLb6ht', // Proposals
  f: {
    shortName: 'fldD5KJe7wJsvmtKl',
    details: 'fldXX1A6SNNgSJKNw',
    proposalType: 'fld5tfRfw4v99elST',
    issues: 'fld9Qg5Kjjd50GySA',
    creatorPay: 'fldy4IfhgNfHM9irl',
    creatorsNeeded: 'fldWgJdaOxssJ7cn7',
    startDate: 'fldqbn1cgA02oSvZ1',
    endDate: 'fldi1ynsjV5aTJPZD',
    status: 'fldCBeJvXbj7jq6XI', // "🟢 Active" / "🟡 Inactive"
    postToDiscord: 'fldTaMVfK5XWwS56Q',
    discordMessageId: 'fldhnttrw4Qlxy5Nl',
    discordClosed: 'fldMECgdek4YwfOgr',
    signups: 'fldywNk9SbHcVALa7',
    orgName: 'fldZXf8wiFZ8tMrxV',
    orgLinks: 'fldKj2zkQwqTzh6Y8',
    longTerm: 'fldL7qqJUFjgp5gAH',
    oldChannelId: 'fldRuMzDfu1fO6spl', // legacy per-campaign channel (moved to a thread, then cleared)
    threadId: 'fldaUMdWrrIE1dVf7', // private thread inside the org's channel
    requiresApproval: 'fldjsGGtNy9QDCiAI',
    joinMode: 'fldj4Agzff6U2T7t6', // Open / Partner-reviewed / Invite-only
    invited: 'fldR5TjuJfJ15J6a6',
    suggested: 'fldeITRzkBDdvvNzP',
    suggestionNotes: 'fldqiVNe9jMkbOzbF',
    refreshSuggestions: 'fldYp866Key1HOwmD',
    locationPref: 'fldcxAJkmCGWR7tix',
    reachNeeded: 'fldwUCSYpCmChInvI',
    inviteOnlyBox: 'fldqRnkOpltFTHkds', // older form checkbox, folded into joinMode
    // Who confirmed creators contact about the work and payment (the org lead handles both).
    leadName: 'fldfAyGax4m8kqMak', // Lead Contact Name (optional override)
    leadEmail: 'fld9dMBLtjAsGOPpe', // Lead Contact Email (optional override)
    orgFirst: 'fld2VWswI6JsArDBY', // lookup: org application First Name
    orgLast: 'fldQ8xQmZzVTpZPIt', // lookup: org application Last Name
    orgEmail: 'fldEJo13p4tt7uCjd', // lookup: org application Email
    paymentDetails: 'fldVlbz2T64q54LJj', // Payment Details (rich text / markdown)
    commitments: 'fldANy5riz4mePn4U', // inverse link to Campaign Commitments
    repost: 'fldDdIVjWyXcAydrR', // Repost to Discord (checkbox, unchecks itself)
    postsRequired: 'fld8ipVrIIOQRV43P', // number of posts each creator must submit
    postsDueBy: 'fldQ6Svg1PiyAhWMX',
    reviewPosts: 'fldhh72AAzqK7jQ1v', // org approves each post before it counts
    posts: 'fldivsCtv729Vq0Pe', // inverse link to Campaign Posts
    suggestOptIn: 'fldnXDAAdPvQStN7K', // Suggest Creators: shortlist + invites on any campaign, not just invite-only
    brief: 'fldJtcfaXCM1M6tzQ', // Project Brief (attachments)
    briefSummary: 'fldMXUtKfEoNVKHTl', // Summary (Project Brief), AI
    resources: 'fldLJudRQENjcy9ms', // inverse link from Creator Resources
  },
  names: {
    status: 'Active / Inactive',
    longTerm: 'Long-term (Discord channel)',
    orgLinks: 'Organization Applications',
    repost: 'Repost to Discord',
    oldChannelId: 'Old Discord Channel ID',
    threadId: 'Discord Thread ID',
    requiresApproval: 'Requires approval',
    joinMode: 'How creators join',
    invited: 'Invited Creators',
    suggestionNotes: 'Suggestion Notes',
    refreshSuggestions: 'Refresh Suggestions',
    inviteOnlyBox: 'Invite Only Campaign',
    postToDiscord: 'Post to Discord',
    discordMessageId: 'Discord Message ID',
    discordClosed: 'Discord Closed',
    suggestOptIn: 'Suggest Creators',
  },
  ACTIVE: '🟢 Active',
};

export const MEMBERS = {
  table: 'tblSl99uLUx209Hs5', // Creator Applications
  f: {
    fullName: 'fldzT1rUXqKXBMqfZ',
    firstName: 'fldGXxwqwyUAVPe7X',
    email: 'fldVxhZKNzYlyqufo',
    approved: 'fldS1VZIVZCNAmutG',
    discordUserId: 'fldnnxAWLOEztp63Z',
    reach: 'fldngxmcWdcPcUDzt',
    tiktok: 'fldcQQ8c8pBKSABvZ',
    instagram: 'fldPp7LnHyT07otD3',
    youtube: 'fldz9lG5J35dYGX33',
    issues: 'fldAQ4Rxwwny9IDf2',
    about: 'fldp9yA5ayeaonZyT',
    state: 'fld75P7zQGJrsBrBp',
    signedCoc: 'fldeLthdDawnr5frP',
    portalToken: 'fldH8LniupnWfBDo3',
    pageLink: 'fldDgmYdtawTgb0ek',
    campaignEmails: 'flda1GHTQZ47rMwd5', // Auto / Always email / Never email
    commitments: 'fldmyM8OqSkkP8Mfk', // inverse link to Campaign Commitments
  },
  names: {
    email: 'Email',
    approved: 'Approved',
    discordUserId: 'Discord User ID',
    portalToken: 'Portal Token',
  },
};

export const ORGS = {
  table: 'tblpikwO1pFDhJEhu', // Organization Applications
  f: {
    organization: 'fldi31QP3PtSTtmC7',
    firstName: 'fldpSw1WyaNye5j2N',
    email: 'fldtiFtu2lxwEsKH1',
    approved: 'fldM7s2R2XJV8FKdq',
    proposals: 'fldu8NrBaV7t5hrva',
    discordUserId: 'fldm5KUnv3SWbucA0', // comma-separated: several staff can link to one org
    lastName: 'fldj1PIcBZtbvccQh',
    pageToken: 'fldujPwBcBiHvySCs', // Org Page Token (secret in the partner page link)
    pageLink: 'fldTRnBsQsMYak3qO', // Partner Page Link
    channelId: 'fldHPWHSthUi3m7ro', // the org's private Discord channel (lobby)
  },
  names: {
    pageToken: 'Org Page Token',
    email: 'Email',
    approved: 'Approved',
    discordUserId: 'Discord User ID',
  },
};

export const COMMITMENTS = {
  table: 'tblpZNubuZE1AECjg', // Campaign Commitments
  f: {
    title: 'fldTnV058IGZlHWvc',
    creator: 'fldVKlVSo5lEwmdrL',
    campaign: 'fldPm6xb4BW4yWHlg',
    status: 'fldU6eg20fyeFnJLQ', // "Committed" / "Withdrawn"
    committedAt: 'fldl7raaG3Td3sO5l',
    withdrawnAt: 'fldGFsXnijGchOBGV',
    discordUserId: 'fld3gxawFVQJFmpJ7',
    discordUsername: 'fld81fgw2sqsemyA7',
    discordMessageId: 'fldRwAj6YQHxarEyQ',
    campaignName: 'fldFfllRzd7UOhJBN',
    campaignStatus: 'fldBs8xCWvOkdAXvR',
    campaignEndDate: 'fldNR5Tjy2UenSfVC',
    campaignPay: 'fldCSmEFidV7wAFqO',
    creatorName: 'fldHc9ANL1EcmRPQU',
    orgName: 'fldcslUOMDygGUqYN',
    requestedAt: 'fldiH8GJ5RCPuurBP',
    reviewedBy: 'fldeBf9P0mP5j3y1x',
    reviewedAt: 'fldgmZEpDUpjNDHy0',
    reminderSent: 'fldQ1oQ6eGZjXSYYV',
    flagged: 'fldjf1OpU6fpOWpRg',
    joinedVia: 'fldYN33zkqmzpSiie', // Discord / Web page / Invitation / Portal
    requestedAction: 'fldcvzqb1KkrUaKCx', // set from the portal: Leave / Accept invitation / Decline invitation
    actionResult: 'fldjLKcxOd3SKxpZH',
    leadContact: 'fld6Ij3WqYmvIwFpp', // lookup: campaign's Creator Contact ("Name · email")
    paymentDetails: 'fldS54oAhRrtd4beV', // lookup: campaign's Payment Details
    creatorEmail: 'fld6GJOZts104gOQ0', // lookup
    // Payments: the org marks paid, the creator confirms. "Paid" only once the creator confirms (or 14 days of silence).
    paymentStatus: 'fldxD2uSw55HtMEKo', // Not due yet / Payment due / Org says paid / Paid / Issue
    amountPaid: 'fldGvQQw4udJqO9Pl',
    orgPaidAt: 'fldWKHm7MX4nyyrzK',
    orgPaidBy: 'fldV9Mm5U75Ldpwrt',
    paymentNote: 'fldeucGv0GD85kURU',
    creatorAskedAt: 'fldzpxXQzMvD8Mvkz',
    paidConfirmedAt: 'fldM4lxivN7lMeqcx',
    paidConfirmedBy: 'fldm5FJYmv40YWOct', // Creator / Auto (14 days) / Staff
    paymentReminders: 'fldiZyTYZceF3Fm9X',
    paymentFlagged: 'fldmMndetPEcaWf2U',
    paymentDueDate: 'fldFrtYERMKtPySiN', // formula: posts complete (or End Date) + 30 days
    postsAccepted: 'fldEWxw09yosMLcfz',
    postsCompletedAt: 'fldXUR1ri505UOQo5',
    postReminders: 'fld74HmjRvJfrQM9b',
    postsRequired: 'fldE5QvBiLSgtOIVt', // lookup
    postsDueBy: 'fldIE6Idgh37O6Sjo', // lookup
    posts: 'fldwzqFm8V165fU3L', // inverse link to Campaign Posts
  },
  names: {
    status: 'Status',
    discordUserId: 'Discord User ID',
    discordMessageId: 'Discord Message ID',
    creator: 'Creator',
    requestedAt: 'Requested At',
    reminderSent: 'Reminder Sent',
    flagged: 'Flagged to Staff',
    joinedVia: 'Joined Via',
    requestedAction: 'Requested Action',
    paymentStatus: 'Payment Status',
  },
};

export const OUTBOX = {
  table: 'tblvDJvK9vejsJupy', // Email Outbox (an Airtable automation sends each new row)
  f: {
    subject: 'fldfFbYd8ODZFdWkV',
    to: 'fldfymY5VvzC2tmL5',
    body: 'fldtnrOBtgnO25ssS',
    kind: 'fld0rOoTfTTAjq0Ay',
    creator: 'fldf4z21TBmIfjnMW',
    sent: 'fldV4FzMdVEnnXl2O',
  },
  names: { kind: 'Kind' },
};

export const PORTAL = {
  table: 'tbld1DRLGc5LTG5Ga', // Portal Requests (one row per portal button click)
  f: {
    summary: 'fldOewg3w3zErGxNM',
    email: 'flddFQclp3P6rZTmd',
    campaign: 'fld5vqFL9saw0VyYg',
    action: 'fldkbniJaDrdqLtEU',
    status: 'flduHdv3Aa4OewUl0',
    result: 'fldUYMMlbjtgPJ8ZG',
    processedAt: 'fld8G9eDMZlTy42Pi',
    creator: 'fldhu6t4gvKMHjNso',
  },
  names: { status: 'Status', action: 'Action' },
};

export const POSTS = {
  table: 'tblDcJb2oL5rIVzfj', // Campaign Posts (one row per submitted post)
  f: {
    title: 'fldJzSusBrwYoCp7Q',
    link: 'fldTEicEemrWs2DcT',
    platform: 'fldyGkIO6VUxKX86J',
    status: 'fld2tGr1ynw7ihIyS', // Submitted / Approved / Needs changes
    submittedAt: 'fldHQeKty7Fziu7U8',
    via: 'fld6nzisWQgg5TZCz',
    note: 'fldyA8aIYwRyYDlzD',
    reviewedBy: 'fldCNBypi1zNH1uqA',
    reviewedAt: 'fld1PEMDhDkN18VZW',
    screenshot: 'fldTYkcI4xfk7eaRE',
    commitment: 'fldCvu5Hi76abtPir',
    campaign: 'fldt5WMGX6XICqZHG',
    creator: 'fldtVoHKNr2ctrTRU',
    analysis: 'fldHthQGilpi27ISY',
    notified: 'fldD1yZ9l8bAvx7qS',
    insights: 'fldnPPT7MZ2iYfdR3', // AI text: "views=..; likes=..; comments=..; shares=.."
    metricsCopied: 'fldJ5ff40CkfxdE46',
    totalViews: 'flda3lZnsp9HyuhFb', // lookup
  },
  names: { status: 'Status', notified: 'Reviewer Notified', metricsCopied: 'Metrics Copied', insights: 'Insights (AI)' },
};

// Existing Creator Post Analysis table (performance numbers per post)
export const ANALYSIS = {
  table: 'tblaqf3uu3DOUakuA',
  f: {
    name: 'fldRS3fz3KhNlHkC8',
    notes: 'fldxXmwLFWnHkbLdy',
    platforms: 'fldKjhAPLcX1ClJ0i', // IG / TikTok / Threads / Youtube / Substack / X
    organization: 'fld4JM4tIbnVGFt42',
    payment: 'fld7bfnamE4Hr9IPv',
    ig: { link: 'fldjVfOCfP5k01vQk', views: 'fldO6alLwOTTpWb31', likes: 'fldJbLHDkrIjPtDxD', comments: 'fldiGd4LnEDAWHKzI', shares: 'fldftlba1FjcaxaG3' },
    tiktok: { link: 'fldjoFgOZiqfHl0w2', views: 'fldJ8sDaiZgiAXsrB', likes: 'fldLIUJG9EErbkbbA', comments: 'fldHGSnBZO6cYjlDw', shares: 'fldDJFkg7AS1HlWYC' },
    other: { link: 'fldeWQXBvjrEJEqWa', views: 'fld9FqCHiaOJlvRbQ', likes: 'fldIAeeiugd0boz3S', comments: 'fld7QgRGMLdsRPxtw', shares: 'fldqpp5DgW8njLU3C' },
  },
};

// Inbound Email: post links creators email to hello@creatorcongress.net (Gmail filter → Airtable automation adds rows)
export const INBOUND = {
  table: 'tblplaSw32ZFbfQ1i',
  f: {
    subject: 'fldmlyn4A7HVtQgq2',
    from: 'fldE5takf4qJnOv75',
    fromName: 'fldYRQnwXtFrkzEYh',
    body: 'fldu6tp4IoeTEbVxC',
    attachments: 'fldJGEAHZG7249CuU',
    received: 'fldM1Mxwul86f5vks',
    status: 'fld6RQXbvD7DrHcr5', // blank/New → Logged / Needs campaign / No link found / Not a creator / Error
    result: 'fldrh56JPKc7ydzkh',
  },
  names: { status: 'Status' },
};

// Creator Resources: campaign briefs are copied here so they show up with the other resources (e.g. the portal)
export const RESOURCES = {
  table: 'tbllQxUpwmvFE6ZMG',
  f: {
    name: 'fldi3FXfXWzJTJsKl',
    attachments: 'fldYoRrmaSYjlVgQ2',
    source: 'fldYJqTl8ahhBufRF', // multi select (org name)
    topic: 'fldMtKH7hSL143WF5',
    type: 'fldWDprBMhLMg3xPe', // multi select: Brief / Toolkit
    campaign: 'fldkCGM7LxT9bjUB6', // link to Proposals (set by the bot)
  },
};

// Org Team: everyone at a partner org (staff add/remove rows). Used for portal sign-in, /link, Discord access and emails.
export const TEAM = {
  table: 'tblECgITTj4vFZcc7',
  f: {
    name: 'fld3mMvv7V46poe4u',
    email: 'fldTxloclz7xBOY5D',
    org: 'fldIR3Gj4pLLjHluj',
    role: 'fldbNUp3RGfXF7bqj',
    getsEmails: 'fldbLYeip1gJF97uq',
    discordUserId: 'fldcMS2qy9jhdUJ2A',
  },
  names: { email: 'Email' },
};
