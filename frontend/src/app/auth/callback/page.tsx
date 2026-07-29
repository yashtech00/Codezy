'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    const refreshToken = searchParams.get('refreshToken');
    const error = searchParams.get('error');

    if (error) {
      console.error('OAuth Callback Error:', error);
      router.push('/?auth_error=' + encodeURIComponent(error));
      return;
    }

    if (token) {
      localStorage.setItem('codezy_token', token);
      if (refreshToken) {
        localStorage.setItem('codezy_refresh_token', refreshToken);
      }
      refreshUser(token).then(() => {
        router.push('/profile');
      });
    } else {
      router.push('/');
    }
  }, [searchParams, router, refreshUser]);


  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
      <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-slate-400 font-medium animate-pulse">Completing GitHub authentication...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-slate-400 font-medium">Loading...</p>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
