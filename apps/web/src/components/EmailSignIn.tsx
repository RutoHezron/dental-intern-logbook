import { useState, type FormEvent } from 'react';
import { useSync } from '../sync/SyncProvider';
import { ToneNote } from './ui';

/** Sign in with an emailed 6-digit code; no passwords. */
export function EmailSignIn({ onSignedIn, submitLabel = 'Sign in' }: { onSignedIn?: () => void; submitLabel?: string }) {
  const sync = useSync();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'email') {
        await sync.sendCode(email);
        setStep('code');
      } else {
        await sync.verifyCode(email, code);
        onSignedIn?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        {step === 'email' ? (
          <div className="min-w-60 flex-1">
            <label className="label" htmlFor="sync-email">Email</label>
            <input id="sync-email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        ) : (
          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="sync-code">Code sent to {email}</label>
            <input
              id="sync-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              className="field code tabular tracking-[0.3em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || (step === 'email' ? !email.includes('@') : code.length < 6)}>
          {busy ? 'Please wait…' : step === 'email' ? 'Email me a code' : submitLabel}
        </button>
        {step === 'code' && (
          <button type="button" className="btn btn-ghost" onClick={() => setStep('email')}>
            Use a different email
          </button>
        )}
      </form>
      {error && (
        <div className="mt-3">
          <ToneNote tone="critical">{error}</ToneNote>
        </div>
      )}
    </>
  );
}
