import { describe, expect, it } from "vitest";

import { ASK_MAX_LENGTH, ASK_MAX_MENTIONS, type DirectoryEntry, type Person } from "@/lib/api/schemas";
import { findNames, foldText } from "@/lib/names";

import {
  groupMatching,
  insertMention,
  isIntact,
  mentionedPeople,
  mentionQueryAt,
  mentionsIn,
  nameMatches,
  peopleMatching,
  rebaseMentions,
  type Mention,
} from "../mentions";

/** The sample's fictional people, as GET /people names them (ids made up here). */
const ADA: Person = { id: "pbc7fe62842ca", name: "Ada Brooks", avatar: null };
const CARMEN: Person = { id: "p599114b761a6", name: "Carmen Ruiz", avatar: "55ea1804e5bd" };
const ELIF: Person = { id: "p15311a7e00f9", name: "Elif Aydin", avatar: null };
const GRACE: Person = { id: "p65b14f7daa03", name: "Grace Lindqvist", avatar: "37d44fa82021" };
const PEOPLE = [GRACE, ELIF, CARMEN, ADA];

/** "@Name" written into `text` at `start`, as choosing someone does. */
const mentionAt = (person: Person, start: number): Mention => ({ person, start, end: start + person.name.length + 1 });

describe("where a typed @ starts a search", () => {
  it("at the start, after a space, or after an opening bracket or quote, up to the caret", () => {
    expect(mentionQueryAt("@ca", 3)).toEqual({ start: 0, end: 3, query: "ca" });
    expect(mentionQueryAt("What is @car", 12)).toEqual({ start: 8, end: 12, query: "car" });
    expect(mentionQueryAt("(@ada", 5)?.query).toBe("ada");
    expect(mentionQueryAt("“@ada", 5)?.query).toBe("ada");
    expect(mentionQueryAt("ask @", 5)).toEqual({ start: 4, end: 5, query: "" });
    // Words with spaces, as names have them.
    expect(mentionQueryAt("@ada b", 6)?.query).toBe("ada b");
  });

  it("never inside an address, after a space, across lines, past four words, or at an @ that is already a mention", () => {
    expect(mentionQueryAt("mail ada@example", 16)).toBeNull();
    expect(mentionQueryAt("@ ada", 5)).toBeNull();
    expect(mentionQueryAt("@ada\nb", 6)).toBeNull();
    expect(mentionQueryAt("@one two three four five", 24)).toBeNull();
    expect(mentionQueryAt("@a@b", 4)).toBeNull();
    expect(mentionQueryAt("no at sign", 10)).toBeNull();
    expect(mentionQueryAt("@Ada Brooks ", 12, [mentionAt(ADA, 0)])).toBeNull();
  });
});

describe("who a search finds", () => {
  it("anyone a word of whose name starts with what is typed, case and accents aside", () => {
    expect(nameMatches("Carmen Ruiz", "car")).toBe(true);
    expect(nameMatches("Carmen Ruiz", "RUIZ")).toBe(true);
    expect(nameMatches("Carmen Ruiz", "car ru")).toBe(true);
    expect(nameMatches("Élif Aydın", "elif aydin")).toBe(true);
    expect(nameMatches("Elif Aydin", "Él")).toBe(true);
    expect(nameMatches("Anne-Marie O'Neil", "marie")).toBe(true);
    expect(nameMatches("Anne-Marie O'Neil", "oneil")).toBe(true);
    expect(nameMatches("Carmen Ruiz", "")).toBe(true);
  });

  it("not on letters inside a word, nor on words out of order", () => {
    expect(nameMatches("Carmen Ruiz", "men")).toBe(false);
    expect(nameMatches("Carmen Ruiz", "ruiz car")).toBe(false);
    expect(nameMatches("Carmen Ruiz", "cx")).toBe(false);
  });

  it("first-name matches first, then by name, as every list of people is ordered", () => {
    expect(peopleMatching(PEOPLE, "").map((person) => person.name)).toEqual(["Ada Brooks", "Carmen Ruiz", "Elif Aydin", "Grace Lindqvist"]);
    // "a" starts Ada's first name and Elif's last: Ada comes first.
    expect(peopleMatching(PEOPLE, "a").map((person) => person.name)).toEqual(["Ada Brooks", "Elif Aydin"]);
    expect(peopleMatching(PEOPLE, "lind").map((person) => person.name)).toEqual(["Grace Lindqvist"]);
    expect(peopleMatching(PEOPLE, "zz")).toEqual([]);
  });
});

