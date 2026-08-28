/**
 * Every colour the application draws, in one place.
 *
 * Two consumers read these: the stylesheet, through the CSS variables emitted
 * by `cssVariableBlock()`, and Ant Design, through `antdThemeTokens()`. Both
 * halves have to move together — Ant's dark algorithm recolours its own
 * components while our variables recolour everything else, and one without the
 * other is a half-converted screen.
 *
 * A colour written as a literal anywhere else is a second source of truth for
 * something defined here, and the two drift on the first change nobody
 * remembers to make twice.
 *
 * The semantic set follows accounting convention and is not PC49's to invent:
 * money in reads green, money out reads red, something needing a decision reads
 * amber. The interface accent is therefore teal — it has to be a colour none of
 * those three could be mistaken for.
 */

export type ResolvedTheme = 'light' | 'dark'

type Palette = {
  /** Figures. Direction is carried by colour and by sign, never by colour alone. */
  money: { positive: string; negative: string; zero: string }
  /** What an action or a state means. */
  intent: { primary: string; primarySolid: string; success: string; warning: string; danger: string }
  text: { heading: string; body: string; secondary: string; faint: string; onDark: string }
  surface: { page: string; card: string; muted: string; subtle: string; sider: string; siderActive: string }
  border: { default: string; subtle: string; strong: string }
  /** The dark navigation column, which keeps its own scale in both themes. */
  chrome: { text: string; menuItem: string; menuHover: string; textMuted: string; border: string }
  accent: { wash: string; tint: string; ring: string; strong: string; onDark: string }
}

const LIGHT: Palette = {
  money: { positive: '#15803d', negative: '#b91c1c', zero: '#475569' },
  intent: {
    primary: '#0f766e', primarySolid: '#0f766e',
    success: '#15803d', warning: '#b45309', danger: '#b91c1c',
  },
  text: {
    heading: '#0f172a', body: '#0f172a', secondary: '#475569',
    faint: '#64748b', onDark: '#ffffff',
  },
  surface: {
    page: '#f6f7f9', card: '#ffffff', muted: '#f1f5f9', subtle: '#f8fafc',
    sider: '#0f172a', siderActive: '#134e4a',
  },
  border: { default: '#e2e8f0', subtle: '#f1f5f9', strong: '#cbd5e1' },
  chrome: {
    text: '#f8fafc', menuItem: '#e2e8f0', menuHover: '#1e293b',
    textMuted: '#94a3b8', border: '#1e293b',
  },
  accent: {
    wash: '#f0fdfa', tint: '#ecfdf9', ring: '#5eead4',
    strong: '#115e59', onDark: '#5eead4',
  },
}

const DARK: Palette = {
  money: { positive: '#4ade80', negative: '#f87171', zero: '#94a3b8' },
  intent: {
    primary: '#2dd4bf', primarySolid: '#0f766e',
    success: '#4ade80', warning: '#fbbf24', danger: '#f87171',
  },
  text: {
    heading: '#f1f5f9', body: '#e2e8f0', secondary: '#94a3b8',
    faint: '#94a3b8', onDark: '#ffffff',
  },
  surface: {
    page: '#0b1220', card: '#131c2e', muted: '#1b2740', subtle: '#1b2740',
    sider: '#0b1220', siderActive: '#134e4a',
  },
  border: { default: '#243044', subtle: '#1b2740', strong: '#334155' },
  chrome: {
    text: '#f8fafc', menuItem: '#cbd5e1', menuHover: '#1e293b',
    textMuted: '#94a3b8', border: '#1e293b',
  },
  accent: {
    wash: '#12312f', tint: '#0f2b29', ring: '#2dd4bf',
    strong: '#5eead4', onDark: '#5eead4',
  },
}

export const palettes: Record<ResolvedTheme, Palette> = { light: LIGHT, dark: DARK }

/** Flattens a palette into `--pc-group-name` pairs. */
function variables(palette: Palette): [string, string][] {
  const out: [string, string][] = []
  for (const [group, entries] of Object.entries(palette)) {
    for (const [name, value] of Object.entries(entries as Record<string, string>)) {
      out.push([`--pc-${group}-${name}`, value])
    }
  }
  return out
}

/**
 * The variable block the stylesheet carries.
 *
 * A unit test asserts the stylesheet still matches this exactly, so changing a
 * colour means changing the token above and copying the block over — rather
 * than editing the CSS and leaving Ant Design on the old value.
 */
export function cssVariableBlock(): string {
  const block = (selector: string, palette: Palette) =>
    `${selector} {\n${variables(palette).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`
  return `${block(':root', LIGHT)}\n\n${block(':root[data-theme="dark"]', DARK)}`
}

/**
 * Ant Design's own tokens, so its components and our stylesheet agree.
 *
 * Only the colours Ant needs to be told about: the rest it derives, and
 * overriding what it derives well is how a theme ends up inconsistent with
 * itself.
 */
export function antdThemeTokens(theme: ResolvedTheme) {
  const p = palettes[theme]
  return {
    token: {
      colorPrimary: p.intent.primarySolid,
      colorSuccess: p.intent.success,
      colorWarning: p.intent.warning,
      colorError: p.intent.danger,
      colorInfo: p.intent.primarySolid,
      colorText: p.text.body,
      colorTextHeading: p.text.heading,
      colorTextSecondary: p.text.secondary,
      colorBgLayout: p.surface.page,
      colorBgContainer: p.surface.card,
      colorBorder: p.border.default,
      colorBorderSecondary: p.border.subtle,
    },
    components: {
      Layout: {
        headerBg: p.surface.card,
        siderBg: p.surface.sider,
        bodyBg: p.surface.page,
        triggerBg: p.surface.sider,
      },
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        darkItemColor: p.chrome.menuItem,
        darkItemHoverBg: p.chrome.menuHover,
        darkItemSelectedBg: p.surface.siderActive,
        darkItemSelectedColor: p.accent.onDark,
        darkPopupBg: p.surface.sider,
      },
      Table: {
        headerBg: p.surface.muted,
        headerColor: p.text.secondary,
        rowHoverBg: p.surface.subtle,
        borderColor: p.border.subtle,
      },
      Card: { borderRadiusLG: 12 },
    },
  }
}
