# Production Firebase Infrastructure - Security & Developer Reference

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Client Layer (Web / Mobile)                                     │
│ ├─ Firebase SDK (Auth, Firestore, Functions)                   │
│ ├─ Session Persistence (IndexedDB)                             │
│ └─ Error Handling & Retry Logic                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓ HTTPS / REST
┌─────────────────────────────────────────────────────────────────┐
│ Firebase Authentication Layer                                   │
│ ├─ Email/Password + Google OAuth                               │
│ ├─ Session tokens (auto-managed)                               │
│ └─ User profile initialization                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓ Firestore & Functions
┌─────────────────────────────────────────────────────────────────┐
│ Backend Authorization Layer (Firestore Security Rules)          │
│ ├─ Prediction writes: BLOCKED (functions-only)                 │
│ ├─ Wallet/reward writes: BLOCKED (functions-only)              │
│ ├─ User profile: Limited (no reward/wallet fields)             │
│ └─ Read access: Owner-based + admin                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓ Callable Functions
┌─────────────────────────────────────────────────────────────────┐
│ Secure Backend Logic (Cloud Functions)                          │
│ ├─ submitPredictionTicket(): Validate tickets, check 2-limit   │
│ ├─ settlePredictionTickets(): Calculate outcomes, award HP      │
│ ├─ cleanupExpiredLostTickets(): Delete 24hr old lost tickets   │
│ ├─ cleanupLegacyPredictions(): Remove schemaVersion < 3        │
│ ├─ initializeProfile(): Create user document                    │
│ ├─ convertHopePointsToWallet(): 1 HP = $0.01 USD              │
│ └─ getUserTransactions(): Retrieve transaction history         │
└─────────────────────────────────────────────────────────────────┘
                              ↓ External APIs
┌─────────────────────────────────────────────────────────────────┐
│ External Services                                               │
│ ├─ API-Football v3 (fixtures, live scores, outcomes)          │
│ └─ Secret Manager (API key encryption)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Data Protection Layers

### Layer 1: Firestore Security Rules
- **Predictions collection**: Read-only for clients (`allow create, update, delete: if false`)
- **Wallet balance**: Immutable for all, writable only by admin functions
- **User profile**: Clients cannot modify reward/wallet fields
- **Transaction history**: Users see only their own transactions
- **Messages**: Cannot be edited/deleted after creation (author/admin only)

### Layer 2: Backend Function Validation
Each callable function validates:
1. **Authentication**: `request.auth` exists
2. **Input validation**: Type checking, bounds checking
3. **Business logic**: 2-ticket limit, 7-pick requirement
4. **Atomic operations**: Firestore transactions prevent race conditions
5. **Audit logging**: All sensitive operations logged to `transactions` collection

### Layer 3: API Key Security
- API-Football key stored in Firebase Secrets (encrypted at rest)
- Never exposed in client code or configuration files
- Functions fetch secret at runtime: `API_FOOTBALL_KEY.value()`
- Rotation possible without code changes via: `firebase functions:secrets:set API_FOOTBALL_KEY`

## Security Checklist

### ✅ Client-Side (Web & Mobile)

- [x] Firebase SDK properly initialized
- [x] Session persistence enabled (IndexedDB for web, device storage for mobile)
- [x] Authentication state monitored with real-time listeners
- [x] Callable functions used instead of direct Firestore writes
- [x] Error handling displays user-friendly messages
- [x] No sensitive data logged to console
- [x] Credentials never stored in SharedPreferences (Android) or Keychain (iOS) without encryption

### ✅ Authentication

- [x] Email/Password provider enabled with strong password requirements (6+ chars)
- [x] Google OAuth configured with proper consent screen
- [x] User profiles auto-created on first sign-in (backend-driven)
- [x] Anonymous sign-in blocked for real predictions (only guest browsing)
- [x] Session timeout handled gracefully (re-authenticate on function call)

### ✅ Database (Firestore)

