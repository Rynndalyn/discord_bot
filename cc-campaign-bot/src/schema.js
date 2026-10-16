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
    channelId: 'fldRuMzDfu1fO6spl',
    requiresApproval: 'fldjsGGtNy9QDCiAI',
  },
  names: {
    status: 'Active / Inactive',
    longTerm: 'Long-term (Discord channel)',
    channelId: 'Discord Channel ID',
    requiresApproval: 'Requires approval',
    postToDiscord: 'Post to Discord',
    discordMessageId: 'Discord Message ID',
    discordClosed: 'Discord Closed',
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
  },
  names: {
    email: 'Email',
    approved: 'Approved',
    discordUserId: 'Discord User ID',
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
  },
  names: {
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
  },
  names: {
    status: 'Status',
    discordUserId: 'Discord User ID',
    discordMessageId: 'Discord Message ID',
    creator: 'Creator',
    requestedAt: 'Requested At',
    reminderSent: 'Reminder Sent',
    flagged: 'Flagged to Staff',
  },
};
