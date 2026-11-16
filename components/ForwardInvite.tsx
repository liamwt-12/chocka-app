'use client';

/**
 * "Someone else looks after our Google listing."
 *
 * The commonest reason a shop cannot connect is that the person who opened the
 * invitation is not the person with the Google login: it is a relative, a web
 * designer, a manager. This lets them pass the page on with one press, using
 * the phone's own share sheet (or copying the address where there is none).
 *
 * It is the shop passing on its own link from its own phone. We send nothing
 * and we do not learn who it went to.
 */
import { useState } from 'react';

export default function ForwardInvite({ shopName }: { shopName: string }) {
  const [note, setNote] = useState('');
  const pass = async () => {
    const url = window.location.href;
    const text = `Can you connect ${shopName} to this for me? It needs whoever looks after our Google listing. It takes two minutes.`;
    try {
      if (navigator.share) { await navigator.share({ title: shopName, text, url }); return; }
      await navigator.clipboard.writeText(url);
      setNote('Link copied. Paste it into a message to them.');
    } catch (e: any) {
      // Closing the share sheet is not an error worth showing.
      if (e?.name !== 'AbortError') setNote('Copy the address of this page from the top of your browser and send it to them.');
    }
  };
  return (
    <div className="mt-5 text-center">
      <button type="button" onClick={pass} className="text-sm text-gray-600 underline bg-transparent border-0 cursor-pointer">
        Someone else looks after our Google listing: send this to them
      </button>
      {note && <p role="status" className="text-sm text-gray-600 mt-2">{note}</p>}
    </div>
  );
}
