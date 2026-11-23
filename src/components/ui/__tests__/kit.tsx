import { render, type RenderOptions } from "@testing-library/react";
import { Tooltip } from "radix-ui";
import type { ReactElement, ReactNode } from "react";

import { ShellProvider } from "@/components/shell/shell-context";

/*
 * Test helpers for the kit. jsdom does no layout, so it lacks the few
 * browser APIs the components lean on (they are present in every browser
 * the product supports); and kit components expect the providers the app
 * shell gives them: the platform for key caps, and Radix's tooltip provider.
 */

class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function installDomShims(): void {
  if (!("ResizeObserver" in globalThis)) {
    Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverShim, configurable: true });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
  }
}

function KitProviders({ children }: { children: ReactNode }) {
  return (
    <ShellProvider initialRailCollapsed={false} platform="other">
      <Tooltip.Provider delayDuration={0}>{children}</Tooltip.Provider>
    </ShellProvider>
  );
}

/** Render a kit component inside the providers the app shell gives it. */
export function renderKit(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  installDomShims();
  return render(ui, { wrapper: KitProviders, ...options });
}
