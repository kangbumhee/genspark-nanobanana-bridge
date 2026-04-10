# Genspark Nano Banana Bridge

This project now uses a bridge server instead of copying browser cookies into the extension.

## How it works

- The Chrome extension sends image generation requests to a bridge server.
- The bridge server runs Playwright with a persistent Chrome profile.
- Only the bridge server holds the logged-in Genspark session.
- Other users never receive your cookies or Google account tokens.

## Local setup

1. Install dependencies

```bash
npm install
```

2. Create `.env` from `.env.example`

3. Open a persistent login session once

```bash
npm run bridge:login
```

4. Log in to Genspark in the opened browser window, then close the window.

5. Start the bridge server

```bash
npm start
```

6. In the extension settings, set:

- Bridge server URL: `http://127.0.0.1:8787`
- Bridge API key: your `BRIDGE_API_KEY`

## GitHub

This folder is ready to be initialized as a git repository and pushed to GitHub.