describe("the @ list's groups", () => {
  /** Members of the board who hold none of its tickets, as GET /people/directory lists them with 0 tickets. */
  const NOOR: Person = { id: "pc3d7609d78d1", name: "Noor Haddad", avatar: null };
  const TOMAS: Person = { id: "p612c407b515f", name: "Tomás Ferreira", avatar: null };
  const DIRECTORY = [
    { person: ADA, tickets: 12 },
    { person: CARMEN, tickets: 30 },
    { person: ELIF, tickets: 1 },
    { person: NOOR, tickets: 0 },
    { person: TOMAS, tickets: 0 },
  ];
  const shape = (query: string) => groupMatching(DIRECTORY, query).map((group) => [group.label, group.people.map((person) => person.name)]);

  it("are those with tickets, then the members with none, each ordered as a search orders people", () => {
    expect(shape("")).toEqual([
      ["With tickets", ["Ada Brooks", "Carmen Ruiz", "Elif Aydin"]],
      ["No tickets", ["Noor Haddad", "Tomás Ferreira"]],
    ]);
    expect(groupMatching(DIRECTORY, "").map((group) => group.key)).toEqual(["tickets", "none"]);
    // First-name matches first within a group, as everywhere: "a" finds Ada before Elif Aydin.
    expect(shape("a")).toEqual([["With tickets", ["Ada Brooks", "Elif Aydin"]]]);
  });

  it("are filtered as one list, accents aside, and a group the search empties is left out", () => {
    expect(shape("tom")).toEqual([["No tickets", ["Tomás Ferreira"]]]);
    expect(shape("fé")).toEqual([["No tickets", ["Tomás Ferreira"]]]);
    expect(shape("ruiz")).toEqual([["With tickets", ["Carmen Ruiz"]]]);
    expect(shape("zz")).toEqual([]);
    expect(groupMatching([], "")).toEqual([]);
  });

  it("keep the directory's folded order, so a name starting with an accented letter sorts with its letter, not after Z", () => {
    const entry = (name: string, id: string, tickets = 1): DirectoryEntry => ({ person: { id, name, avatar: null }, tickets });
    const directory = [
      entry("Zoe Adams", "p000000000005"),
      entry("Élodie Martin", "p000000000002"),
      entry("Ólöf Jónsdóttir", "p000000000003"),
      entry("Ben Okafor", "p000000000001"),
      entry("Øyvind Berg", "p000000000004"),
      entry("Oscar Berg", "p000000000007", 0),
      entry("Émile Laurent", "p000000000006", 0),
    ];
    const names = (query: string) => groupMatching(directory, query).map((group) => group.people.map((person) => person.name));
    expect(names("")).toEqual([
      ["Ben Okafor", "Élodie Martin", "Ólöf Jónsdóttir", "Øyvind Berg", "Zoe Adams"],
      ["Émile Laurent", "Oscar Berg"],
    ]);
    // First-name matches still lead: "o" starts Ólöf's and Øyvind's first names, and only Ben's last.
    expect(names("o")).toEqual([["Ólöf Jónsdóttir", "Øyvind Berg", "Ben Okafor"], ["Oscar Berg"]]);
  });
});

describe("choosing someone", () => {
  it("writes @Name and a space in place of the search, and puts the caret after the space", () => {
    const search = mentionQueryAt("Show @car open findings", 9)!;
    expect(insertMention("Show @car open findings", search, CARMEN)).toEqual({
      text: "Show @Carmen Ruiz open findings",
      mention: { person: CARMEN, start: 5, end: 17 },
      caret: 18,
    });
    const atEnd = insertMention("@gr", mentionQueryAt("@gr", 3)!, GRACE)!;
    expect(atEnd.text).toBe("@Grace Lindqvist ");
    expect(atEnd.caret).toBe(atEnd.text.length);
  });

  it("takes the rest of the word the caret was in, so nothing is left hanging", () => {
    const written = insertMention("@carmen?", mentionQueryAt("@carmen?", 4)!, CARMEN)!;
    expect(written.text).toBe("@Carmen Ruiz ?");
  });

  it("refuses a name the question has no room for", () => {
    const text = `${"x".repeat(ASK_MAX_LENGTH - 5)} @ca`;
    expect(insertMention(text, mentionQueryAt(text, text.length)!, CARMEN)).toBeNull();
  });
});

