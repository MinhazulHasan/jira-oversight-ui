import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Page not found" };

/** Every address that matches no page lands here (see ../layout.tsx). */
export default function MissingPage(): never {
  notFound();
}
