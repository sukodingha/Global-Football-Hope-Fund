import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  String? firebaseError;
  try {
    await Firebase.initializeApp();
  } catch (_) {
    firebaseError = 'Firebase native configuration is required for sign-in and live data.';
  }
  runApp(GlobalFootballApp(firebaseError: firebaseError));
}

class GlobalFootballApp extends StatelessWidget {
  const GlobalFootballApp({super.key, this.firebaseError});
  final String? firebaseError;

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Global Football Hope Fund',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          scaffoldBackgroundColor: const Color(0xfff4f7fa),
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff0b2d4d), primary: const Color(0xff0b2d4d), secondary: const Color(0xff00a651)),
        ),
        home: AppShell(firebaseError: firebaseError),
      );
}

class AppShell extends StatefulWidget {
  const AppShell({super.key, this.firebaseError});
  final String? firebaseError;
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int index = 0;
  @override
  Widget build(BuildContext context) {
    final pages = [const HomeScreen(), const PredictionsScreen(), const CommunityScreen(), const WalletScreen(), ProfileScreen(firebaseReady: widget.firebaseError == null)];
    return Scaffold(
      body: SafeArea(child: Column(children: [
        if (widget.firebaseError != null) MaterialBanner(content: Text(widget.firebaseError!), actions: const [SizedBox.shrink()]),
        Expanded(child: IndexedStack(index: index, children: pages)),
      ])),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) => setState(() => index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.sports_soccer_outlined), selectedIcon: Icon(Icons.sports_soccer), label: 'Predict'),
          NavigationDestination(icon: Icon(Icons.forum_outlined), selectedIcon: Icon(Icons.forum), label: 'Community'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Wallet'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}

class Header extends StatelessWidget {
  const Header(this.title, {super.key, this.action});
  final String title;
  final Widget? action;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
    child: Row(children: [
      const CircleAvatar(backgroundColor: Color(0xff0b2d4d), child: Text('GF', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
      const SizedBox(width: 12), Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800))), if (action != null) action!,
    ]),
  );
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) => ListView(children: [
    const Header('Global Football Hope Fund', action: Icon(Icons.notifications_none)),
    Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: Container(padding: const EdgeInsets.all(22), decoration: BoxDecoration(color: const Color(0xff0b2d4d), borderRadius: BorderRadius.circular(8)), child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('One game. One community.\nEndless hope.', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)), SizedBox(height: 10), Text('Live scores, prediction tickets, community connection, and real impact.', style: TextStyle(color: Color(0xffdbeafe))),
    ]))),
    const SizedBox(height: 22), const SectionTitle('Today at GFHF'),
    const Padding(padding: EdgeInsets.symmetric(horizontal: 20), child: Row(children: [Expanded(child: StatCard('24', 'Live matches')), SizedBox(width: 12), Expanded(child: StatCard('2', 'Daily tickets')), SizedBox(width: 12), Expanded(child: StatCard('50 HP', '7/7 reward'))])),
    const SizedBox(height: 22), const SectionTitle('Live Scores'),
    const MatchTile('UEFA Champions League', 'Bodo/Glimt', 'NEC Nijmegen', '0 - 0', '20:00'),
    const MatchTile('League Cup', 'Cardiff', 'Norwich', '0 - 0', 'Upcoming'),
  ]);
}

class PredictionsScreen extends StatefulWidget {
  const PredictionsScreen({super.key});
  @override
  State<PredictionsScreen> createState() => _PredictionsScreenState();
}

class _PredictionsScreenState extends State<PredictionsScreen> {
  final selected = <int>{};
  final matches = const ['Bodo/Glimt vs NEC Nijmegen', 'Cardiff vs Norwich', 'Blackburn vs Sheffield Utd', 'Stoke City vs Hull City', 'Ipswich vs Leicester', 'Plymouth vs Coventry', 'Cambridge United vs Millwall'];
  @override
  Widget build(BuildContext context) => ListView(children: [
    const Header('Prediction League'),
    Padding(padding: const EdgeInsets.symmetric(horizontal: 20), child: Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: const Color(0xff0b2d4d), borderRadius: BorderRadius.circular(8)), child: Row(children: [
      Expanded(child: Text('Selected: ${selected.length} / 7', style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.bold))),
      FilledButton(onPressed: selected.length == 7 ? () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Ticket ready for secure Firebase Function validation.'))) : null, child: const Text('Submit Ticket')),
    ]))),
    const Padding(padding: EdgeInsets.fromLTRB(20, 12, 20, 8), child: Text('Two tickets are available per calendar day. A 50 HP reward is issued only for 7/7.', style: TextStyle(color: Color(0xff475569)))),
    ...List.generate(matches.length, (i) => Card(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(matches[i], style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 10),
          Row(children: List.generate(3, (pick) => Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: pick == 2 ? 0 : 8),
              child: OutlinedButton(
                style: selected.contains(i) && pick == 0 ? OutlinedButton.styleFrom(backgroundColor: const Color(0xffdc2626), foregroundColor: Colors.white) : null,
                onPressed: () => setState(() {
                  if (selected.contains(i)) {
                    selected.remove(i);
                  } else if (selected.length < 7) {
                    selected.add(i);
                  }
                }),
                child: Text(['1', 'X', '2'][pick]),
              ),
            ),
          ))),
        ]),
      ),
    )),
  ]);
}

