# Jira Oversight · Dashboard

The web dashboard for Jira Oversight. People sign in with Atlassian and see, board by board, where work breaks the agreed process: findings, people, plain-English questions (Ask) and rule settings. It reads everything through the Jira Oversight service and never writes to Jira.

**Service:** [jira-oversight-sys](https://github.com/MinhazulHasan/jira-oversight-sys)

## Set up on a new machine

Requirements: Node.js 22 (20.9 or later). For live data, the service running and reachable from this machine.

1. Clone this repository beside the service and install the dependencies.

```powershell
git clone https://github.com/MinhazulHasan/jira-oversight-ui.git
cd jira-oversight-ui
npm ci
```

2. Create `.env.local` from the template and choose the data source.

```powershell
Copy-Item .env.example .env.local
```

- Sample data, no service needed: `OVERSIGHT_DATA=sample`
- Live data: `OVERSIGHT_DATA=live`, `OVERSIGHT_API_URL=http://localhost:3300` and `OVERSIGHT_SERVICE_KEY` (the service's `API_SERVICE_KEY`). Sign-in also needs `APP_URL`, `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `AUTH_SECRET`, `ALLOWED_EMAIL_DOMAINS` and `OVERSIGHT_JIRA_BASE_URL`.

3. Start it and open http://localhost:3400.

```powershell
npm run dev
```

## More

- Production on IIS: [DEPLOYMENT_IIS.md](https://github.com/MinhazulHasan/jira-oversight-sys/blob/main/docs/DEPLOYMENT_IIS.md) in the service repository
- Atlassian sign-in app (callback `<APP_URL>/api/auth/callback`): [ATLASSIAN_APP_SETUP.md](https://github.com/MinhazulHasan/jira-oversight-sys/blob/main/docs/ATLASSIAN_APP_SETUP.md)
- Architecture, sign-in and every setting: [docs/REFERENCE.md](docs/REFERENCE.md)
- Tests: `npm test` (unit) and `npm run e2e` (browser)
