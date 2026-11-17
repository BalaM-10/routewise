# Infrastructure

| Path | Purpose |
| --- | --- |
| `firebase/firebase.json` | Firebase Hosting (single-page app, cache headers) |
| `firebase/.firebaserc` | Default Firebase project |
| `scripts/deploy.sh` | Type-check, test, build, stage and deploy |
| `../.github/workflows/ci.yml` | Continuous integration on every push and pull request |

## Deploy

```
npx firebase-tools login
npm run deploy   # type-check, test, build and deploy hosting
```

The build output is copied into `infra/firebase/public` at deploy time and is git-ignored. Routes are published in the Firebase console, so deploying never touches them.
