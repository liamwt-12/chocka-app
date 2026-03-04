'use client';

import { useState } from 'react';

interface ReferralCardProps {
  referralCode: string;
  referralCount: number;
}

export default function ReferralCard({ referralCode, referralCount }: ReferralCardProps) {
  const [copied, setCopied] = useState(false);
  const link = `https://chocka.co.uk/ref/${referralCode}`;

  const copyLink = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-brand-light rounded-2xl p-6">
      <h3 className="font-bold text-charcoal text-lg mb-1">Refer a mate</h3>
      <p className="text-sm text-gray-500 mb-4">You both get a free month when they sign up.</p>

      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 bg-white rounded-xl px-4 py-3 text-sm text-gray-600 truncate border border-gray-200">
          {link}
        </div>
        <button
          onClick={copyLink}
          className="bg-brand text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-brand-dark transition-colors shrink-0"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {referralCount > 0 && (
        <p className="text-sm text-gray-500">
          {referralCount} {referralCount === 1 ? 'referral' : 'referrals'} so far
        </p>
      )}
    </div>
  );
}
