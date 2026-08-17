/**
 * Editor chrome colours.
 *
 * Token colours come from Shiki's `dark-plus` / `light-plus` themes, which are VS Code's own
 * defaults — the figures therefore show the same syntax colours a reader gets after installing
 * the extension. The values below are the surrounding UI (tab bar, gutter, sidebar, hover card),
 * taken from the same two themes so the whole frame matches.
 */

export type ThemeName = 'dark-plus' | 'light-plus';

export interface Palette {
    /** Shiki theme whose token colours pair with this chrome. */
    theme: ThemeName;
    /** File suffix for figures rendered with this palette. */
    suffix: 'dark' | 'light';
    editorBg: string;
    chromeBg: string;
    activeTabBg: string;
    border: string;
    /** Border drawn around the whole figure, so it reads as a window on any page background. */
    frame: string;
    text: string;
    dimText: string;
    lineNumber: string;
    activeLineNumber: string;
    accent: string;
    /** Hover / preview surface. */
    cardBg: string;
    cardBorder: string;
    inlayBg: string;
    inlayText: string;
    codeLens: string;
    error: string;
    warning: string;
    added: string;
    badgeBg: string;
    badgeText: string;
    selectionBg: string;
}

export const DARK: Palette = {
    theme: 'dark-plus',
    suffix: 'dark',
    editorBg: '#1F1F1F',
    chromeBg: '#181818',
    activeTabBg: '#1F1F1F',
    border: '#2B2B2B',
    frame: '#3C3C3C',
    text: '#CCCCCC',
    dimText: '#9D9D9D',
    lineNumber: '#6E7681',
    activeLineNumber: '#CCCCCC',
    accent: '#0078D4',
    cardBg: '#202020',
    cardBorder: '#454545',
    inlayBg: '#3A3D41',
    inlayText: '#A0A0A0',
    codeLens: '#8C8C8C',
    error: '#F14C4C',
    warning: '#CCA700',
    added: '#4EC9B0',
    badgeBg: '#0078D4',
    badgeText: '#FFFFFF',
    selectionBg: '#264F78',
};

export const LIGHT: Palette = {
    theme: 'light-plus',
    suffix: 'light',
    editorBg: '#FFFFFF',
    chromeBg: '#F8F8F8',
    activeTabBg: '#FFFFFF',
    border: '#E5E5E5',
    frame: '#D0D7DE',
    text: '#3B3B3B',
    dimText: '#616161',
    lineNumber: '#8A8A8A',
    activeLineNumber: '#3B3B3B',
    accent: '#005FB8',
    cardBg: '#F8F8F8',
    cardBorder: '#CECECE',
    inlayBg: '#E4E6E8',
    inlayText: '#7A7A7A',
    codeLens: '#919191',
    error: '#E51400',
    warning: '#BF8803',
    added: '#0F7B6C',
    badgeBg: '#005FB8',
    badgeText: '#FFFFFF',
    selectionBg: '#ADD6FF',
};

export const PALETTES: Palette[] = [DARK, LIGHT];
