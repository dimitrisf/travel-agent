'use client';

import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import {
  isError,
  isSuccess,
  type ResponseState,
} from '@/lib/explorer/explorerTypes';

// Uniform response panel used by every endpoint page. Takes a ResponseState
// and a renderPretty callback that turns the parsed data into a Pretty view;
// the Raw tab dumps the JSON. Status + timing show in the header. Renders
// nothing while idle.

export type ResponsePanelProps<T> = {
  state: ResponseState<T>;
  renderPretty: (data: T) => ReactNode;
};

export function ResponsePanel<T>({
  state,
  renderPretty,
}: ResponsePanelProps<T>) {
  const [tab, setTab] = useState<'pretty' | 'raw'>('pretty');

  if (state.kind === 'idle') return null;

  return (
    <Paper variant="outlined" sx={{ mt: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="overline" sx={{ letterSpacing: '0.14em' }}>
          Response
        </Typography>
        <ResponseMeta state={state} />
      </Box>

      {state.kind === 'loading' && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {isError(state) && (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">
            {state.error.code && (
              <Typography
                component="span"
                fontFamily="monospace"
                sx={{ mr: 1 }}
              >
                {state.error.code}
              </Typography>
            )}
            {state.error.message}
          </Alert>
        </Box>
      )}

      {isSuccess(state) && (
        <>
          <Tabs
            value={tab}
            onChange={(_, v: 'pretty' | 'raw') => setTab(v)}
            sx={{ px: 2, minHeight: 40 }}
          >
            <Tab value="pretty" label="Pretty" sx={{ minHeight: 40 }} />
            <Tab value="raw" label="Raw" sx={{ minHeight: 40 }} />
          </Tabs>
          <Box sx={{ p: 2 }}>
            {tab === 'pretty' ? (
              renderPretty(state.data)
            ) : (
              <Box
                component="pre"
                sx={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  m: 0,
                  overflow: 'auto',
                  bgcolor: 'action.hover',
                  p: 2,
                  borderRadius: 1,
                }}
              >
                {JSON.stringify(state.data, null, 2)}
              </Box>
            )}
          </Box>
        </>
      )}
    </Paper>
  );
}

function ResponseMeta<T>({ state }: { state: ResponseState<T> }) {
  if (state.kind === 'idle' || state.kind === 'loading') return null;

  return (
    <Typography variant="caption" color="text.secondary" fontFamily="monospace">
      {state.status || 'ERR'} &middot; {state.timing}ms
    </Typography>
  );
}
