"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { PeopleLevelProvider } from "./people-level";
import { railCookie, type Platform } from "./rail-state";

interface ShellState {
  platform: Platform;
  railCollapsed: boolean;
  setRailCollapsed: (collapsed: boolean) => void;
  toggleRail: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({
  initialRailCollapsed,
  platform,
  peopleLevel = false,
  children,
}: {
  initialRailCollapsed: boolean;
  platform: Platform;
  /** The server's decision for this reader: people level (an admin, or sign-in off) is offered the People page. */
  peopleLevel?: boolean;
  children: ReactNode;
}) {
  const [railCollapsed, setRailCollapsedState] = useState(initialRailCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const setRailCollapsed = useCallback((collapsed: boolean) => {
    setRailCollapsedState(collapsed);
    document.cookie = railCookie(collapsed);
  }, []);

  const toggleRail = useCallback(
    () => setRailCollapsed(!railCollapsed),
    [railCollapsed, setRailCollapsed],
  );

  const value = useMemo<ShellState>(
    () => ({
      platform,
      railCollapsed,
      setRailCollapsed,
      toggleRail,
      paletteOpen,
      setPaletteOpen,
      shortcutsOpen,
      setShortcutsOpen,
      mobileNavOpen,
      setMobileNavOpen,
    }),
    [platform, railCollapsed, setRailCollapsed, toggleRail, paletteOpen, shortcutsOpen, mobileNavOpen],
  );

  return (
    <ShellContext.Provider value={value}>
      <PeopleLevelProvider peopleLevel={peopleLevel}>{children}</PeopleLevelProvider>
    </ShellContext.Provider>
  );
}

export function useShell(): ShellState {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside ShellProvider");
  return context;
}
