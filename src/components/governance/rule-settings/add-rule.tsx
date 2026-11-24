"use client";

import { Plus } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface AddRule {
  /** Opens the sheet for a new rule, the focus to come back to `from` when it closes. */
  open: (from: HTMLElement | null) => void;
  /** Why no rule can be added now, in a few words (the board's limit); null when one can. */
  blocked: string | null;
}

interface AddRuleState {
  target: AddRule | null;
  setTarget: (target: AddRule | null) => void;
}

const AddRuleContext = createContext<AddRuleState | null>(null);

/** Holds what the header's button and the settings view say to each other. */
export function AddRuleProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<AddRule | null>(null);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return <AddRuleContext.Provider value={value}>{children}</AddRuleContext.Provider>;
}

export function useAddRuleTarget(open: ((from: HTMLElement | null) => void) | null, blocked: string | null): void {
  const setTarget = useContext(AddRuleContext)?.setTarget;
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  const ready = open !== null;
  useEffect(() => {
    if (!setTarget) return;
    setTarget(ready ? { open: (from) => latest.current?.(from), blocked } : null);
    return () => setTarget(null);
  }, [setTarget, ready, blocked]);
}

export function AddRuleButton() {
  const target = useContext(AddRuleContext)?.target ?? null;
  if (target?.blocked) {
    return (
      <Tooltip content={target.blocked}>
        <Button icon={Plus} aria-disabled data-add-rule="">
          Add rule
        </Button>
      </Tooltip>
    );
  }
  return (
    <Button
      icon={Plus}
      disabled={target === null}
      data-add-rule=""
      onClick={(event) => target?.open(event.currentTarget)}
    >
      Add rule
    </Button>
  );
}
