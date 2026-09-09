import { useState, type ReactNode } from "react";
import { Box, Collapse, ListItemButton, Typography } from "@mui/material";
import { ExpandLessRounded, ExpandMoreRounded } from "@mui/icons-material";

export function SidebarSection({ title, children, defaultOpen = true, onOpen }: { title: string; children: ReactNode; defaultOpen?: boolean; onOpen?: () => void }) {
  const [open, setOpen] = useState(defaultOpen);
  return <Box>
    <ListItemButton onClick={() => { if (!open) onOpen?.(); setOpen(value => !value); }} aria-expanded={open} sx={{ borderRadius: 1, px: 1, py: 1 }}>
      <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>{title}</Typography>
      {open ? <ExpandLessRounded fontSize="small" /> : <ExpandMoreRounded fontSize="small" />}
    </ListItemButton>
    <Collapse in={open}><Box sx={{ pl: 1 }}>{children}</Box></Collapse>
  </Box>;
}
