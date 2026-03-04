'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import Button from '@/components/Button';

export default function ReferralPage() {
  const params = useParams();
  const code = params.code as string;

  useEffect(() => {
    if (code) {
      sessionStorage.setItem('chocka_ref', code);
    }
  }, [code]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-extrabold text-brand mb-2">Chocka</h1>
        <div className="bg-brand-light rounded-2xl p-8 mb-6">
          <div className="text-4xl mb-4">🎉</div>
          <h2 className="text-xl font-bold text-charcoal mb-2">You&apos;ve been referred!</h2>
          <p className="text-sm text-gray-500">
            Sign up now and you both get a free month. Your mate clearly rates us.
          </p>
        </div>
        <Button href={`/login?ref=${code}`} size="lg" className="w-full">
          Get started — 30 seconds
        </Button>
        <p className="text-xs text-gray-300 mt-4">£29/month · Cancel anytime</p>
      </div>
    </div>
  );
}
