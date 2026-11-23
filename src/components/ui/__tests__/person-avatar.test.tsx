import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PersonAvatar, personAvatarSrc, personInitials } from "../person-avatar";
import { renderKit } from "./kit";

/** Made-up people: ids of the contract's form, fictional names, a picture's version or none. */
const ADA = { id: "pbc7fe62842ca", name: "Ada Brooks", avatar: null };
const GRACE = { id: "p65b14f7daa03", name: "Grace Lindqvist", avatar: "0a1b2c3d4e5f" };

const avatarOf = (container: HTMLElement) => container.querySelector<HTMLElement>(".jo-avatar")!;

describe("PersonAvatar", () => {
  it("shows the person's picture from this dashboard's own route, versioned, round and of a set size", () => {
    const { container } = renderKit(<PersonAvatar person={GRACE} />);
    const avatar = avatarOf(container);
    const picture = avatar.querySelector("img")!;
    expect(picture).toHaveAttribute("src", "/api/oversight/people/p65b14f7daa03/avatar?v=0a1b2c3d4e5f");
    // Width and height set, so nothing shifts while it loads.
    expect(picture).toHaveAttribute("width", "20");
    expect(picture).toHaveAttribute("height", "20");
    expect(avatar).toHaveClass("jo-avatar", "size-5");
    expect(avatar).toHaveAttribute("data-avatar", "picture");
    expect(avatar).not.toHaveAttribute("data-initials");
  });

  it("is decorative: hidden from screen readers, with an empty alt and no text of its own", () => {
    const { container } = renderKit(<PersonAvatar person={GRACE} />);
    const avatar = avatarOf(container);
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.textContent).toBe("");
  });

  it("draws the initials when the service holds no picture, from data-initials so they stay out of the text", () => {
    const { container } = renderKit(<PersonAvatar person={ADA} />);
    const avatar = avatarOf(container);
    expect(avatar).toHaveAttribute("data-avatar", "initials");
    expect(avatar).toHaveAttribute("data-initials", "AB");
    expect(avatar.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("falls back to the initials when the picture fails to load, and tries a new version afresh", () => {
    const { container, rerender } = renderKit(<PersonAvatar person={GRACE} />);
    fireEvent.error(avatarOf(container).querySelector("img")!);
    expect(avatarOf(container)).toHaveAttribute("data-avatar", "initials");
    expect(avatarOf(container)).toHaveAttribute("data-initials", "GL");
    expect(avatarOf(container).querySelector("img")).toBeNull();

    rerender(<PersonAvatar person={{ ...GRACE, avatar: "ffffffffffff" }} />);
    expect(avatarOf(container).querySelector("img")).toHaveAttribute("src", "/api/oversight/people/p65b14f7daa03/avatar?v=ffffffffffff");
  });

  it("falls back as well for a picture that had already failed before it was watched", () => {
    // As a picture rendered on the server and broken before the page came alive: complete, with no pixels.
    const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    try {
      const { container } = renderKit(<PersonAvatar person={GRACE} />);
      expect(avatarOf(container)).toHaveAttribute("data-avatar", "initials");
    } finally {
      if (complete) Object.defineProperty(HTMLImageElement.prototype, "complete", complete);
    }
  });

  it("reads ? for an Unnamed account", () => {
    const { container } = renderKit(<PersonAvatar person={{ id: "p0123456789ab", name: "Unnamed account", avatar: null }} />);
    expect(avatarOf(container)).toHaveAttribute("data-initials", "?");
  });

  it("draws nobody (the unassigned tickets) as a generic figure, so the names in a list stay in line", () => {
    const { container } = renderKit(<PersonAvatar person={null} />);
    const avatar = avatarOf(container);
    expect(avatar).toHaveAttribute("data-avatar", "none");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).not.toHaveAttribute("data-initials");
    expect(avatar.querySelector("svg")).not.toBeNull();
    expect(avatar.querySelector("img")).toBeNull();
  });

  it("comes in the sizes DESIGN.md sets: 20 px by default, 24 px for Ask's @ list", () => {
    const { container } = renderKit(<PersonAvatar person={GRACE} size={24} />);
    expect(avatarOf(container)).toHaveClass("size-6");
    expect(avatarOf(container)).toHaveAttribute("data-size", "24");
    expect(avatarOf(container).querySelector("img")).toHaveAttribute("width", "24");
  });
});

describe("personInitials", () => {
  it("takes the first letters of the first and last words, as Jira does", () => {
    expect(personInitials("Ada Brooks")).toBe("AB");
    expect(personInitials("Grace Lindqvist")).toBe("GL");
    expect(personInitials("Anne-Marie de la Cruz")).toBe("AC");
    expect(personInitials("Cher")).toBe("C");
    expect(personInitials("  dev   malhotra ")).toBe("DM");
  });

  it("reads letters of any script whole, accents included, and skips words without one", () => {
    expect(personInitials("Élodie Ørsted")).toBe("ÉØ");
    // "E" and a combining acute accent: one letter, as it reads.
    expect(personInitials("Émile Zola")).toBe("ÉZ");
    expect(personInitials("Alexandra Papadopoulou-Richardson (Contractor)")).toBe("AC");
    expect(personInitials("Hana Mori -")).toBe("HM");
    expect(personInitials("王小明")).toBe("王");
  });

  it("is ? for an Unnamed account, and for a name with no letter in it", () => {
    expect(personInitials("Unnamed account")).toBe("?");
    expect(personInitials("🚀 —")).toBe("?");
  });
});

describe("personAvatarSrc", () => {
  it("is this dashboard's route by person id and version, or null without a picture", () => {
    expect(personAvatarSrc(GRACE)).toBe("/api/oversight/people/p65b14f7daa03/avatar?v=0a1b2c3d4e5f");
    expect(personAvatarSrc(ADA)).toBeNull();
  });
});
