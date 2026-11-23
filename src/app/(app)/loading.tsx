import { PageBody } from "@/components/shell/page";

/**
 * Shown while a page is prepared. It fades in only after a short delay, so a
 * fast navigation never flashes a skeleton; when it does appear it has the
 * shape of a page (header, figures, a section) so nothing jumps when the real
 * one arrives.
 */
export default function Loading() {
  return (
    <div role="status" className="reveal-late">
      <span className="sr-only">Loading the page</span>
      <div aria-hidden className="sheet">
        <div className="flex flex-col gap-3 border-b border-rule-weak px-5 pt-6 pb-5 md:px-[var(--sheet-pad)] md:pt-7 md:pb-6">
          <span className="skeleton h-6 w-44" />
          <span className="skeleton h-3.5 w-full max-w-[520px]" />
        </div>
        <PageBody className="flex flex-col gap-9">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule-weak bg-rule-weak lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex flex-col gap-2.5 bg-sheet p-4">
                <span className="skeleton h-2.5 w-24" />
                <span className="skeleton h-7 w-16" />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <span className="skeleton h-2.5 w-28" />
            <span className="skeleton h-40 w-full" />
          </div>
        </PageBody>
      </div>
    </div>
  );
}
