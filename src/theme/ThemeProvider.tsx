import React, { createContext, useContext, useMemo, useState } from 'react';

export type ThemeName = 'light' | 'dark';

export type Theme = {
  name: ThemeName;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    inputBackground: string;
    text: string;
    muted: string;
    primary: string;
    secondary: string;
    dangerBackground: string;
    dangerText: string;
    border: string;
    buttonText: string;
    chipBackground: string;
    chipText: string;
    orbOne: string;
    orbTwo: string;
    orbThree: string;
  };
  statusBarStyle: 'light' | 'dark';
};

const light: Theme = {
  name: 'light',
  colors: {
    background: '#f2f5ff',
    surface: '#ffffff',
    surfaceElevated: '#f9fbff',
    inputBackground: '#fdfefe',
    text: '#1b2438',
    muted: '#667089',
    primary: '#0f7bff',
    secondary: '#ff6f3c',
    dangerBackground: '#ffe6df',
    dangerText: '#9c2f1f',
    border: '#d6deef',
    buttonText: '#ffffff',
    chipBackground: '#e9f0ff',
    chipText: '#1f3f79',
    orbOne: 'rgba(39, 128, 255, 0.22)',
    orbTwo: 'rgba(255, 116, 67, 0.18)',
    orbThree: 'rgba(91, 198, 255, 0.22)',
  },
  statusBarStyle: 'dark',
};

const dark: Theme = {
  name: 'dark',
  colors: {
    background: '#070b16',
    surface: '#101728',
    surfaceElevated: '#111d33',
    inputBackground: '#0c1425',
    text: '#eaf0ff',
    muted: '#9eaac7',
    primary: '#2f8bff',
    secondary: '#ff8e53',
    dangerBackground: '#3d1d21',
    dangerText: '#ffb3ba',
    border: '#243049',
    buttonText: '#ffffff',
    chipBackground: '#14233e',
    chipText: '#cae0ff',
    orbOne: 'rgba(36, 120, 255, 0.26)',
    orbTwo: 'rgba(255, 125, 71, 0.22)',
    orbThree: 'rgba(106, 227, 255, 0.2)',
  },
  statusBarStyle: 'light',
};

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [name, setName] = useState<ThemeName>('light');

  const value = useMemo(() => {
    const theme = name === 'dark' ? dark : light;
    return {
      theme,
      toggleTheme: () => setName((n) => (n === 'dark' ? 'light' : 'dark')),
      isDark: name === 'dark',
    };
  }, [name]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const c = useContext(ThemeContext);
  if (!c) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return c;
};

export default ThemeProvider;
