# Firebase Production Infrastructure - Testing Guide

## Pre-Deployment Checklist

Complete these steps before deploying to production.

### 1. Local Development & Testing

#### Set up local emulators
```bash
firebase emulators:start --import=seed_data
```

Emulator UI: http://localhost:4000

#### Test Firestore Rules in Emulator

```javascript
// In browser console
const db = getFirestore();
const auth = getAuth();

// Test 1: User cannot create prediction with rewardPoints
await signInWithEmailAndPassword(auth, "test@example.com", "password123");

// Should FAIL (rule blocks)
await setDoc(doc(db, "predictions", "test"), {
  userId: auth.currentUser.uid,
  fixtureId: "123",
  pick: "home"
});

// Should SUCCEED (valid write)
await setDoc(doc(db, "users", auth.currentUser.uid), {
  displayName: "Test User",
  email: auth.currentUser.email
});

// Should FAIL (cannot write reward field)
await updateDoc(doc(db, "users", auth.currentUser.uid), {
  rewardPoints: 1000
});
```

### 2. Authentication Testing

#### Email/Password Sign-Up
```
Test Case: EP_001
Steps:
1. Open login page (web) or Profile screen (mobile)
2. Enter email: test+signupXXXX@example.com (use date/time)
3. Enter password: SecurePass123!
4. Enter display name: Test User
5. Click "Create Account"

Expected Result:
- User created in Firebase Auth
- User document in Firestore with default values
- Redirected to authenticated view
- No errors in console

Verify:
- Firebase Console > Authentication > Users > check new user
- Firebase Console > Firestore > users/{uid} exists
- Browser localStorage has auth token
```

#### Email/Password Sign-In
```
Test Case: EP_002
Steps:
1. Create user via EP_001 first
2. Sign out (if logged in)
3. Go to login page
4. Enter email and password from EP_001
5. Click "Sign In"

Expected Result:
- User authenticated
- Redirected to dashboard
- User data loaded from Firestore

Verify:
- getCurrentUser() returns correct uid/email
- No "wrong password" errors
```

#### Google Sign-In (Web)
```
Test Case: GSI_001
Steps:
1. Open login page
2. Click "Sign In with Google" button
3. Complete Google OAuth popup
4. Grant permissions

Expected Result:
- User authenticated with Google
- User document created in Firestore
- Redirected to dashboard

Verify:
- Firebase Console > Auth > Users > new user with Google provider
- User profile initialized in Firestore
```

#### Google Sign-In (Mobile)
```
Test Case: GSI_002
Steps:
1. Open mobile app
2. Tap "Profile" tab
3. Click "Sign In with Google" button
4. Complete Google authentication
5. Grant camera/contact permissions if prompted

Expected Result:
- User authenticated
- Profile screen shows user info
- No errors in logs

Verify:
- Firebase Console > Authentication > new Google user
- `firebase functions:log` shows initializeProfile called
```

#### Error Handling
```
Test Case: AUTH_ERROR_001
Steps:
1. Go to login page
2. Try email without @: "testexample.com"
3. Try weak password: "123"
4. Try duplicate email (already exists)

Expected Result:
- Clear error messages (not technical)
- Example: "Please enter a valid email address"
- User can retry

Verify:
- No Firebase error codes shown to user
- No stack traces in error message
```

### 3. Firestore Rules Testing

#### User Profile Protection
```
Test Case: RULES_001
Setup:
- Signed in as user A
- Try to modify user B's rewardPoints

Steps:
1. Sign in as user A
2. In console, try:
   await updateDoc(doc(db, "users", "user_b_uid"), {
     rewardPoints: 1000
   });

Expected Result:
- Write BLOCKED
- Error: "Missing or insufficient permissions"

Verify:
- Check Cloud Logging: permission-denied errors logged
```

#### Prediction Read/Write Protection
```
Test Case: RULES_002
Setup:
- Signed in as user A
- Try to create/update predictions directly

Steps:
1. Sign in as user A
2. Try direct write:
   await setDoc(doc(db, "predictions", "test_pred"), {
     userId: auth.currentUser.uid,
     fixtureId: "123",
     pick: "home",
     status: "correct"  // ← user tries to set outcome
   });

Expected Result:
- Write BLOCKED
- Error: "Missing or insufficient permissions"
- Users must use submitPredictionTicket function

Verify:
- No prediction docs created
- Cloud Logging shows blocked writes
```

