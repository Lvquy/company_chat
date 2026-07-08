import 'package:flutter/material.dart';

void main() {
  runApp(const InhouseChatApp());
}

class InhouseChatApp extends StatelessWidget {
  const InhouseChatApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Inhouse Chat',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0F766E)),
        scaffoldBackgroundColor: const Color(0xFFF4F1EA),
        useMaterial3: true,
      ),
      home: const ChatHomePage(),
    );
  }
}

class ChatHomePage extends StatelessWidget {
  const ChatHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final items = [
      ('Phòng Kinh Doanh', 'Nhóm chung bộ phận', true),
      ('Lan Anh', 'Chị gửi giúp báo giá PDF nhé', false),
      ('All Company', 'Thông báo lịch họp toàn công ty', true),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inhouse Chat'),
        centerTitle: false,
      ),
      body: Column(
        children: [
          Container(
            margin: const EdgeInsets.all(16),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
            ),
            child: const Row(
              children: [
                Icon(Icons.apartment_rounded),
                SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Danh bạ theo phòng ban, chat 1-1, chat nhóm, gửi file và ảnh.',
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final item = items[index];
                return Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    children: [
                      CircleAvatar(
                        backgroundColor: const Color(0xFFD7EEE9),
                        child: Text(item.$1.substring(0, 1)),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.$1,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 4),
                            Text(item.$2),
                          ],
                        ),
                      ),
                      if (item.$3)
                        const Icon(Icons.groups_rounded, color: Color(0xFF0F766E))
                      else
                        const Icon(Icons.person_rounded, color: Color(0xFF0F766E)),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
