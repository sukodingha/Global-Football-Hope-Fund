import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

/// Production-grade Firebase Authentication for Flutter
/// Supports: Email/Password, Google Sign-In
/// Features: Error recovery, profile initialization, session management
class FirebaseAuthManager {
  static final FirebaseAuthManager _instance = FirebaseAuthManager._internal();

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final GoogleSignIn _googleSignIn = GoogleSignIn();
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  factory FirebaseAuthManager() {
    return _instance;
  }

  FirebaseAuthManager._internal();

  /// User-friendly error messages
  static const Map<String, String> errorMessages = {
    'email-already-in-use': 'Email already registered. Please sign in instead.',
    'weak-password': 'Password must be at least 6 characters.',
    'invalid-email': 'Please enter a valid email address.',
    'user-not-found': 'Email not registered. Please sign up first.',
    'wrong-password': 'Incorrect password. Please try again.',
    'too-many-requests': 'Too many failed attempts. Please try again later.',
    'account-exists-with-different-credential':
        'This email is already registered with another sign-in method.',
    'operation-not-supported-by-emulator': 'Operation not supported in emulator.',
    'invalid-credential': 'Invalid credentials. Please try again.',
    'network-request-failed': 'Network error. Please check your connection.',
  };

  /// Get user-friendly error message
  String getErrorMessage(String code, [String fallback = 'Authentication failed.']) {
    return errorMessages[code] ?? fallback;
  }

  /// Current user
  User? get currentUser => _auth.currentUser;

  /// Is user authenticated
  bool get isAuthenticated => currentUser != null;

  /// Listen to auth state changes
  Stream<User?> get authStateStream => _auth.authStateChanges();

  /// Initialize user profile on first sign-in
  Future<void> _initializeUserProfile(User user) async {
    try {
      final callable = _functions.httpsCallable('initializeProfile');
      await callable.call({
        'displayName': user.displayName,
      });
      print('Profile initialized for ${user.uid}');
    } catch (e) {
      print('Profile initialization error: $e');
      // Non-fatal: profile may already exist
    }
  }

  /// Sign up with email and password
  /// Returns: User object with uid, email, displayName
  Future<UserCredential> signUpWithEmail({
    required String email,
    required String password,
    required String displayName,
  }) async {
    try {
      if (email.isEmpty || password.isEmpty) {
        throw FirebaseAuthException(
          code: 'invalid-argument',
          message: 'Email and password are required.',
        );
      }

      if (password.length < 6) {
        throw FirebaseAuthException(
          code: 'weak-password',
          message: 'Password must be at least 6 characters.',
        );
      }

      final userCred = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      print('Auth account created: ${userCred.user!.uid}');

      // Update display name
      if (displayName.isNotEmpty) {
        await userCred.user!.updateDisplayName(displayName);
      }

      // Initialize user profile (backend-driven)
      await _initializeUserProfile(userCred.user!);

      return userCred;
    } on FirebaseAuthException catch (e) {
      print('Sign-up error: ${e.code} - ${e.message}');
      rethrow;
    }
  }

  /// Sign in with email and password
  /// Returns: UserCredential with authenticated user
  Future<UserCredential> signInWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      if (email.isEmpty || password.isEmpty) {
        throw FirebaseAuthException(
          code: 'invalid-argument',
          message: 'Email and password are required.',
        );
      }

      final userCred = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      print('Signed in: ${userCred.user!.uid}');