#### Daily Limit Protection
```
Test Case: RULES_003
Setup:
- Signed in as user
- Check daily limit document

Steps:
1. Sign in
2. Try to modify predictionDailyLimits:
   await updateDoc(
     doc(db, "predictionDailyLimits", "user_a_2024-12-26"),
     { batchCount: 100 }
   );

Expected Result:
- Write BLOCKED
- Only functions can update

Verify:
- predictionDailyLimits always read-only from client
```

### 4. Cloud Functions Testing

#### submitPredictionTicket
```
Test Case: FUNC_SUBMIT_001
Setup:
- Signed in as user
- 7 scheduled matches available

Steps:
1. Get 7 fixture IDs with status="scheduled"
2. Call function:
   const submitTicket = httpsCallable(functions, 'submitPredictionTicket');
   const result = await submitTicket({
     picks: [
       { fixtureId: "123", pick: "home" },
       { fixtureId: "124", pick: "draw" },
       // ... 5 more ...
     ]
   });

Expected Result:
- Function returns: { ticketNumber: 1 }
- 7 prediction docs created in Firestore
- predictionDailyLimits batchCount incremented to 1

Verify:
- Firebase Console > Firestore > predictions > 7 new docs
- Each doc has correct fixture info and user ID
- firebase functions:log shows successful call
```

#### Daily Limit Enforcement
```
Test Case: FUNC_SUBMIT_002
Setup:
- User has already submitted 2 tickets today
- Try to submit a 3rd ticket

Steps:
1. Call submitPredictionTicket with 7 new picks
2. Observe error

Expected Result:
- Function throws: "You have already submitted two tickets today"
- No prediction docs created
- batchCount remains at 2

Verify:
- Error code: "resource-exhausted"
- No new predictions in Firestore
- Firebase Console > Functions > shows error rate
```

#### Duplicate Fixture Prevention
```
Test Case: FUNC_SUBMIT_003
Setup:
- User submits ticket with same fixture in 2+ picks
- User already has prediction for a fixture in picks

Steps:
1. Call submitPredictionTicket with duplicate fixtureIds
2. Call with fixture that user already predicted on

Expected Result:
- Function throws appropriate error
- No predictions created

Verify:
- Error message is clear
- No orphaned predictions in Firestore
```

#### Settlement Process
```
Test Case: FUNC_SETTLE_001
Setup:
- Submit prediction ticket with 7 matches (all scheduled)
- Wait for matches to finish (or use fixtures with known outcomes)

Steps:
1. Submit ticket via submitPredictionTicket
2. Wait ≤5 minutes (settlement job interval)
3. Check prediction docs status

Expected Result:
- All 7 prediction docs have status: "correct" or "incorrect"
- ticketStatus: "won" or "lost"
- If 7/7 correct: user.rewardPoints += 50, ticketReward: 50
- If <7 correct: ticketReward: 0

Verify:
- Firebase Console > Firestore > predictions > check statuses
- User profile > rewardPoints increased by 50 (if won)
- firebase functions:log > settlePredictionTickets > success
```

#### Hope Points Conversion
```
Test Case: FUNC_WALLET_001
Setup:
- User has ≥100 HP (from winning predictions)
- Signed in

Steps:
1. Call convertHopePointsToWallet:
   const convert = httpsCallable(functions, 'convertHopePointsToWallet');
   const result = await convert({ hpAmount: 100, currency: 'USD' });

2. Check result

Expected Result:
- Function returns:
  {
    success: true,
    usdAmount: 1.00,
    transactionId: "trans_xxxxx"
  }
- User profile updated:
  - rewardPoints: -100
  - walletBalance: +1.00
- Transaction doc created in Firestore

Verify:
- User doc: rewardPoints decreased
- User doc: walletBalance increased
- transactions collection > new doc with type: "hp_conversion"
- firebase functions:log shows success
```

#### Conversion Error Cases
```
Test Case: FUNC_WALLET_002
Steps:
1. Try to convert 0 HP
2. Try to convert -50 HP
3. Try to convert 50,000 HP (user only has 100)

Expected Result:
- Case 1: Error "HP amount must be a positive integer"
- Case 2: Error "HP amount must be a positive integer"
- Case 3: Error "Insufficient Hope Points for conversion"

Verify:
- No transaction created
- User balance unchanged
- Firestore > transactions > no entry
```

### 5. Integration Testing (Full Flow)

