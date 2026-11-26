/** The browser's offer to install the panel as an app: main.tsx keeps it, the «Установить приложение» button uses it. */

export interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let kept: InstallPrompt | undefined;
export const keepInstallPrompt = (e: Event | undefined): void => { kept = e as InstallPrompt | undefined; };
export const installPrompt = (): InstallPrompt | undefined => kept;
