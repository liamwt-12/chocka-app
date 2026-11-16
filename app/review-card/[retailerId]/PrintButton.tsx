'use client';

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} style={{ background: '#1A1A1A', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
      Print this card
    </button>
  );
}