#### Complete User Journey
```
Test Case: INTEGRATION_001
Duration: 30-60 minutes

Steps:
1. CREATE ACCOUNT
   - Sign up with email/password
   - Verify user document exists
   
2. SUBMIT PREDICTION
   - Navigate to Predictions page
   - Select 7 scheduled matches
   - Click Submit
   - Verify "ticket submitted" message
   - Check Firestore: 7 predictions created
   
3. WAIT FOR SETTLEMENT
   - Wait up to 5 minutes
   - Check prediction statuses changed
   - If 7/7 correct: verify rewardPoints += 50
   
4. CONVERT POINTS
   - If user has HP, navigate to Wallet
   - Enter HP amount (e.g., 50)
   - Click "Convert to Wallet"
   - Verify "Conversion successful" message
   - Check user doc: rewardPoints -50, walletBalance +0.50
   
5. SIGN OUT
   - Click Profile > Sign Out
   - Verify redirected to login
   - Close tab, reopen app
   - Verify session restored (still logged in)

Expected Result:
- All steps complete without errors
- All data correctly updated in Firestore
- No permissions errors
- Functions logs show all calls successful

Verify:
- Firebase Console > all collections updated correctly
- No errors in firebase functions:log
- Cloud Logging shows no permission-denied entries
```

### 6. Performance Testing

#### Function Latency
```
Test Case: PERF_001
Steps:
1. Call submitPredictionTicket 10 times with network log open
2. Measure time from request to response

Expected:
- Function responds in <3 seconds (including API-Football call)
- No timeout errors

Verify:
- Network tab shows total latency <3000ms
- firebase functions:log shows execution_ms
```

#### Settlement Throughput
```
Test Case: PERF_002
Setup:
- Create 100+ pending predictions across multiple users

Steps:
1. Run settlement job
2. Monitor Firestore read/write operations

Expected:
- Settlement completes in <60 seconds
- Firestore: <500 operations
- No timeout or quota errors

Verify:
- firebase functions:log > settlement_tickets > duration
- Cloud Logging > resource utilization
```

### 7. Mobile App Testing

#### Android Setup
```
Steps:
1. Place google-services.json in mobile/android/app/
2. Build app: flutter build apk
3. Install on Android device/emulator
4. Test authentication flows
5. Verify Firebase console receives auth events
```

#### iOS Setup
```
Steps:
1. Place GoogleService-Info.plist in Runner (via Xcode)
2. Build app: flutter build ios
3. Install on iOS device/simulator
4. Test authentication flows
5. Verify Firebase console receives auth events
```

#### Mobile Auth Testing
```
Test Case: MOBILE_AUTH_001
Steps:
1. Open app
2. Tap Profile tab
3. Test Email/Password sign-up
4. Verify user appears in Firebase Auth
5. Sign out and test sign-in
6. Test Google Sign-In

Expected:
- All flows work without crashes
- Error messages display in-app (not console)
- Session persists after app restart
```

## Post-Deployment Verification

### Week 1 Monitoring
```
Daily checklist:
- [ ] No increase in function error rates
- [ ] Settlement jobs running on schedule (5-min interval)
- [ ] Cleanup jobs running (60-min interval)
- [ ] No permission denied errors in logs
- [ ] All user signs-ups completing successfully
```

### Monthly Review
```
- [ ] Review transaction history for anomalies
- [ ] Check function execution statistics
- [ ] Verify all Firestore indexes built
- [ ] Review security rule performance
- [ ] Check for any unhandled exceptions
```

## Test Data

### Sample Fixtures (for manual testing)
Use API-Football fixtures endpoint:
```
GET /fixtures?ids=123-124-125-126-127-128-129
```

Requires 7 fixture IDs with status="scheduled"

### Sample User Accounts
```
Email: testuser@example.com
Password: TestPassword123!
Display: Test User

Email: demo@football.app
Password: DemoPass123!
Display: Demo Player
```

## Rollback Procedure

If production issues occur:

### Revert Firestore Rules
```bash
# Restore previous rules from git
git checkout HEAD~1 -- firebase.rules
firebase deploy --only firestore:rules
```

### Revert Functions
```bash
# Revert to previous version
firebase deploy --only functions --force
# Or redeploy from previous tag:
git checkout v1.0.0
firebase deploy --only functions
```

### Check Status
```bash
firebase functions:list
firebase functions:log --limit 100
```

## Success Criteria

✅ All authentication methods (Email, Google) working
✅ User profiles auto-initialize on first sign-in
✅ Prediction tickets submitted successfully
✅ Settlement runs every 5 minutes
✅ 50 HP awarded only for 7/7 correct predictions
✅ 2-ticket daily limit enforced server-side
✅ Lost tickets deleted after 24 hours
✅ Hope Points converted to wallet currency
✅ Transaction history maintained for audit
✅ No client-side tampering possible
✅ All errors handled gracefully
✅ No hardcoded secrets in code
