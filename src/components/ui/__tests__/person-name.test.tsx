import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PersonName } from "../person-name";
import { renderKit } from "./kit";

describe("PersonName", () => {
  it("shows the display name as text, whole in its tooltip, cut short by the layout", () => {
    renderKit(<PersonName person={{ id: "pbc7fe62842ca", name: "Ada Brooks", avatar: null }} className="text-ink-mid" />);
    const name = screen.getByText("Ada Brooks");
    expect(name).toHaveAttribute("title", "Ada Brooks");
    expect(name).toHaveClass("truncate", "text-ink-mid");
    // Running text, even in a table: proportional figures, so "Anne-Marie" keeps its hyphen tight.
    expect(name).toHaveClass("normal-nums");
  });

  it("puts the person's picture beside the name, never in its place, and never their id", () => {
    const { container } = renderKit(<PersonName person={{ id: "p65b14f7daa03", name: "Grace Lindqvist", avatar: "0a1b2c3d4e5f" }} />);
    const avatar = container.querySelector(".jo-avatar");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar?.querySelector("img")).toHaveAttribute("src", "/api/oversight/people/p65b14f7daa03/avatar?v=0a1b2c3d4e5f");
    // The name is the text, read and copied as it is.
    expect(container.textContent).toBe("Grace Lindqvist");
    expect(avatar?.nextElementSibling).toHaveTextContent("Grace Lindqvist");
  });

  it("puts the initials beside a name the service holds no picture for", () => {
    const { container } = renderKit(<PersonName person={{ id: "pbc7fe62842ca", name: "Ada Brooks", avatar: null }} />);
    expect(container.querySelector(".jo-avatar")).toHaveAttribute("data-initials", "AB");
    expect(container.textContent).toBe("Ada Brooks");
  });

  it("says Unassigned in the secondary ink, whatever ink the caller gives names, beside a generic figure", () => {
    const { container } = renderKit(<PersonName person={null} className="text-ink-mid" />);
    expect(screen.getByText("Unassigned")).toHaveClass("text-ink-low");
    expect(screen.getByText("Unassigned")).not.toHaveClass("text-ink-mid");
    expect(container.querySelector(".jo-avatar")).toHaveAttribute("data-avatar", "none");
  });

  it("can name nobody in other words", () => {
    renderKit(<PersonName person={null} none="No one" />);
    expect(screen.getByText("No one")).toHaveClass("text-ink-low");
  });
});
