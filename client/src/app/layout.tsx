import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navigation from '@/components/layout/Navigation';
import { Toast } from '@/components/ui/Toast';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { AppProvider } from '@/context/AppContext';

export const metadata: Metadata = {
  title: '临床试验智能匹配平台',
  description: '从病历信息中提取关键要素，快速匹配合适的临床试验',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-white text-gray-900 antialiased">
        <QueryProvider>
          <AppProvider>
            <Navigation />
            <main className="min-h-screen">
              {children}
            </main>
            <Toast />
          </AppProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
