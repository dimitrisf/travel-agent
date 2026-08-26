'use client';

import { useState } from 'react';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { buildCurl } from '@/lib/explorer/buildCurl';
import type { HttpMethod } from '@/lib/explorer/explorerTypes';

// "Copy as curl" button. Writes the equivalent command to the clipboard
// and briefly shows a confirmation snackbar.

export type CurlButtonProps = {
  method: HttpMethod;
  path: string;
  body?: unknown;
  disabled?: boolean;
};

export function CurlButton({ method, path, body, disabled }: CurlButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const cmd = buildCurl({ method, path, body });
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
    } catch {
      // clipboard.writeText can fail in insecure contexts; swallow for now.
    }
  }

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<ContentCopyIcon />}
        onClick={copy}
        disabled={disabled}
      >
        Copy as curl
      </Button>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Copied to clipboard"
      />
    </>
  );
}
