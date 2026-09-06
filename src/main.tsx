import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

const theme = createTheme({
  palette: {
    primary: { main: "#5457d6", light: "#9295eb", dark: "#3e40a9" },
    background: { default: "#f7f8fc", paper: "#ffffff" },
    text: { primary: "#202438", secondary: "#697087" },
    divider: "#e4e7f0",
  },
  typography: { fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif', button: { textTransform: "none", fontWeight: 650 } },
  shape: { borderRadius: 14 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 10, paddingInline: 20 } } },
    MuiTab: { styleOverrides: { root: { minHeight: 48, textTransform: "none", fontWeight: 650 } } },
    MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: 3 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 7 } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: "#fbfcff" } } },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider>
  </React.StrictMode>,
);
