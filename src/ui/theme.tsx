import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

export type Theme = {
  dark: boolean; bg: string; card: string; text: string; sub: string; line: string;
  accent: string; onAccent: string; danger: string; barBg: string; sheet: string; page: string; field: string;
};

const light: Theme = { dark: false, bg: '#F3F5F9', card: '#FFFFFF', text: '#10131A', sub: '#5B6472', line: '#E2E6EE', accent: '#1D4ED8', onAccent: '#FFFFFF', danger: '#D92D20', barBg: '#FFFFFF', sheet: '#FFFFFF', page: '#DDE2EA', field: '#7A8394' };
const dark: Theme = { dark: true, bg: '#0E1116', card: '#181C23', text: '#F2F4F8', sub: '#9AA3B2', line: '#2A303B', accent: '#6E9BFF', onAccent: '#0B1020', danger: '#FF6B5E', barBg: '#151920', sheet: '#1B2028', page: '#05070A', field: '#7C8699' };

const Ctx = createContext<Theme>(light);
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const scheme = useColorScheme();
  return <Ctx.Provider value={scheme === 'dark' ? dark : light}>{children}</Ctx.Provider>;
};
export const useTheme = () => useContext(Ctx);

/** Minimaal tikdoel (Apple/Google: 44-48 pt). */
export const TAP = 48;
