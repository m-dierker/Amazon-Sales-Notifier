# Amazon Sales Discord Bot

Notifies in a Discord DM when an Amazon order is created, shipped, or cancelled.

![Image of bot message](https://i.imgur.com/XViEHvD.png)

## How to use

This bot is in early stages, but is usable and free.

Prereqs:

- Registered to use [Amazon MWS API](https://developer.amazonservices.com/) (requires Amazon Professional Seller account for $40/mo).
- Authorized your MWS app to to your Seller account (contact me or open a GitHub issue if you need help before I've documented this)
- Signed up as a [Discord developer](https://discord.com/developers/applications), created an app, created a bot, and obtained a token.
- [Authorized your bot](https://discordpy.readthedocs.io/en/latest/discord.html) for sending message scope and added it to a server you are in with it. (The bot can still DM you but will need to be in a server with you.)
- Fetched your own Discord ID ([enable developer mode](https://discordia.me/en/developer-mode#:~:text=Enabling%20Developer%20Mode%20is%20easy,the%20toggle%20to%20enable%20it.), find your picture, right click, Copy ID.)
- Install [Firebase CLI](https://firebase.google.com/docs/cli). Create a new [Firebase project](https://console.firebase.google.com/), convert to Blaze plan and enable billing (required to run Firebase Functions) even though it is extremely unlikely you'll cross free thresholds with this.

Create `functions/.env` and fill in the following variables:

```
# MWS Access Keys
AWS_ACCESS_KEY_ID=something
MWS_ACCOUNT_AUTH_TOKEN=something
MWS_SECRET=something
MWS_SELLER_ID=something

# Discord info
DISCORD_TOKEN=something
DISCORD_OWNER_ID=a number
```

## Running & Deploying

Run locally: `firebase emulators:start` and use the HTTP link listed. When you make changes, use `npm run build`. There is probably a way to automate the build portion but I haven't done it yet.

Deploy to prod: `firebase deploy --only functions`.

Schedule for regular execution:

- Easy potentially non-free method: Find your function's URL in the [Firebase Console](https://console.firebase.google.com/), add to [Cloud Scheduler](https://console.cloud.google.com/cloudscheduler), ping every minute. Cloud Scheduler has a per-acccount limit, so I don't do this. 😏
- Definitely free method: Go to [Google Drive](https://drive.google.com), create an [Apps Script](https://www.google.com/script/start/) in that folder, paste `UrlFetchApp.fetch("https://your url");` in the method created manually, run it once manually to authorize permissions, then use the Triggers in the toolbar to setup to run every minute. Execution is free. :) :)
