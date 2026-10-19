'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsIcon from '@mui/icons-material/Settings';
import {
  useSettings,
  type DateFormat,
  type ThemeMode,
} from '@/context/SettingsContext';

// Header settings menu — icon button opens a popover with two toggle
// groups (theme + date format). Each group is a ToggleButtonGroup so
// the mutually-exclusive choice is obvious at a glance; selections
// apply immediately (SettingsContext persists them to localStorage).
// Deliberately shaped to extend: adding a toggle later means dropping
// one more labelled Stack into the menu.

export function SettingsMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { themeMode, dateFormat, setThemeMode, setDateFormat } = useSettings();

  const handleThemeMode = (
    _event: React.MouseEvent<HTMLElement>,
    value: ThemeMode | null,
  ) => {
    // ToggleButtonGroup emits `null` when the user clicks the already-
    // selected button, which would be an "unset" we don't want for a
    // required preference. Ignore the null.
    if (value) setThemeMode(value);
  };

  const handleDateFormat = (
    _event: React.MouseEvent<HTMLElement>,
    value: DateFormat | null,
  ) => {
    if (value) setDateFormat(value);
  };

  return (
    <>
      <Tooltip title="Settings">
        <IconButton
          onClick={(e) => setAnchor(e.currentTarget)}
          color="inherit"
          aria-label="Open settings menu"
          sx={{ mr: 1 }}
        >
          <SettingsIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        {/* Box container controls padding on both axes: 16px horizontal
    (MenuList provides none for non-MenuItem children) and 12px
    vertical on top of MenuList's own 8px, so the content sits
    inside a 16px / 20px cushion — reads as a popover panel rather
    than a tight list. */}
        <Box sx={{ px: 2, py: 1.5 }}>
          <Stack spacing={2}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Theme
              </Typography>
              <ToggleButtonGroup
                value={themeMode}
                exclusive
                onChange={handleThemeMode}
                size="small"
                fullWidth
                aria-label="Theme mode"
              >
                <ToggleButton value="light" aria-label="Light theme">
                  <LightModeIcon sx={{ mr: 0.5 }} fontSize="small" />
                  Light
                </ToggleButton>
                <ToggleButton value="dark" aria-label="Dark theme">
                  <DarkModeIcon sx={{ mr: 0.5 }} fontSize="small" />
                  Dark
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                Date format
              </Typography>
              <ToggleButtonGroup
                value={dateFormat}
                exclusive
                onChange={handleDateFormat}
                size="small"
                fullWidth
                aria-label="Date format"
              >
                <ToggleButton
                  value="auto"
                  aria-label="Automatic date format from system locale"
                >
                  Auto
                </ToggleButton>
                <ToggleButton value="eu" aria-label="European date format">
                  EU
                </ToggleButton>
                <ToggleButton value="us" aria-label="US date format">
                  US
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Stack>
        </Box>
      </Menu>
    </>
  );
}