describe("the chips around a change to the text", () => {
  const text = "Show @Carmen Ruiz open findings";
  const carmen = mentionAt(CARMEN, 5);

  it("moves along with an edit before it, and stays put for one after it", () => {
    expect(rebaseMentions([carmen], text, `Please s${text.slice(1)}`)).toEqual([{ ...carmen, start: 12, end: 24 }]);
    expect(rebaseMentions([carmen], text, `${text}?`)).toEqual([carmen]);
    expect(rebaseMentions([carmen], text, text)).toEqual([carmen]);
  });

  it("is plain text once the edit reaches into it, even if the name is typed back", () => {
    const edited = "Show @Carmen Rui open findings";
    expect(rebaseMentions([carmen], text, edited)).toEqual([]);
    expect(rebaseMentions([], edited, text)).toEqual([]);
    expect(rebaseMentions([carmen], text, "Show @Carmen Ruz open findings")).toEqual([]);
    expect(rebaseMentions([carmen], text, "Show @Karmen Ruiz open findings")).toEqual([]);
    expect(rebaseMentions([carmen], text, "Show  open findings")).toEqual([]);
  });

  it("stands with the space after it deleted, and with 's typed against it, but not run into a longer word", () => {
    const joined = "Show @Carmen Ruizopen findings";
    const kept = rebaseMentions([carmen], text, joined);
    expect(kept).toEqual([carmen]);
    expect(isIntact(carmen, joined)).toBe(false);
    const possessive = "Show @Carmen Ruiz's open findings";
    expect(rebaseMentions([carmen], text, possessive)).toEqual([carmen]);
    expect(isIntact(carmen, possessive)).toBe(true);
  });

  it("are sent as each chip's person once, in the order they first appear, ten at most", () => {
    const mentions = [mentionAt(CARMEN, 34), mentionAt(ADA, 17), mentionAt(CARMEN, 0)];
    expect(mentionedPeople(mentions)).toEqual([CARMEN, ADA]);
    expect(mentionedPeople([])).toEqual([]);
    const many = Array.from({ length: ASK_MAX_MENTIONS + 2 }, (_, index): Person => ({ id: `p${String(index).padStart(12, "0")}`, name: `P${index}`, avatar: null }));
    let line = "";
    const placed = many.map((person) => {
      const start = line.length;
      line += `@${person.name} `;
      return mentionAt(person, start);
    });
    expect(mentionedPeople(placed)).toEqual(many.slice(0, ASK_MAX_MENTIONS));
  });
});

describe("mentions in text from elsewhere (the address, the last question)", () => {
  it("are found again by id, at the first @Name of each not yet taken", () => {
    expect(mentionsIn("What are @Carmen Ruiz's open findings?", PEOPLE, [CARMEN.id])).toEqual([mentionAt(CARMEN, 9)]);
    const twins: Person[] = [CARMEN, { ...CARMEN, id: "p000000000001" }];
    const both = mentionsIn("@Carmen Ruiz and @Carmen Ruiz", twins, twins.map((person) => person.id));
    expect(both.map((mention) => [mention.start, mention.person.id])).toEqual([[0, CARMEN.id], [17, "p000000000001"]]);
  });

  it("are every @Name of each person sent, so a person picked twice comes back as two chips", () => {
    const text = "Is @Ada Brooks ahead of @Carmen Ruiz, or is @Ada Brooks behind?";
    expect(mentionsIn(text, PEOPLE, [ADA.id, CARMEN.id])).toEqual([mentionAt(ADA, 3), mentionAt(CARMEN, 24), mentionAt(ADA, 44)]);
  });

  it("are found with a letter typed against them, as the box sends such a chip, the longer name first", () => {
    expect(mentionsIn("is@Ada Brooks ahead?", PEOPLE, [ADA.id])).toEqual([mentionAt(ADA, 2)]);
    expect(mentionsIn("@Carmen Ruizes", PEOPLE, [CARMEN.id])).toEqual([mentionAt(CARMEN, 0)]);
    const longer: Person = { id: "p000000000002", name: "Ada Brooksby", avatar: null };
    for (const ids of [[ADA.id, longer.id], [longer.id, ADA.id]]) {
      expect(mentionsIn("@Ada Brooksby and @Ada Brooks", [...PEOPLE, longer], ids)).toEqual([mentionAt(longer, 0), mentionAt(ADA, 18)]);
      expect(mentionsIn("@Ada Brooksbyx", [...PEOPLE, longer], ids)).toEqual([mentionAt(longer, 0)]);
    }
  });

  it("are none for someone not on the board, not in the text, or before the board's people have arrived", () => {
    expect(mentionsIn("@Carmen Ruiz", PEOPLE, ["p000000000000"])).toEqual([]);
    expect(mentionsIn("Carmen Ruiz", PEOPLE, [CARMEN.id])).toEqual([]);
    expect(mentionsIn("@Carmen Ruiz", PEOPLE, [])).toEqual([]);
    expect(mentionsIn("@Carmen Ruiz", undefined, [CARMEN.id])).toEqual([]);
  });
});

describe("names in text", () => {
  it("are found as whole words, the longer name first, as the data writes them", () => {
    const names = ["Ann Lee", "Ann Leeson", "Ada Brooks"];
    expect(findNames("Ann Leeson and Ann Lee; Ada Brooks's", names).map((found) => found.name)).toEqual(["Ann Leeson", "Ann Lee", "Ada Brooks"]);
    expect(findNames("Ann Leesonite", names)).toEqual([]);
    expect(findNames("ada brooks", names)).toEqual([]);
    expect(findNames("Ada Brooks", [])).toEqual([]);
    expect(findNames("Ask (Ada Brooks) now", ["Ada Brooks", "a.b*"])).toEqual([{ name: "Ada Brooks", start: 5, end: 15 }]);
  });

  it("fold for a typed search: case and accents aside, letters with no accent to take off spelt out", () => {
    expect(foldText("Élif AYDIN")).toBe("elif aydin");
    expect(foldText("Aydın Łukasz Øster Straße")).toBe("aydin lukasz oster strasse");
  });
});
