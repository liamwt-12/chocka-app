import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chocka — Keep your diary chocka',
  description: 'We manage your Google Business Profile so you don\'t have to. Auto-posting, review replies, weekly stats. £29/month.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "var(--bd)", background: 'var(--cream)', color: 'var(--text)' }}>
        {children}
      </body>
    </html>
  );
}
