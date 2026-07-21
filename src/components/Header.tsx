'use client';

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
import GoogleIcon from '@mui/icons-material/Google';
import {
  useCurrentUser,
  signInWithGoogle,
  signOutCurrent,
} from '@/lib/auth/client';

// Phase 1 header. Signed-out: "Sign in with Google" button. Signed-in:
// avatar with a dropdown menu (email + Sign out). No other nav yet — the
// app is a single-page chat, and any /c/[id] navigation lands in Phase 3.
export function Header() {
  const user = useCurrentUser();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          Travel Assistant
        </Typography>
        {user ? (
          <>
            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
              <Avatar
                src={user.image ?? undefined}
                alt={user.name ?? user.email}
                sx={{ width: 32, height: 32 }}
              >
                {(user.name ?? user.email).charAt(0).toUpperCase()}
              </Avatar>
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
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
                  setAnchorEl(null);
                  void signOutCurrent();
                }}
              >
                Sign out
              </MenuItem>
            </Menu>
          </>
        ) : (
          <Button
            variant="outlined"
            startIcon={<GoogleIcon />}
            onClick={() => void signInWithGoogle()}
          >
            Sign in
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
}
