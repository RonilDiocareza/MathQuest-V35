import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../widgets/custom_button.dart';
import '../widgets/math_background.dart';
import 'home_screen.dart';

class LandingScreen extends StatelessWidget {
  const LandingScreen({
    super.key,
    this.role,
  });

  final String? role;

  bool get _isStudent => role?.trim().toLowerCase() == 'student';

  void _openPlay(BuildContext context) {
    if (!_isStudent) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => const HomeScreen()),
    );
  }

  void _openAbout(BuildContext context) {
    if (!_isStudent) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const AboutUsScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: MathBackground(
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 620),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Image.asset(
                            'assets/images/Icon/Icon2.png',
                            width: math.min(constraints.maxWidth - 48, 560),
                            height:
                                math.min(constraints.maxWidth - 48, 560) / 4,
                            fit: BoxFit.contain,
                          ),
                          const SizedBox(height: 18),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 20,
                              vertical: 12,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF1E7D4)
                                  .withValues(alpha: 0.94),
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(
                                color: const Color(0xFF5A3620),
                                width: 2,
                              ),
                            ),
                            child: const Text(
                              'Explore, solve, and grow your math skills.',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Color(0xFF3C2A1C),
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          if (_isStudent) ...[
                            const SizedBox(height: 32),
                            ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 320),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  CustomButton(
                                    text: 'Play',
                                    width: double.infinity,
                                    onPressed: () => _openPlay(context),
                                  ),
                                  const SizedBox(height: 16),
                                  CustomButton(
                                    text: 'About Us',
                                    width: double.infinity,
                                    onPressed: () => _openAbout(context),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class AboutUsScreen extends StatelessWidget {
  const AboutUsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text(
          'About MathQuest',
          style: TextStyle(color: Colors.black),
        ),
      ),
      body: MathBackground(
        child: SafeArea(
          top: false,
          child: Stack(
            children: [
              Positioned.fill(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 94),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 760),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(
                          color:
                              const Color(0xFFF1E7D4).withValues(alpha: 0.96),
                          borderRadius: BorderRadius.circular(24),
                          border: Border.all(
                            color: const Color(0xFF5A3620),
                            width: 2,
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x55331E0F),
                              blurRadius: 14,
                              offset: Offset(0, 6),
                            ),
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Image.asset(
                                  'assets/images/Icon/Icon2.png',
                                  width: 64,
                                  height: 64,
                                  fit: BoxFit.contain,
                                ),
                                const SizedBox(width: 14),
                                const Expanded(
                                  child: Text(
                                    'MathQuest',
                                    style: TextStyle(
                                      color: Colors.black,
                                      fontSize: 28,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 20),
                            const _AboutSection(
                              title: 'About the App',
                              titleColor: Colors.black,
                              body:
                                  'MathQuest is an educational mathematics game designed to help Grade 7 students improve their mathematical knowledge and problem-solving skills through interactive gameplay.',
                            ),
                            const SizedBox(height: 20),
                            const _AboutSection(
                              title: 'Purpose of MathQuest',
                              titleColor: Colors.black,
                              body:
                                  'MathQuest aims to make learning mathematics more engaging and enjoyable through interactive gameplay, questions, and challenges. It helps students improve their mathematical knowledge, accuracy, and problem-solving skills while combining education and entertainment in a game-based learning experience. MathQuest is primarily designed for Grade 7 students who want to practice and improve their mathematics skills, and teachers can also use it as a supplementary learning activity.',
                            ),
                            const SizedBox(height: 20),
                            const _AboutSection(
                              title: 'How to Use MathQuest',
                              numberedItems: [
                                'After signing in, press Play to open the home screen. Admin accounts continue to the Admin Dashboard.',
                                'Choose an available activity, such as Modules, Stages, or Classroom Quests.',
                                'Follow the on-screen instructions for the selected activity.',
                                'In Stages, explore the map and interact with question NPCs when prompted.',
                                'Answer the mathematics questions presented in each activity.',
                                'Review scores and learning progress using the available progress features.',
                              ],
                            ),
                            const SizedBox(height: 24),
                            const _AboutSection(
                              title: 'Developers',
                              titleColor: Colors.black,
                              centered: true,
                            ),
                            const SizedBox(height: 14),
                            const Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: _AboutProfile(
                                    name: 'Rhodney F. Nano',
                                  ),
                                ),
                                SizedBox(width: 8),
                                Expanded(
                                  child: _AboutProfile(
                                    name: 'Jeziel A. Gabac',
                                  ),
                                ),
                                SizedBox(width: 8),
                                Expanded(
                                  child: _AboutProfile(
                                    name: 'Ronil F. Diocareza',
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 24),
                            const Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: _AboutProfile(
                                    title: 'Thesis Adviser',
                                    name: 'Mr. Jomari Launio',
                                  ),
                                ),
                                SizedBox(width: 16),
                                Expanded(
                                  child: _AboutProfile(
                                    title: 'Technical Critic',
                                    name: 'Ms. Dezza Anne A. Peregrina',
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Center(
                      child: CustomButton(
                        key: const ValueKey('about-back'),
                        text: 'Back',
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AboutSection extends StatelessWidget {
  const _AboutSection({
    required this.title,
    this.body,
    this.numberedItems,
    this.titleColor = Colors.black,
    this.centered = false,
  });

  final String title;
  final String? body;
  final List<String>? numberedItems;
  final Color titleColor;
  final bool centered;

  @override
  Widget build(BuildContext context) {
    final items = numberedItems;
    return Column(
      crossAxisAlignment:
          centered ? CrossAxisAlignment.stretch : CrossAxisAlignment.start,
      children: [
        Text(
          title,
          textAlign: centered ? TextAlign.center : TextAlign.start,
          style: TextStyle(
            color: titleColor,
            fontSize: 21,
            fontWeight: FontWeight.w800,
          ),
        ),
        if (body != null) ...[
          const SizedBox(height: 8),
          Text(
            body!,
            textAlign: TextAlign.justify,
            style: const TextStyle(fontSize: 16, height: 1.5),
          ),
        ],
        if (items != null) ...[
          const SizedBox(height: 8),
          for (var index = 0; index < items.length; index++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 28,
                    child: Text(
                      numberedItems == null ? '•' : '${index + 1}.',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        height: 1.5,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      items[index],
                      textAlign: TextAlign.justify,
                      style: const TextStyle(fontSize: 16, height: 1.5),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ],
    );
  }
}

class _AboutProfile extends StatelessWidget {
  const _AboutProfile({
    required this.name,
    this.title,
  });

  final String name;
  final String? title;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (title != null) ...[
          SizedBox(
            height: 42,
            child: Center(
              child: Text(
                title!,
                textAlign: TextAlign.center,
                maxLines: 2,
                style: const TextStyle(
                  color: Colors.black,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
        ],
        LayoutBuilder(
          builder: (context, constraints) {
            final radius = (constraints.maxWidth / 2).clamp(28.0, 40.0);
            return CircleAvatar(
              radius: radius,
              backgroundColor: const Color(0xFFE8E1D7),
              child: Icon(
                Icons.person,
                size: radius * 1.15,
                color: const Color(0xFF5A3620),
              ),
            );
          },
        ),
        const SizedBox(height: 8),
        Text(
          name,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.black,
            fontSize: 14,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
