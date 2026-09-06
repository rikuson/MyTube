import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";

const theme = createTheme({
  palette: {
    primary: { main: "#ff0033", light: "#ff5a78", dark: "#c90028" },
    background: { default: "#ffffff", paper: "#ffffff" },
    text: { primary: "#0f0f0f", secondary: "#606060" },
    divider: "#e5e5e5",
  },
  typography: { fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif', button: { textTransform: "none", fontWeight: 600 } },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { borderRadius: 10, paddingInline: 20 } } },
    MuiTab: { styleOverrides: { root: { minHeight: 48, textTransform: "none", fontWeight: 650 } } },
    MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: 3 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 7 } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: "#ffffff", borderRadius: 18 } } },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider>
  </React.StrictMode>,
);