class CommunityScreen extends StatefulWidget {
  const CommunityScreen({super.key});
  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  final picker = ImagePicker();
  final text = TextEditingController();
  XFile? photo;
  @override
  void dispose() { text.dispose(); super.dispose(); }
  Future<void> takePhoto() async {
    try { final image = await picker.pickImage(source: ImageSource.camera, imageQuality: 85); if (image != null && mounted) setState(() => photo = image); }
    catch (_) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Camera access is unavailable. Check permissions and try again.'))); }
  }
  @override
  Widget build(BuildContext context) => ListView(children: [
    const Header('Community', action: Icon(Icons.groups_outlined)),
    const Padding(
      padding: EdgeInsets.symmetric(horizontal: 20),
      child: Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('GFHF Team', style: TextStyle(fontWeight: FontWeight.w800)),
            SizedBox(height: 8),
            Text('Welcome to the mobile community. Share football moments that matter.'),
            SizedBox(height: 12),
            Row(children: [Icon(Icons.favorite_border, size: 18), SizedBox(width: 6), Text('Support'), SizedBox(width: 20), Icon(Icons.chat_bubble_outline, size: 18), SizedBox(width: 6), Text('Comment')]),
          ]),
        ),
      ),
    ),
    Padding(padding: const EdgeInsets.all(20), child: Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
      if (photo != null) ListTile(leading: const Icon(Icons.image), title: const Text('Photo attached'), trailing: IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => photo = null))),
      TextField(controller: text, maxLines: 3, decoration: const InputDecoration(hintText: 'Write to the community...', border: InputBorder.none)),
      Row(children: [IconButton(onPressed: takePhoto, icon: const Icon(Icons.camera_alt_outlined), tooltip: 'Take a photo'), const Spacer(), FilledButton(onPressed: () { if (text.text.trim().isNotEmpty || photo != null) { setState(() { text.clear(); photo = null; }); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Post ready for Firebase upload.'))); } }, child: const Text('Post'))]),
    ])))),
  ]);
}

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});
  @override
  Widget build(BuildContext context) => ListView(children: [
    const Header('Wallet & Giving'),
    Padding(padding: const EdgeInsets.all(20), child: Container(padding: const EdgeInsets.all(20), decoration: BoxDecoration(color: const Color(0xff0b2d4d), borderRadius: BorderRadius.circular(8)), child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Available balance', style: TextStyle(color: Color(0xffbfdbfe))), SizedBox(height: 6), Text(r'$24.00', style: TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w800)), SizedBox(height: 8), Text('Secure top-ups and donations are verified through Firebase Functions.', style: TextStyle(color: Color(0xffdbeafe)))]))),
    const ListTile(leading: Icon(Icons.volunteer_activism_outlined), title: Text('Make a donation'), subtitle: Text('Support Global Football Hope Fund')),
    const ListTile(leading: Icon(Icons.history_outlined), title: Text('Transaction history'), subtitle: Text('View verified wallet activity')),
  ]);
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.firebaseReady});
  final bool firebaseReady;
  @override
  Widget build(BuildContext context) => ListView(children: [
    const Header('Profile'), Padding(padding: const EdgeInsets.all(20), child: Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(children: [
      const CircleAvatar(radius: 34, child: Icon(Icons.person, size: 40)), const SizedBox(height: 12), const Text('Football Fan', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)), const SizedBox(height: 4), Text(firebaseReady ? 'Sign in to sync your profile and Hope Points.' : 'Firebase platform configuration is required to sign in.', textAlign: TextAlign.center), const SizedBox(height: 16),
      FilledButton.icon(onPressed: firebaseReady ? () async => FirebaseAuth.instance.signInAnonymously() : null, icon: const Icon(Icons.login), label: const Text('Sign In')),
    ])))),
  ]);
}

class SectionTitle extends StatelessWidget { const SectionTitle(this.text, {super.key}); final String text; @override Widget build(BuildContext context) => Padding(padding: const EdgeInsets.fromLTRB(20, 4, 20, 12), child: Text(text, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800))); }
class StatCard extends StatelessWidget { const StatCard(this.value, this.label, {super.key}); final String value; final String label; @override Widget build(BuildContext context) => Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)), child: Column(children: [Text(value, style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xff0b2d4d))), const SizedBox(height: 4), Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 11, color: Color(0xff64748b)))])); }
class MatchTile extends StatelessWidget { const MatchTile(this.league, this.home, this.away, this.score, this.status, {super.key}); final String league, home, away, score, status; @override Widget build(BuildContext context) => Card(margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 5), child: ListTile(title: Text('$home  $score  $away', style: const TextStyle(fontWeight: FontWeight.w700)), subtitle: Text(league), trailing: Text(status, style: const TextStyle(fontSize: 12, color: Color(0xff0b6e4f), fontWeight: FontWeight.bold)))); }
