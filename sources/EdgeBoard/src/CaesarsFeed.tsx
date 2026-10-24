import { useState } from 'react';
import { api } from '@appdeploy/client';

type FeedAccess = {
  status: string;
  note: string;
};

export default function CaesarsFeed() {
  const [access, setAccess] = useState<FeedAccess | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function checkAccess() {
    setBusy(true);
    setError('');
    setAccess(null);
    try {
      const { data } = await api.get('/api/caesars-feed?sport=americanfootball_nfl');
      if (!data || typeof data.status !== 'string' || typeof data.note !== 'string') {
        throw new Error('The access response was incomplete. No prices were requested.');
      }
      setAccess({ status: data.status, note: data.note });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not check Caesars access. Retry the status check.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Caesars price access">
      <h3>Caesars price access</h3>
      <p>
        This public feed does not load sportsbook prices. The access check below
        uses zero provider credits; signing in or adding a key does not enable
        price requests here.
      </p>
      <p>
        For supported live NFL games, open Live &amp; 2H, select a game and check
        the provider connection. Retrieving provider prices requires sign-in,
        a configured provider and explicit confirmation of the displayed credit
        budget. Inspect the returned bookmakers; Caesars coverage is not guaranteed.
      </p>
      <p>
        <a href="#live">Open Live &amp; 2H price workspace</a>
      </p>
      <button type="button" disabled={busy} onClick={checkAccess}>
        {busy ? 'Checking access…' : 'Check Caesars access · 0 credits'}
      </button>
      {error && <p role="alert">{error}</p>}
      {access && (
        <div role="status">
          <p><strong>{access.status}</strong></p>
          <p>{access.note}</p>
        </div>
      )}
      <p>
        When the supported workflow is unavailable, retain your account quote
        as manual evidence. No substitute prices, probability or betting approval
        are supplied by this access check.
      </p>
    </section>
  );
}