- [x] Admin role check uses `adminRole == true` (strict boolean check, not role string)
- [x] Prediction writes blocked from clients (rule: `allow create, update, delete: if false`)
- [x] Daily limits document read-only for clients
- [x] User profile creation prevents client from setting reward/wallet fields
- [x] Wallet balance document immutable (only functions can update)
- [x] Transactions collection log all conversions and sensitive operations
- [x] Indexes created for common queries (predictions by date, transactions by user)

### ✅ Backend Functions

- [x] All writes go through `db.runTransaction()` for atomicity
- [x] API-Football key accessed via Secret Manager
- [x] Error responses include helpful messages (without leaking internal details)
- [x] Scheduled jobs run on fixed intervals (5 min settlement, 60 min cleanup)
- [x] Pagination implemented for large collection queries (400-doc batches)
- [x] Duplicate detection via `settledAt` timestamp (prevents re-settlement)

### ✅ Monitoring & Compliance

- [x] All function executions logged to Cloud Logging
- [x] Transaction history maintained for audit trail
- [x] Error rate monitored in Firebase Console
- [x] User data encryption at rest (Firebase managed)
- [x] HTTPS enforced for all API calls
- [x] No plaintext credentials in repository

## Common Scenarios & Responses

### Scenario 1: User attempts to modify their reward points directly

```
User writes: users/{uid} { rewardPoints: 1000 }
Firestore rule check: canModifyUserProfile()
├─ isOwn(uid)? ✓ Yes
├─ No affected keys in [rewardPoints, walletBalance, ...]? ✗ No (rewardPoints in keys)
Result: BLOCKED ✗
Error: "Permission denied" to client
```

### Scenario 2: User submits 7-pick prediction ticket

```
Client calls: submitPredictionTicket({ picks: [...7 picks...] })
Function validates:
├─ Auth exists? ✓
├─ Exactly 7 picks? ✓
├─ All picks are home/draw/away? ✓
├─ All fixture IDs valid & scheduled (API-Football)? ✓
├─ Daily limit (2 tickets today)? ✓ (first ticket for user today)
Backend transaction:
├─ Creates 7 prediction docs (one per fixture)
├─ Increments batchCount in predictionDailyLimits
└─ Returns ticketNumber: 1
Result: Ticket submitted ✓
```

### Scenario 3: Scheduled settlement job runs

```
Every 5 minutes:
1. Query: predictions where ticketStatus == "pending"
2. Group by ticketId (7 predictions per ticket)
3. For each complete ticket:
   ├─ Fetch outcomes from API-Football
   ├─ Transaction: update 7 predictions + increment rewardPoints if 7/7
   ├─ Set lostExpiresAt = now + 24 hours if lost
   └─ Mark ticketStatus = "won" or "lost"
Result: All pending tickets settled ✓
```

### Scenario 4: User requests Hope Points conversion

```
Client calls: convertHopePointsToWallet({ hpAmount: 100 })
Function validates:
├─ Auth exists? ✓
├─ hpAmount is positive integer? ✓
├─ User has ≥100 HP? ✓ (check user.rewardPoints)
Backend transaction:
├─ Decrement user.rewardPoints by 100
├─ Increment user.walletBalance by 1.00 USD
├─ Create transaction doc (audit trail)
└─ Return transactionId
Result: 100 HP → $1.00 USD ✓
```

## Configuration Reference

### Environment Variables (Firebase Secrets)

```
API_FOOTBALL_KEY=<your-api-football-v3-key>
```

Set via:
```bash
firebase functions:secrets:set API_FOOTBALL_KEY
```

### Firestore Indexes (Auto-created)

```
Collection: predictions
  - Index 1: ticketStatus, settledAt
  - Index 2: userId, status, createdAt
  - Index 3: lostExpiresAt (cleanup queries)

Collection: transactions
  - Index 1: userId, createdAt (descending)
```

Auto-created on first query requiring index.

### Function Configurations

