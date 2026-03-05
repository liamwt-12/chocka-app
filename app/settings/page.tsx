'use client';

import { useState, useCallback } from 'react';

const hd = "'Cabinet Grotesk', sans-serif";
const bd = "'Inter', system-ui, sans-serif";
const C = {
  charcoal: '#2A2520', cream: '#F8F6F3', orange: '#D4622B',
  green: '#2D8B4E', red: '#D93025', grey: '#A09A93', text: '#5A554F',
};

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
      const res = await fetch('/api/account/delete', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) });
      if (!res.ok) throw new Error();
      setToast({ message: 'Setting updated', type: 'success' });
    } catch { setToast({ message: 'Failed to update', type: 'error' }); }
    finally { setLoading(null); }
  }, []);

  const handleManageBilling = async () => {
    setLoading('billing');
    try {
      const res = await fetch('/api/billing-portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { setToast({ message: 'Failed to open billing portal', type: 'error' }); }
    finally { setLoading(null); }
  };

  const handleReconnectGoogle = () => { window.location.href = '/api/auth/callback/google?action=reconnect'; };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setLoading('delete');
    try {
      const res = await fetch('/api/account/delete', { method: 'DELETE' });
      if (res.ok) { window.location.href = '/login'; } else { throw new Error(); }
    } catch { setToast({ message: 'Failed to delete account', type: 'error' }); }
    finally { setLoading(null); }
  };

  const card: React.CSSProperties = { background: '#FFFFFF', borderRadius: 24, padding: '1.25rem 1.2rem', marginBottom: '0.75rem', boxShadow: '0 2px 16px rgba(42,37,32,.04)' };
  const eyebrow: React.CSSProperties = { fontFamily: hd, fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '2.5px', color: C.grey, margin: '0 0 0.75rem' };
  const pill: React.CSSProperties = { padding: '0.7rem 1.5rem', borderRadius: 100, fontFamily: bd, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', border: 'none' };

  return (
    <div style={{ animation: 'fadeUp 0.8s ease both' }}>
      <h1 style={{ fontFamily: hd, fontWeight: 800, fontSize: 'clamp(22px, 4vw, 28px)', color: C.charcoal, letterSpacing: '-1px', margin: '0 0 1.5rem' }}>Settings</h1>

      {tokenBroken && (
        <div style={{ ...card, background: 'rgba(217,48,37,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontFamily: hd, fontWeight: 700, fontSize: '0.85rem', color: C.red, margin: '0 0 0.15rem' }}>Google connection lost</p>
              <p style={{ fontFamily: bd, fontSize: '0.78rem', color: C.text, margin: 0 }}>We can&apos;t post or reply until you reconnect.</p>
            </div>
            <button onClick={handleReconnectGoogle} style={{ ...pill, background: C.red, color: '#FFFFFF', padding: '0.5rem 1rem', fontSize: '0.78rem' }}>Reconnect</button>
          </div>
        </div>
      )}

      <div style={card}>
        <p style={eyebrow}>Automation</p>
        <Toggle label="Auto-posting" desc="We write and publish a post to your Google profile every week" enabled={autoPost} loading={loading === 'auto_post_enabled'} onChange={(v) => { setAutoPost(v); updateSetting('auto_post_enabled', v); }} />
        <Toggle label="Auto-reply to reviews" desc="We reply to 4-5 star reviews automatically. Bad reviews always need your approval." enabled={autoReply} loading={loading === 'auto_reply_enabled'} onChange={(v) => { setAutoReply(v); updateSetting('auto_reply_enabled', v); }} />
        <Toggle label="SMS notifications" desc="Monday stats, review alerts, and post confirmations" enabled={smsEnabled} loading={loading === 'sms_enabled'} onChange={(v) => { setSmsEnabled(v); updateSetting('sms_enabled', v); }} />
      </div>

      <div style={card}>
        <p style={eyebrow}>Subscription</p>
        <button onClick={handleManageBilling} style={{ ...pill, background: C.charcoal, color: '#FFFFFF' }} disabled={loading === 'billing'}>
          {loading === 'billing' ? 'Opening...' : 'Manage billing'}
        </button>
      </div>

      <div style={{ ...card, background: 'rgba(217,48,37,0.02)' }}>
        <p style={{ ...eyebrow, color: C.red }}>Danger zone</p>
        {!showDeleteModal ? (
          <button onClick={() => setShowDeleteModal(true)} style={{ fontFamily: bd, fontSize: '0.8rem', color: C.grey, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete my account</button>
        ) : (
          <div>
            <p style={{ fontFamily: bd, fontSize: '0.83rem', color: C.text, margin: '0 0 0.75rem', lineHeight: 1.5 }}>
              This will permanently delete all your data, cancel your subscription, and disconnect your Google profile. Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              type="text" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="Type DELETE"
              style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 12, border: `2px solid rgba(217,48,37,0.2)`, outline: 'none', fontFamily: bd, fontSize: '0.85rem', color: C.charcoal, marginBottom: '0.65rem', background: 'transparent' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={handleDeleteAccount} disabled={deleteConfirm !== 'DELETE' || loading === 'delete'} style={{ ...pill, background: C.red, color: '#FFFFFF', opacity: deleteConfirm !== 'DELETE' ? 0.4 : 1, fontSize: '0.8rem', padding: '0.55rem 1rem' }}>
                {loading === 'delete' ? 'Deleting...' : 'Delete everything'}
              </button>
              <button onClick={() => { setShowDeleteModal(false); setDeleteConfirm(''); }} style={{ ...pill, background: 'transparent', color: C.grey, fontSize: '0.8rem', padding: '0.55rem 1rem' }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', background: toast.type === 'success' ? C.green : C.red, color: '#FFFFFF', fontFamily: bd, fontSize: '0.8rem', fontWeight: 600, padding: '0.6rem 1.2rem', borderRadius: 100, boxShadow: '0 4px 24px rgba(42,37,32,.15)', zIndex: 1000 }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

function Toggle({ label, desc, enabled, loading, onChange }: { label: string; desc: string; enabled: boolean; loading: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.65rem 0' }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontFamily: "'Inter', system-ui", fontWeight: 600, fontSize: '0.85rem', color: '#2A2520', margin: '0 0 0.1rem' }}>{label}</p>
        <p style={{ fontFamily: "'Inter', system-ui", fontSize: '0.75rem', color: '#A09A93', margin: 0, lineHeight: 1.4 }}>{desc}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0, marginTop: 2,
          background: enabled ? '#2D8B4E' : '#E0DDD8',
          position: 'relative', transition: 'background 0.2s',
          opacity: loading ? 0.5 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: enabled ? 22 : 2,
          width: 20, height: 20, borderRadius: 10, background: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(42,37,32,.15)', transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}
