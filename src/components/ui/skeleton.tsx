import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SkeletonProps {
  /** Size and shape with utilities: "h-3 w-24", "h-7 w-16", "size-8 rounded-full". */
  className?: string;
  style?: CSSProperties;
  /** Same shape without the shimmer: a layout waiting to be built, not loading. */
  still?: boolean;
}

/** A placeholder in the final shape of what it stands for, so nothing moves when the content arrives. */
export function Skeleton({ className, style, still = false }: SkeletonProps) {
  return <span aria-hidden className={cn("skeleton block", still && "skeleton-still", className)} style={style} />;
}

/** Lines of text with a ragged last line. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </span>
  );
}

/** A region that is loading. */
export function SkeletonGroup({
  label,
  children,
  className,
}: {
  /** What is loading, in words. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
