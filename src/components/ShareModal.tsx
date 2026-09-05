'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useShareState } from '@/context/ShareContext';

// Share modal (Stage 17 Phase 4). Owned by the Header's Share button.
// Toggle at the top drives the shared flag; when on, the URL field is
// enabled and copyable. Toggling off invalidates any outstanding links
// (next request to /c/[id] from a non-owner returns 404).
//
// State lives in ShareContext (shared, conversationId). This component
// reads current state, calls PATCH /api/conversations/[id] on toggle
// change, and pushes the new shared value back into the context on
// success so the Header can reflect it (e.g., a badge on the icon).
export function ShareModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Read/write the shared flag and conversationId from the context. The
  // context is populated by the ChatContainer on mount, so this modal
  // only renders when there's a current conversation and the viewer is
  // the owner.
  const { conversationId, shared, setShared } = useShareState();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local state to show a temporary "copied" alert when the user clicks the copy button. This is a UI affordance and doesn't affect the shared state or the URL itself.
  const [copied, setCopied] = useState(false);

  // Compute the shareable URL from the current origin so it works in
  // dev (localhost) and prod without config. window is always defined
  // by the time this component renders (client-only).
  const url =
    typeof window !== 'undefined' && conversationId
      ? `${window.location.origin}/c/${conversationId}`
      : '';

  // `next` means the new shared state that the user wants to set.
  async function toggle(next: boolean) {
    if (!conversationId || busy) return;

    // Optimistic: flip the switch (and the Header icon color) at click
    // time. The network round-trip runs in the background — on success
    // we reconcile against the server's response (usually a no-op); on
    // failure we roll back and surface the error. The busy check above
    // still prevents rapid re-toggling while a request is in flight.
    setShared(next);
    setBusy(true);
    setError(null);

    try {
      // PATCH /api/conversations/[id] to update the shared flag. The server validates ownership and returns the new shared value. If the request fails (e.g., network error, server error, or validation failure), we catch it and roll back the optimistic update.
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared: next }),
      });

      const body = (await res.json()) as { shared?: boolean; error?: string };

      if (!res.ok || typeof body.shared !== 'boolean') {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      // Reconcile — should equal `next` in normal operation.
      // This ensures that the context reflects the server's authoritative state, which is important in case of any discrepancies or race conditions.
      setShared(body.shared);
    } catch (err) {
      // Roll back the optimistic flip.
      setShared(!next);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Copy the shareable URL to the clipboard. This uses the Clipboard API, which is supported in most modern browsers. If the copy fails (e.g., due to browser permissions), an error message is shown in the modal. The copied state is set to true for 2 seconds to show a temporary success alert.
  async function copyToClipboard() {
    if (!url) return;

    try {
      // Use the Clipboard API to write the URL to the user's clipboard. This is an asynchronous operation that may fail if the user denies permission or if the browser does not support the API.
      await navigator.clipboard.writeText(url);

      // Show a temporary "copied" alert for 2 seconds. This is a UX enhancement that provides feedback to the user that the copy operation was successful. The setTimeout is used to reset the copied state after 2 seconds, hiding the alert.
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(`Couldn't copy: ${(err as Error).message}`);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Share conversation</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <FormControlLabel
            control={
              <Switch
                // The switch's checked state is controlled by the shared flag from the context. This ensures that the switch reflects the current sharing status of the conversation, whether it's toggled on or off.
                checked={shared}
                // When the user toggles the switch, call the toggle function with the new checked state. The toggle function handles the optimistic update, network request, and error handling.
                // The `void` operator is used here to explicitly ignore the promise returned by `toggle()`. This is a common pattern in event handlers where the return value is not needed, and it prevents unhandled promise rejections from being logged in the console if the toggle operation fails.
                onChange={(e) => void toggle(e.target.checked)}
                disabled={busy || !conversationId}
              />
            }
            label={
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography>Share this conversation</Typography>
                {busy && <CircularProgress size={16} />}
              </Stack>
            }
          />

          <Typography variant="body2" color="text.secondary">
            {shared
              ? 'Anyone with the link can view this conversation read-only. Turn off sharing to revoke.'
              : 'Sharing is off. Turn it on to generate a shareable link.'}
          </Typography>

          {shared && (
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                fullWidth
                size="small"
                value={url}
                InputProps={{ readOnly: true }}
                // Select the entire URL when the user focuses the field, making it easier to copy manually if needed. This is a UX enhancement that complements the copy button.
                onFocus={(e) => e.target.select()}
              />
              <IconButton
                // Copy the URL to the clipboard when clicked. This uses the Clipboard API, which is supported in most modern browsers. If the copy fails (e.g., due to browser permissions), an error message is shown in the modal.
                // The `void` operator is used here to explicitly ignore the promise returned by `copyToClipboard()`. This is a common pattern in event handlers where the return value is not needed, and it prevents unhandled promise rejections from being logged in the console if the copy operation fails.
                onClick={() => void copyToClipboard()}
                aria-label="Copy link"
                // Disable the copy button if the URL is empty. This prevents the user from attempting to copy an invalid or non-existent link, which could lead to confusion or errors. The button will only be enabled when there is a valid shareable URL available.
                disabled={!url}
              >
                <ContentCopyIcon />
              </IconButton>
            </Stack>
          )}

          {copied && (
            <Alert severity="success" variant="outlined">
              Link copied to clipboard.
            </Alert>
          )}
          {error && (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
