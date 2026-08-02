'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';

// Reads `?notice=…` from the URL and renders a persistent Alert banner
// above the chat surface, then strips the param via history.replaceState
// so a refresh doesn't re-fire the notice. The banner sticks until the
// user clicks its close button (bottom-right Snackbar was too easy to
// miss for redirects the user didn't trigger).
//
// Used to communicate soft errors from server-side redirects (where a
// classic error page or modal would be overkill). Current callers:
//   - /c/[id]/page.tsx anon-fallback: `?notice=conversation-unavailable`
//     Fired when an anonymous visitor hits a /c/[id] URL that's not
//     shared (or was previously shared but has been revoked). Neutral
//     wording avoids revealing which of doesn't-exist / private /
//     was-revoked is the actual cause.
//
// Visual style intentionally matches the "Shared conversation — view-only"
// Alert in ChatContainer so both banner-shaped notices read as the same
// class of UI element.
const NOTICES: Record<
  string,
  { severity: 'info' | 'warning'; message: string }
> = {
  'conversation-unavailable': {
    // Warning (orange) rather than info (blue): the user was trying to
    // do something (view a conversation) and it didn't work. That reads
    // as "heads up, this failed" more than "here's some neutral info."
    severity: 'warning',
    message:
      'This conversation isn’t accessible. It may be private or no longer shared.',
  },
};

// UrlNoticeHandler is a client component because it uses useSearchParams and useEffect. It reads the notice param from the URL, shows an Alert banner, and removes the param from the URL to prevent re-showing on refresh. The Alert can be dismissed by the user.
// URL e.g., `https://example.com/?notice=conversation-unavailable` will show the corresponding message in the banner.
export function UrlNoticeHandler() {
  const searchParams = useSearchParams();

  // firedRef ensures the notice is only processed once per mount. This prevents the effect from re-running if the component re-renders for any reason (e.g., state changes) and avoids showing the Alert multiple times.
  // Also, guards against React strict-mode double-invoke.
  const firedRef = useRef(false);

  // active state holds the current notice to display. If null, no Alert is shown. The state is set when a valid notice param is found and cleared when the user closes the Alert.
  const [active, setActive] = useState<{
    severity: 'info' | 'warning';
    message: string;
  } | null>(null);

  useEffect(() => {
    // Only fire once per mount. If the user navigates to a different page and back, the component will remount and can show a new notice if present.
    if (firedRef.current) return;

    const notice = searchParams.get('notice');
    if (!notice) return;

    // Mark as fired so we don't re-show the notice on re-render.
    firedRef.current = true;

    // Strip the param so a hard refresh doesn't re-show the notice.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('notice');
    // Use history.replaceState to update the URL without reloading the page. This keeps the user on the same page but removes the notice param from the URL, preventing the Alert from reappearing on refresh.
    window.history.replaceState({}, '', cleanUrl.toString());

    const config = NOTICES[notice];
    if (config) setActive(config);
  }, [searchParams]);

  if (!active) return null;

  return (
    <Alert
      severity={active.severity}
      variant="outlined"
      onClose={() => setActive(null)}
      sx={{ mb: 2 }}
    >
      {active.message}
    </Alert>
  );
}
