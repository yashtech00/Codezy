import './globals.css';
import Navbar from '@/components/Navbar';
import { AuthProvider } from '@/lib/auth-context';

export const metadata = {
  title: 'Codezy AutoReview — Multi-Agent GitHub PR Reviewer',
  description: 'Automated multi-agent security & style PR reviews with real-time WebSocket dashboard.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen flex flex-col antialiased">
        <AuthProvider>
          <Navbar />
          <main className="flex-grow">{children}</main>
          <footer className="border-t border-slate-800/60 py-6 text-center text-xs text-slate-500">
            Codezy AutoReview &copy; {new Date().getFullYear()} — Multi-Agent PR Intelligence
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
