import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Inhouse Chat Admin',
  description: 'Admin portal and setup wizard for the internal chat suite.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
