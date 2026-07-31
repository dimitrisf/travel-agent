'use client';

import Link from 'next/link';
import { useState } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Avatar from '@mui/material/Avatar';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import GoogleIcon from '@mui/icons-material/Google';
import {
  useCurrentUser,
  signInWithGoogle,
  signOutCurrent,
} from '@/lib/auth/client';

// Header for both the / and /c/[id] surfaces. Signed-out: title + sign-in
// button. Signed-in: title, "+ New chat", "Conversations" dropdown (10
// most recent, lazily fetched), avatar + sign-out menu.

// Split into three sub-components for readability:
// - Header — top-level AppBar + Toolbar. Title is now a Link to /. Branches on useCurrentUser().
// - SignedInControls — + New chat link (navigates to /), the Conversations dropdown, and the avatar+menu (Sign out).
// - ConversationsMenu — lazy fetch on first open: GET /api/conversations, cache the response in local state, refetch on each re-open (so a just-created conversation on the current tab shows up). Shows a spinner while loading, "No saved conversations yet" for empty, or a list of MenuItems where each is a Link to /c/[id] with title + updatedAt.toLocaleString().
// - SignedOutControls — the same Sign in with Google button from before.
export function Header() {
  const user = useCurrentUser();

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Typography
          variant="h6"
          component={Link}
          href="/"
          sx={{
            flexGrow: 1,
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          Travel Assistant
        </Typography>

        {user ? <SignedInControls /> : <SignedOutControls />}
      </Toolbar>
    </AppBar>
  );
}

// Signed-in controls: + New chat, Conversations dropdown, avatar+menu (Sign out). The menu is anchored to the avatar button and opens on click. The menu shows the signed-in user's email and a Sign out item that calls signOutCurrent() when clicked.
function SignedInControls() {
  const user = useCurrentUser();

  // userMenuAnchor is the anchor element for the user menu (avatar dropdown). It's null when the menu is closed, and set to the avatar button element when open. This state controls the open/close behavior of the menu.
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(
    null,
  );

  // Non-null when signed-in — this component is only rendered by that
  // branch, but TS can't know that so we guard.
  if (!user) return null;

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Button
        component={Link}
        href="/"
        size="small"
        startIcon={<AddIcon />}
        variant="text"
        color="inherit"
      >
        New chat
      </Button>

      <ConversationsMenu />

      <IconButton onClick={(e) => setUserMenuAnchor(e.currentTarget)}>
        <Avatar
          src={user.image ?? undefined}
          alt={user.name ?? user.email}
          sx={{ width: 32, height: 32 }}
        >
          {(user.name ?? user.email).charAt(0).toUpperCase()}
        </Avatar>
      </IconButton>
      <Menu
        anchorEl={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        onClose={() => setUserMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Signed in as
          </Typography>
          <Typography variant="body2" fontWeight={500}>
            {user.email}
          </Typography>
        </Box>
        <MenuItem
          onClick={() => {
            setUserMenuAnchor(null);
            void signOutCurrent();
          }}
        >
          Sign out
        </MenuItem>
      </Menu>
    </Stack>
  );
}

// Conversations dropdown — lazily fetches on first open so it doesn't run
// on every page render. Refetches on each open to stay fresh (a new
// conversation created on this page won't otherwise show up until reload).
function ConversationsMenu() {
  // anchor is the anchor element for the conversations menu. It's null when the menu is closed, and set to the button element when open. This state controls the open/close behavior of the menu.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const [loading, setLoading] = useState(false);

  const [conversations, setConversations] = useState<Array<{
    id: string;
    title: string | null;
    updatedAt: string;
  }> | null>(null);

  async function open(e: React.MouseEvent<HTMLElement>) {
    setAnchor(e.currentTarget);
    setLoading(true);
    try {
      const res = await fetch('/api/conversations');
      const body = (await res.json()) as {
        conversations?: Array<{
          id: string;
          title: string | null;
          updatedAt: string;
        }>;
      };
      setConversations(body.conversations ?? []);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        size="small"
        startIcon={<HistoryIcon />}
        variant="text"
        color="inherit"
        onClick={open}
      >
        Conversations
      </Button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 280, maxWidth: 360 } } }}
      >
        {loading && (
          <Box
            sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'center' }}
          >
            <CircularProgress size={20} />
          </Box>
        )}
        {!loading && conversations && conversations.length === 0 && (
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              No saved conversations yet.
            </Typography>
          </Box>
        )}
        {!loading &&
          conversations?.map((c) => (
            <MenuItem
              key={c.id}
              component={Link}
              href={`/c/${c.id}`}
              onClick={() => setAnchor(null)}
              sx={{
                display: 'block',
                whiteSpace: 'normal',
              }}
            >
              <Typography variant="body2" noWrap>
                {c.title ?? '(untitled)'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(c.updatedAt).toLocaleString()}
              </Typography>
            </MenuItem>
          ))}
      </Menu>
    </>
  );
}

function SignedOutControls() {
  return (
    <Button
      variant="outlined"
      startIcon={<GoogleIcon />}
      onClick={() => void signInWithGoogle()}
    >
      Sign in
    </Button>
  );
}