```json
{
  "submitPredictionTicket": {
    "memory": "256 MB",
    "timeout": "30 seconds",
    "maxInstances": 100,
    "secrets": ["API_FOOTBALL_KEY"]
  },
  "settlePredictionTickets": {
    "memory": "512 MB",
    "timeout": "540 seconds",
    "schedule": "every 5 minutes",
    "secrets": ["API_FOOTBALL_KEY"]
  },
  "cleanupExpiredLostTickets": {
    "memory": "256 MB",
    "timeout": "60 seconds",
    "schedule": "every 60 minutes"
  }
}
```

## Testing Procedures

### Test Case 1: Email/Password Sign-Up

```
1. Navigate to login page
2. Click "Sign Up" tab
3. Enter email, password (6+ chars), display name
4. Click "Create Account"
Expected: User created in Firebase Auth + profile doc in Firestore
Verify: Firebase Console > Auth > Users table
```

### Test Case 2: Google Sign-In

```
1. Click "Sign In with Google"
2. Select Google account
3. Authorize permissions
Expected: User authenticated + profile initialized
Verify: Browser console shows "Profile initialized"
```

### Test Case 3: Prediction Ticket Submission

```
1. Sign in
2. Navigate to Predictions page
3. Select 7 matches (all scheduled)
4. Click "Submit Ticket"
Expected: "Ticket submitted successfully" message
Verify: Firestore > predictions collection > 7 new docs
```

### Test Case 4: Settlement (after fixture finishes)

```
1. Submit ticket with 7 matches
2. Wait for all matches to finish
3. Check Firestore after 5-minute settlement window
Expected: All prediction docs updated with ticketStatus: "won" or "lost"
Verify: prediction.ticketReward should be 50 if won, 0 if lost
```

### Test Case 5: Hope Points Conversion

```
1. Sign in with ≥100 HP
2. Navigate to Wallet
3. Enter "100" HP amount
4. Click "Convert to Wallet"
Expected: "Conversion successful: 100 HP → $1.00 USD"
Verify: 
  - User doc: rewardPoints decreased by 100
  - User doc: walletBalance increased by 1.00
  - Transactions collection: new entry with type: "hp_conversion"
```

## Quick Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "Permission denied" on profile update | Trying to modify reward/wallet field | Only update name, email, etc. |
| "Ticket must contain exactly 7 picks" | Submitted <7 or >7 picks | Ensure exactly 7 predictions selected |
| "One or more matches no longer available" | Selected finished/postponed matches | Select only scheduled matches |
| "You have already submitted two tickets today" | Reached daily limit | Wait until next calendar day |
| "API key not found" | Secret not set | Run `firebase functions:secrets:set API_FOOTBALL_KEY` |
| Settlement not running | Function timeout or error | Check `firebase functions:log --function settlePredictionTickets` |
| User profile not created | Function error | Check `firebase functions:log --function initializeProfile` |

## Developer Onboarding

### New Team Member Setup

```bash
# 1. Install dependencies
npm install
cd functions && npm install && cd ..

# 2. Authenticate Firebase CLI
firebase login

# 3. Set project
firebase use global-football-hope-fund

# 4. Test locally
firebase emulators:start

# 5. Deploy changes
firebase deploy --only firestore:rules,functions

# 6. View logs
firebase functions:log --limit 50
```

### Local Development (Emulators)

```bash
firebase emulators:start
```

Starts local Firestore, Functions, and Auth emulators.

Access emulator UI at http://localhost:4000

### Code Review Checklist

- [ ] No hardcoded API keys or secrets
- [ ] All Firestore writes use `db.runTransaction()`
- [ ] Function input validation checks type and bounds
- [ ] Error messages user-friendly (no stack traces)
- [ ] Scheduled jobs have pagination for large datasets
- [ ] Tests pass in emulator before deployment
- [ ] No client code bypasses callable functions

## Additional Resources

- [Firebase Security Best Practices](https://firebase.google.com/docs/firestore/security/best-practices)
- [Cloud Functions Security Guide](https://cloud.google.com/functions/docs/securing)
- [API-Football Documentation](https://www.api-football.com/documentation)
- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
