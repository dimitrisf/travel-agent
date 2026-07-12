'use client';

import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import BuildIcon from '@mui/icons-material/Build';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { ToolCall } from '@/types/chat';
import { BOOKING_TOOL_NAMES, tryParseBooking } from '@/utils/booking';
import { truncate } from '@/utils/format';
import { BookingCard } from './BookingCard';

// ToolCallView displays a single tool call in an accordion. The accordion shows the tool name and truncated arguments, and can be expanded to show the full arguments and output. If the tool call is still pending (no output yet), it shows a loading indicator.
export function ToolCallView({ toolCall }: { toolCall: ToolCall }) {
  // If this is one of the booking tools AND the output has parsed cleanly into
  // a Booking-shaped object, render the rich BookingCard with Confirm/Cancel
  // buttons instead of the generic accordion.
  const booking = BOOKING_TOOL_NAMES.has(toolCall.name)
    ? tryParseBooking(toolCall.output)
    : null;
  if (booking) return <BookingCard initialBooking={booking} />;

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        '&:before': { display: 'none' },
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          minHeight: 36,
          '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center' },
        }}
      >
        {/* The following line displays the tool name and truncated arguments. E.g., get_weather({"city":"Athens"}) */}
        <BuildIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {toolCall.name}({truncate(toolCall.args, 60)})
        </Typography>
        {/* The following line displays a loading indicator if the tool call is still pending (no output yet). */}
        {toolCall.output === undefined && (
          <CircularProgress size={14} sx={{ ml: 1 }} />
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          args
        </Typography>
        <Box
          component="pre"
          sx={{
            fontSize: 12,
            m: 0,
            mb: 1,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {toolCall.args}
        </Box>
        <Typography variant="caption" color="text.secondary" display="block">
          output
        </Typography>
        <Box
          component="pre"
          sx={{
            fontSize: 12,
            m: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          {toolCall.output ?? '(pending)'}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
