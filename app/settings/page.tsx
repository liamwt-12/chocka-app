'use client';

import { useState, useCallback } from 'react';
import SettingsToggle from '@/components/SettingsToggle';
import Button from '@/components/Button';
import Toast from '@/components/Toast';

export default function SettingsPage() {
  const [autoPost, setAutoPost] = useState(true);
  const [autoReply, setAutoReply] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [tokenBroken, setTokenBroken] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const updateSetting = useCallback(async (field: string, value: boolean) => {
    setLoading(field);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error();
      setToast({ message: 'Setting updated', type: 'success' });
    } catch {
      setToast({ message: 'Failed to update', type: 'error' });
    } finally {
      setLoading(null);
    }
  }, []);

  const handleManageBilling = async () => {
    setLoading('billing');
    try {
      const res = await fetch('/api/billing-portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setToast({ message: 'Failed to open billing portal', type: 'error' });
    } finally {
      setLoading(null);
    }
  };

  const handleReconnectGoogle = () => {
    window.location.href = '/api/auth/callback/google?action=reconnect';
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setLoading('delete');
    try {
      const res = await fetch('/api/account/delete', { method: 'DELETE' });
      if (res.ok) {
        window.location.href = '/login';
      } else {
        throw new Error();
      }
    } catch {
      setToast({ message: 'Failed to delete account', type: 'error' });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-charcoal mb-8">Settings</h1>

      {/* Token broken banner */}
      {tokenBroken && (
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-5 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-red-600 text-sm">Google connection lost</h3>
              <p className="text-sm text-red-400 mt-1">We can&apos;t post or reply until you reconnect.</p>
            </div>
            <Button onClick={handleReconnectGoogle} variant="danger" size="sm">
              Reconnect
            </Button>
          </div>
        </div>
      )}

      {/* Automation toggles */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="font-bold text-charcoal text-sm mb-2">Automation</h2>
        <SettingsToggle
          label="Auto-posting"
          description="We write and publish a post to your Google profile every week"
          enabled={autoPost}
          loading={loading === 'auto_post_enabled'}
          onChange={(v) => { setAutoPost(v); updateSetting('auto_post_enabled', v); }}
        />
        <SettingsToggle
          label="Auto-reply to reviews"
          description="We reply to 4-5 star reviews automatically. Bad reviews always need your approval."
          enabled={autoReply}
          loading={loading === 'auto_reply_enabled'}
          onChange={(v) => { setAutoReply(v); updateSetting('auto_reply_enabled', v); }}
        />
        <SettingsToggle
          label="SMS notifications"
          description="Monday stats, review alerts, and post confirmations"
          enabled={smsEnabled}
          loading={loading === 'sms_enabled'}
          onChange={(v) => { setSmsEnabled(v); updateSetting('sms_enabled', v); }}
        />
      </div>

      {/* Subscription */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-6">
        <h2 className="font-bold text-charcoal text-sm mb-4">Subscription</h2>
        <Button onClick={handleManageBilling} variant="ghost" loading={loading === 'billing'}>
          Manage billing
        </Button>
      </div>

      {/* Danger zone */}
      <div className="bg-white rounded-2xl border border-red-100 p-6">
        <h2 className="font-bold text-red-500 text-sm mb-4">Danger zone</h2>

        {!showDeleteModal ? (
          <Button onClick={() => setShowDeleteModal(true)} variant="ghost" size="sm">
            Delete my account
          </Button>
        ) : (
          <div>
            <p className="text-sm text-gray-500 mb-4">
              This will permanently delete all your data, cancel your subscription,
              and disconnect your Google profile. Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Type DELETE"
              className="w-full px-4 py-3 rounded-xl border-2 border-red-200 focus:border-red-400 focus:outline-none text-charcoal text-sm mb-4"
            />
            <div className="flex gap-3">
              <Button
                onClick={handleDeleteAccount}
                variant="danger"
                size="sm"
                disabled={deleteConfirm !== 'DELETE'}
                loading={loading === 'delete'}
              >
                Delete everything
              </Button>
              <Button onClick={() => { setShowDeleteModal(false); setDeleteConfirm(''); }} variant="ghost" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