      return userCred;
    } on FirebaseAuthException catch (e) {
      print('Sign-in error: ${e.code} - ${e.message}');
      rethrow;
    }
  }

  /// Sign in with Google
  /// Returns: UserCredential with authenticated user
  Future<UserCredential> signInWithGoogle() async {
    try {
      final googleUser = await _googleSignIn.signIn();
      if (googleUser == null) {
        throw FirebaseAuthException(
          code: 'cancelled-popup-request',
          message: 'Google Sign-In cancelled.',
        );
      }

      final googleAuth = await googleUser.authentication;
      final credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      final userCred = await _auth.signInWithCredential(credential);
      print('Google Sign-In successful: ${userCred.user!.uid}');

      // Initialize user profile on first sign-in
      await _initializeUserProfile(userCred.user!);

      return userCred;
    } on FirebaseAuthException catch (e) {
      print('Google Sign-In error: ${e.code} - ${e.message}');
      rethrow;
    } catch (e) {
      print('Google Sign-In error: $e');
      throw FirebaseAuthException(
        code: 'network-request-failed',
        message: 'Network error. Please check your connection.',
      );
    }
  }

  /// Sign in anonymously (for guest users)
  /// Returns: UserCredential with anonymous user
  Future<UserCredential> signInAnonymously() async {
    try {
      final userCred = await _auth.signInAnonymously();
      print('Signed in anonymously: ${userCred.user!.uid}');

      // Initialize guest profile
      await _initializeUserProfile(userCred.user!);

      return userCred;
    } on FirebaseAuthException catch (e) {
      print('Anonymous sign-in error: ${e.code} - ${e.message}');
      rethrow;
    }
  }

  /// Send password reset email
  Future<void> sendPasswordResetEmail(String email) async {
    try {
      if (email.isEmpty) {
        throw FirebaseAuthException(
          code: 'invalid-argument',
          message: 'Email is required.',
        );
      }

      await _auth.sendPasswordResetEmail(email: email);
      print('Password reset email sent: $email');
    } on FirebaseAuthException catch (e) {
      print('Password reset error: ${e.code} - ${e.message}');
      rethrow;
    }
  }

  /// Sign out current user
  Future<void> signOut() async {
    try {
      await _auth.signOut();
      await _googleSignIn.signOut();
      print('User signed out');
    } catch (e) {
      print('Sign-out error: $e');
      rethrow;
    }
  }

  /// Link anonymous account to email/password
  Future<UserCredential> linkAnonymousToEmail({
    required String email,
    required String password,
  }) async {
    try {
      if (currentUser == null || !currentUser!.isAnonymous) {
        throw FirebaseAuthException(
          code: 'invalid-credential',
          message: 'No anonymous user to link.',
        );
      }

      final credential = EmailAuthProvider.credential(
        email: email,
        password: password,
      );

      final linked = await currentUser!.linkWithCredential(credential);
      print('Anonymous account linked to email: $email');

      // Update profile
      await _initializeUserProfile(linked.user!);

      return linked;
    } on FirebaseAuthException catch (e) {
      print('Link account error: ${e.code} - ${e.message}');
      rethrow;
    }
  }

  /// Get user profile data from Firestore
  Future<Map<String, dynamic>?> getUserProfile(String uid) async {
    try {
      final doc = await _firestore.collection('users').doc(uid).get();
      if (doc.exists) {
        return doc.data();
      }
      return null;
    } catch (e) {
      print('Get user profile error: $e');
      rethrow;
    }
  }

  /// Verify user email (sends verification email)
  Future<void> sendEmailVerification() async {
    try {
      if (currentUser == null) {
        throw FirebaseAuthException(
          code: 'no-current-user',
          message: 'No user is currently signed in.',
        );
      }

      await currentUser!.sendEmailVerification();
      print('Email verification sent to ${currentUser!.email}');
    } on FirebaseAuthException catch (e) {
      print('Email verification error: ${e.code} - ${e.message}');
      rethrow;
    }
  }

  /// Reload auth state
  Future<void> reloadUser() async {
    try {
      if (currentUser == null) {
        throw FirebaseAuthException(
          code: 'no-current-user',
          message: 'No user is currently signed in.',
        );
      }

      await currentUser!.reload();
      print('User state reloaded');
    } catch (e) {
      print('Reload user error: $e');
      rethrow;
    }
  }
}

/// Usage example:
///
/// // Create singleton instance
/// final authManager = FirebaseAuthManager();
///
/// // Sign up with email
/// try {
///   final userCred = await authManager.signUpWithEmail(
///     email: 'user@example.com',
///     password: 'SecurePassword123!',
///     displayName: 'John Doe',
///   );
///   print('Signed up: ${userCred.user!.email}');
/// } on FirebaseAuthException catch (e) {
///   print('Error: ${authManager.getErrorMessage(e.code)}');
/// }
///
/// // Sign in with Google
/// try {
///   final userCred = await authManager.signInWithGoogle();
///   print('Signed in: ${userCred.user!.displayName}');
/// } on FirebaseAuthException catch (e) {
///   print('Error: ${authManager.getErrorMessage(e.code)}');
/// }
///
/// // Listen to auth state
/// authManager.authStateStream.listen((user) {
///   if (user != null) {
///     print('User signed in: ${user.email}');
///   } else {
///     print('User signed out');
///   }
/// });
