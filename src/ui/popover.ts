/**
 * Small panels and menus that open from a button (file menu, specimen details,
 * display settings). One is open at a time; a press outside it or Esc closes it.
 */
export class Popovers {
  private current: { panel: HTMLElement; button: HTMLElement } | null = null;

  constructor() {
    document.addEventListener(
      'pointerdown',
      (e) => {
        const c = this.current;
        const target = e.target as Node | null;
        if (c && target && !c.panel.contains(target) && !c.button.contains(target)) this.close();
      },
      true,
    );
  }

  get open(): HTMLElement | null {
    return this.current?.panel ?? null;
  }

  toggle(button: HTMLElement, panel: HTMLElement): void {
    if (this.current?.panel === panel) {
      this.close();
      return;
    }
    this.close();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    this.current = { panel, button };
  }

  /** True if something was open. */
  close(): boolean {
    const c = this.current;
    if (!c) return false;
    this.current = null;
    c.panel.hidden = true;
    c.button.setAttribute('aria-expanded', 'false');
    if (c.panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    return true;
  }
}
