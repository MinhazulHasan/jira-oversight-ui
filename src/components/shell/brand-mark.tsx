/** The product mark (see src/app/icon.svg for the reasoning). */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="7.5" fill="var(--cite)" />
      <g
        fill="none"
        stroke="var(--cite-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.6 14.2V10.2a1.6 1.6 0 0 1 1.6-1.6h4" />
        <path d="M23.4 17.8v4a1.6 1.6 0 0 1-1.6 1.6h-4" />
      </g>
      <rect x="12.9" y="12.9" width="6.2" height="6.2" rx="1.3" fill="var(--cite-ink)" />
    </svg>
  );
}
