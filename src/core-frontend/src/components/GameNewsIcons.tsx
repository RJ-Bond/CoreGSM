/**
 * The icons of «Игровой плагин»: one set, drawn on the same 24 x 24 stroke frame as the rest of the panel (currentColor, so a theme,
 * an accent and a status colour all reach them). The journal and the tabs use these instead of emoji.
 */
import type { ComponentType, ReactNode } from 'react';
import { Icon, type IconProps } from '../icons';
import type { Kind } from '../pages/journalLogic';

const make = (d: ReactNode) => ({ size = 18, className }: IconProps) => <Icon size={size} className={className}>{d}</Icon>;

export const IconSend = make(<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />);
export const IconAuto = make(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M12 8v4l2.5 1.5" /></>);
export const IconSliders = make(<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />);
export const IconPeople = make(<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />);
export const IconShield = make(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
export const IconList = make(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />);
export const IconRestart = make(<path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />);
export const IconSparkle = make(<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />);
export const IconPlug = make(<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5" />);
export const IconKey = make(<path d="M21 2l-2 2M11.4 11.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM11.4 11.6 15.5 7.5m0 0 3 3L22 7l-3-3-3.5 3.5z" />);
export const IconTag = make(<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01" />);
export const IconClock = make(<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2" />);
export const IconChat = make(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />);
export const IconLink = make(<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />);
export const IconDoor = make(<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />);
export const IconSignal = make(<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 20V4" />);
export const IconGamepad = make(<path d="M6 12h4M8 10v4M15 13h.01M18 11h.01M17.3 5H6.7a4 4 0 0 0-3.9 3.2L2 15a3 3 0 0 0 5.2 2.2L9 15h6l1.8 2.2A3 3 0 0 0 22 15l-.8-6.8A4 4 0 0 0 17.3 5z" />);
export const IconSnow = make(<path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7M9 4l3 2 3-2M9 20l3-2 3 2" />);
export const IconDisk = make(<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8" />);
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconAlert = make(<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />);
export const IconBox = make(<path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3.3 7L12 12l8.7-5M12 22V12" />);
export const IconUser = make(<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />);
export const IconBell = make(<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />);
export const IconPlay = make(<path d="M6 3l14 9-14 9V3z" />);
export const IconDownload = make(<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />);
export const IconTerminal = make(<path d="M4 17l6-6-6-6M12 19h8" />);


/** the icon of a kind of journal entry, and of a note of the plugin (by its kind) */
export const KIND_ICON: Record<Kind, ComponentType<IconProps>> = {
  message: IconSend, auto: IconAuto, discord: IconChat, restart: IconRestart, link: IconLink, mod: IconShield, plugin: IconBox, conn: IconSignal,
};
export const PLUGIN_NOTE_ICON: Record<string, ComponentType<IconProps>> = {
  mass: IconDoor, ping: IconSignal, steam: IconGamepad, freeze: IconSnow, save: IconDisk, other: IconBox,
};

/** the icon of a tab of the plugin page */
export const TAB_ICON: Record<string, ComponentType<IconProps>> = {
  send: IconSend, auto: IconAuto, general: IconSliders, players: IconPeople, mod: IconShield, journal: IconList,
};
