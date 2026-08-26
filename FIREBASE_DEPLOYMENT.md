# Firebase Production Deployment Guide

This guide walks through deploying the Global Football Hope Fund production infrastructure including authentication, Firestore security rules, and Cloud Functions.

## Prerequisites

- **Firebase CLI**: [Install globally](https://firebase.google.com/docs/cli#install_the_firebase_cli)
- **Node.js 20+**: [Download from nodejs.org](https://nodejs.org/)
- **Firebase Project**: Created at https://console.firebase.google.com
- **API-Football API Key**: From https://www.api-football.com/documentation (v3)

## Step 1: Authenticate Firebase CLI

```bash
firebase login
```

This opens a browser to authorize the CLI. Follow the prompts to connect your Google account.

Verify authentication:
```bash
firebase projects:list
```

Select your project as default:
```bash
firebase use global-football-hope-fund
```

## Step 2: Install Dependencies

From the project root:

```bash
cd functions
npm install
cd ..
```

This installs:
- `firebase-admin ^12.1.0`
- `firebase-functions ^5.0.1`
- Node 20 runtime

## Step 3: Configure API-Football Secret

The API-Football key is stored securely as a Firebase Secret (not in code).

**Step 3a**: Set the secret locally

```bash
firebase functions:secrets:set API_FOOTBALL_KEY
```

You'll be prompted:
```
Enter a value for API_FOOTBALL_KEY:
```

Paste your API-Football v3 API key (starts with your key).

**Step 3b**: Verify secret was set

```bash
firebase functions:secrets:list
```

Should output:
```
API_FOOTBALL_KEY [Available]
```

## Step 4: Deploy Firestore Security Rules

Firestore rules protect all data from unauthorized access.

```bash
firebase deploy --only firestore:rules
```

Expected output:
```
i  deploying firestore
i  firestore: checking firestore.rules for compilation errors...
✔  firestore: rules compiled successfully
i  firestore: uploading rules...
✔  firestore: released new rules to cloud.firestore
```

**What rules protect:**
- ✅ User profiles: Prevents tampering with reward points and wallet balances
- ✅ Predictions: Blocks direct client writes (only backend/functions can write)
- ✅ Daily limits: Read-only for clients
- ✅ Transactions: Users can only read their own transactions
- ✅ Wallet balance: Immutable, only backend can update
- ✅ Chat/messages: Prevents message tampering after creation

## Step 5: Deploy Cloud Functions

Functions handle secure server-side operations:
- Ticket submission validation
- Automated bet settlement
- 24-hour lost ticket cleanup
- User profile initialization
- Hope Points to wallet conversion

```bash
firebase deploy --only functions
```

This will:
1. Build all functions
2. Verify the API_FOOTBALL_KEY secret is available
3. Deploy to Firebase Cloud Functions

Expected output:
```
✔  functions[submitPredictionTicket(us-central1)]: Successful create operation.
✔  functions[settlePredictionTickets(us-central1)]: Successful create operation.
✔  functions[cleanupExpiredLostTickets(us-central1)]: Successful create operation.
✔  functions[cleanupLegacyPredictions(us-central1)]: Successful create operation.
✔  functions[initializeProfile(us-central1)]: Successful create operation.
✔  functions[convertHopePointsToWallet(us-central1)]: Successful create operation.
✔  functions[getUserTransactions(us-central1)]: Successful create operation.

✔  Deploy complete!
```

**Function descriptions:**

| Function | Type | Trigger | Purpose |
|----------|------|---------|---------|
| `submitPredictionTicket` | Callable | Client-side (POST) | Validate and submit prediction ticket (7 picks, 2-ticket limit) |
| `settlePredictionTickets` | Scheduled | Every 5 minutes | Fetch finished fixtures, calculate outcomes, award 50 HP for 7/7 correct |
| `cleanupExpiredLostTickets` | Scheduled | Every 60 minutes | Delete lost tickets 24 hours after settlement |
| `cleanupLegacyPredictions` | Scheduled | Every 60 minutes | Remove predictions with schemaVersion < 3 |
| `initializeProfile` | Callable | First sign-in | Create user profile with default values |
| `convertHopePointsToWallet` | Callable | User request | Convert 1 HP = $0.01 USD, log transaction |
| `getUserTransactions` | Callable | User request | Retrieve user's transaction history (last 50) |

## Step 6: Enable Authentication Providers

### Enable Email/Password

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Navigate to **Authentication** > **Sign-in method**
4. Enable **Email/Password**
5. Click **Save**

### Enable Google Sign-In

1. In **Sign-in method**, enable **Google**
2. Configure OAuth consent screen:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to **APIs & Services** > **OAuth consent screen**
   - Select **External** (or **Internal** for Google Workspace)
   - Fill in app name: "Global Football Hope Fund"
   - Add authorized domains: `global-football-hope-fund.web.app`, `localhost`
   - Add scopes: `email`, `profile`, `openid`
   - Save

3. Back in Firebase, refresh and verify **Google** shows as enabled

## Step 7: Configure Mobile Apps

### Android (google-services.json)

1. In Firebase Console, go to **Project Settings** > **Your apps**
2. Select your Android app (package: `com.globalfootball.app`)
3. Click **Download google-services.json**
4. Place file at: `mobile/android/app/google-services.json`
5. Verify in `mobile/android/app/build.gradle`:
   ```gradle
   plugins {
       id 'com.android.application'
       id 'com.google.gms.google-services'  // ← Should be present
   }
   ```

### iOS (GoogleService-Info.plist)

1. In Firebase Console, go to **Project Settings** > **Your apps**
2. Select your iOS app (bundle: `com.globalfootball.app`)
3. Click **Download GoogleService-Info.plist**
4. Drag into Xcode:
   - Open `mobile/ios/Runner.xcworkspace` in Xcode
   - Right-click **Runner** > **Add Files to Runner**
   - Select `GoogleService-Info.plist`
   - Ensure "Copy items if needed" is checked
   - Click **Add**

## Step 8: Verify Deployments

### Check Function Logs

```bash
firebase functions:log
```

Expected: No errors, functions running successfully.

### Test Callable Functions (Web)

Open browser console on your web app:

```javascript
import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions();
const initProfile = httpsCallable(functions, 'initializeProfile');

// Test profile initialization
initProfile({ displayName: 'Test User' })
  .then(result => console.log('Profile initialized:', result.data))
  .catch(err => console.error('Error:', err));

// Test HP conversion
const convertHP = httpsCallable(functions, 'convertHopePointsToWallet');
convertHP({ hpAmount: 100, currency: 'USD' })
  .then(result => console.log('Conversion result:', result.data))
  .catch(err => console.error('Error:', err));
```

### Test Scheduled Functions

Scheduled functions run automatically:
- Settlement: Every 5 minutes (check if new predictions → settled)
- Cleanup expired: Every 60 minutes (check if old lost tickets deleted)

Monitor in Firebase Console > **Functions** > **View in Logs**

### Test Authentication

#### Web
1. Open http://localhost:8000/pages/login.html
2. Test **Email/Password Sign-up** → verify user created in Firebase Console
3. Test **Google Sign-In** → verify authentication works
4. Check Firestore: New user document should exist in `users/{uid}`

#### Mobile
1. Build and run: `flutter run`
2. Tap **Profile** tab
3. Test **Email/Password Sign-up** → should see "Account created!"
4. Test **Google Sign-In** → should trigger Google authentication
5. Verify user appears in Firebase Console > **Authentication**

## Step 9: Production Security Checklist

- ✅ Firestore rules deployed and verified (prevent client writes to sensitive data)
- ✅ Cloud Functions deployed (backend-authoritative for settlements)
- ✅ API_FOOTBALL_KEY stored as Secret (not in code/config files)
- ✅ Email/Password authentication enabled
- ✅ Google Sign-In configured with proper OAuth consent
- ✅ Mobile apps configured with platform-specific credentials
- ✅ User creation blocked from writing reward/wallet data
- ✅ Prediction writes only allowed via `submitPredictionTicket` function
- ✅ Settlement and cleanup jobs running on schedule
- ✅ Transaction logging active (all HP conversions logged)

## Step 10: Ongoing Monitoring

### Daily Checks

```bash
# View recent function logs
firebase functions:log --limit 100

# Check for errors
firebase functions:log | grep -i error
```

### Dashboard Monitoring

In Firebase Console:
1. **Functions** tab:
   - Check execution count and error rate
   - Verify scheduled jobs are running
   - Monitor cold start latency

2. **Firestore** tab:
   - Monitor predictions collection growth
   - Check for blocked writes (security rule violations)
   - View transaction history

3. **Authentication** tab:
   - Monitor daily active users
   - Track sign-in methods (Email vs. Google)
   - Check for suspicious activity

### Troubleshooting

**Functions failing to deploy?**
```bash
firebase deploy --only functions --debug
```

**Secret not found in function?**
```bash
firebase functions:secrets:list
firebase functions:secrets:destroy API_FOOTBALL_KEY
firebase functions:secrets:set API_FOOTBALL_KEY
```

**Firestore rules not enforcing?**
```bash
firebase deploy --only firestore:rules --force
```

**User profile not initializing?**
Check function logs:
```bash
firebase functions:log --function initializeProfile
```

## Additional Resources

- [Firebase Functions Documentation](https://firebase.google.com/docs/functions)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/start)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [Firebase CLI Reference](https://firebase.google.com/docs/cli)

## Support

For questions or issues:
1. Check Firebase Console error logs
2. Review function execution details
3. Verify Firestore rules syntax
4. Test with `firebase emulators:start` locally first
