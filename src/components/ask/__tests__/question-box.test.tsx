import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import type { DirectoryEntry, Person } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";

import { QuestionBox, type MentionSource } from "../question-box";

/** The sample's fictional people, two of them with a picture's version. */
const ADA: Person = { id: "pbc7fe62842ca", name: "Ada Brooks", avatar: null };
const CARMEN: Person = { id: "p599114b761a6", name: "Carmen Ruiz", avatar: "55ea1804e5bd" };
const ELIF: Person = { id: "p15311a7e00f9", name: "Elif Aydin", avatar: null };
const GRACE: Person = { id: "p65b14f7daa03", name: "Grace Lindqvist", avatar: "37d44fa82021" };
/** The sample's members of the board who hold none of its tickets (no pictures). */
const NOOR: Person = { id: "pc3d7609d78d1", name: "Noor Haddad", avatar: null };
const TOMAS: Person = { id: "p612c407b515f", name: "Tomás Ferreira", avatar: null };
const YUKI: Person = { id: "pe068f42bb810", name: "Yuki Tanabe", avatar: null };
/** An entry of the board's directory: someone, and how many of its tickets are theirs now. */
const entry = (person: Person, tickets = 4): DirectoryEntry => ({ person, tickets });
const PEOPLE = [CARMEN, ADA, GRACE, ELIF].map((person) => entry(person));
/** The whole board, as GET /people/directory orders it: by name, the members with no tickets among them. */
const DIRECTORY = [ADA, CARMEN, ELIF, GRACE, NOOR, TOMAS, YUKI].map((person) => entry(person, [NOOR, TOMAS, YUKI].includes(person) ? 0 : 4));

/** The box as a page holds it: the question in state, and shown (hidden) so a test can read what would be sent. */
function Harness({ mention, onSubmit, recall, initial = "" }: { mention?: MentionSource; onSubmit: (q: string, m: string[]) => void; recall?: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <QuestionBox value={value} onChange={setValue} onSubmit={onSubmit} busy={false} placeholder="Ask about the work" recall={recall} mention={mention} />
      <output hidden data-testid="value">
        {value}
      </output>
    </>
  );
}

function setup(source: Partial<MentionSource> | null = {}, options: { recall?: string; initial?: string } = {}) {
  const onSubmit = vi.fn<(question: string, mentions: string[]) => void>();
  const retry = vi.fn();
  const mention = source === null ? undefined : { people: PEOPLE, state: "success" as const, retry, ids: [], ...source };
  const user = userEvent.setup();
  renderKit(<Harness mention={mention} onSubmit={onSubmit} {...options} />);
  return { onSubmit, retry, user };
}

const field = () => screen.getByRole("textbox", { name: "Your question" });
/** The question as it would be sent: the text, each chip written "@Name". */
const value = () => screen.getByTestId("value").textContent;
/** The chips in the question, by person id, in order. */
const chips = () => [...field().querySelectorAll("[data-chip]")].map((chip) => chip.getAttribute("data-mentioned"));
/** What a screen reader reads in the field: the text, each chip as the person's name. */
const read = () => (field().textContent ?? "").replaceAll("​", "");
const list = () => screen.getByRole("listbox", { name: "People to mention" });
const options = () => within(list()).getAllByRole("option");
const optionNames = () => options().map((option) => option.textContent);
const activeOption = () => document.getElementById(field().getAttribute("aria-activedescendant") ?? "");
/** A beforeinput the way a browser sends one, for the input types user-event does not make. */
const beforeInput = (inputType: string, data: string | null = null) =>
  act(() => {
    field().dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
  });
/** Selects everything in the field, as Cmd+A does. */
const selectAll = () =>
  act(() => {
    document.getSelection()?.selectAllChildren(field());
  });
/** Focus as the / shortcut or Tab gives it: the caret goes to the end of the question. */
const focusFromKeyboard = () => act(() => field().focus());
/** Lets a composition's read-back (a task after compositionend) run. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("the question box, for a reader Ask answers about people", () => {
  it("is a multi-line textbox driving a listbox: @ opens the board's people, each with their picture or initials and name", async () => {
    const { user } = setup();
    expect(field()).toHaveAttribute("aria-multiline", "true");
    expect(field()).toHaveAttribute("contenteditable", "true");
    expect(field()).toHaveAttribute("aria-autocomplete", "list");
    expect(field()).toHaveAttribute("aria-haspopup", "listbox");
    expect(field()).toHaveAttribute("aria-placeholder", "Ask about the work");
    expect(field()).toHaveAccessibleDescription(/Press Enter to ask/);
    expect(field()).not.toHaveAttribute("aria-controls");
    expect(screen.getByText("Ask about the work")).toHaveAttribute("aria-hidden");

    await user.type(field(), "@");
    expect(field()).toHaveAttribute("aria-controls", list().id);
    expect(optionNames()).toEqual(["Ada Brooks", "Carmen Ruiz", "Elif Aydin", "Grace Lindqvist"]);
    // The first is highlighted, and the field says so.
    expect(activeOption()).toBe(options()[0]);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(options()[1]).toHaveAttribute("aria-selected", "false");
    // Pictures at 24 px, decorative; initials for the people without one.
    const carmen = options()[1].querySelector("[data-avatar]");
    expect(carmen).toHaveAttribute("data-avatar", "picture");
    expect(carmen).toHaveAttribute("data-size", "24");
    expect(carmen).toHaveAttribute("aria-hidden", "true");
    expect(carmen?.querySelector("img")).toHaveAttribute("src", `/api/oversight/people/${CARMEN.id}/avatar?v=${CARMEN.avatar}`);
    expect(options()[0].querySelector("[data-avatar]")).toHaveAttribute("data-initials", "AB");
    expect(options()[1]).toHaveAccessibleName("Carmen Ruiz");
    expect(screen.getByText(/4 people to mention/)).toBeInTheDocument();
    // The placeholder goes once there is a question.
    expect(screen.queryByText("Ask about the work")).not.toBeInTheDocument();
  });

  it("filters as they type, case and accents aside, on any word of the name", async () => {
    const { user } = setup();
    await user.type(field(), "Show @lind");
    expect(optionNames()).toEqual(["Grace Lindqvist"]);
    await user.clear(field());
    expect(value()).toBe("");
    await user.type(field(), "@ÉLI");
    expect(optionNames()).toEqual(["Elif Aydin"]);
    await user.type(field(), "f ay");
    expect(optionNames()).toEqual(["Elif Aydin"]);
  });

  it("moves with the arrows, wrapping, and chooses with Enter: the person's chip in the question, inline, and a space", async () => {
    const { user, onSubmit } = setup();
    await user.type(field(), "What are @");
    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Carmen Ruiz");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(activeOption()).toHaveTextContent("Grace Lindqvist");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Carmen Ruiz");

    await user.keyboard("{Enter}");
    expect(value()).toBe("What are @Carmen Ruiz ");
    expect(chips()).toEqual([CARMEN.id]);
    // The chip is in the question itself, where the @ was: not editable, her picture and her name.
    const chip = field().querySelector("[data-chip]")!;
    expect(chip).toHaveAttribute("contenteditable", "false");
    expect(chip.querySelector("[data-avatar]")).toHaveAttribute("data-avatar", "picture");
    expect(chip.querySelector("[data-avatar]")).toHaveAttribute("data-size", "20");
    expect(chip).toHaveTextContent("Carmen Ruiz");
    // No line of mentions under the question any more.
    expect(document.querySelectorAll("[data-mentioned]")).toHaveLength(1);
    expect(screen.queryByText("Mentions")).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByText("Carmen Ruiz mentioned.")).toBeInTheDocument();
    // Enter chose; it did not send.
    expect(onSubmit).not.toHaveBeenCalled();

    // The caret is after the space: a Backspace takes the space, and the words go on against the chip.
    await user.keyboard("{Backspace}'s open findings?");
    expect(value()).toBe("What are @Carmen Ruiz's open findings?");
    // A screen reader reads the chip as her name in the sentence.
    expect(read()).toBe("What are Carmen Ruiz's open findings?");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("What are @Carmen Ruiz's open findings?", [CARMEN.id]);
  });

  it("chooses with Tab too, and with the pointer: the row under it is the highlighted one", async () => {
    const { user, onSubmit } = setup();
    await user.type(field(), "@gr");
    await user.keyboard("{Tab}");
    expect(value()).toBe("@Grace Lindqvist ");
    expect(field()).toHaveFocus();

    await user.keyboard("and @");
    const [, carmen] = options();
    await user.hover(carmen);
    expect(activeOption()).toBe(carmen);
    await user.click(carmen);
    expect(value()).toBe("@Grace Lindqvist and @Carmen Ruiz ");
    expect(chips()).toEqual([GRACE.id, CARMEN.id]);
    expect(field()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("@Grace Lindqvist and @Carmen Ruiz", [GRACE.id, CARMEN.id]);
  });

  it("removes a chip whole with one Backspace just after it, or one Delete just before it", async () => {
    const { user, onSubmit } = setup();
    await user.type(field(), "Is @ca");
    await user.keyboard("{Enter}{Backspace}");
    expect(value()).toBe("Is @Carmen Ruiz");
    await user.keyboard("{Backspace}");
    expect(value()).toBe("Is ");
    expect(chips()).toEqual([]);

    await user.keyboard("@ad{Enter}now");
    expect(value()).toBe("Is @Ada Brooks now");
    // Back over "now", the space and the chip (one press), then Delete takes the chip whole.
    await user.keyboard("{ArrowLeft>5/}");
    await user.keyboard("{Delete}");
    expect(value()).toBe("Is  now");
    expect(chips()).toEqual([]);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Is  now", []);
  });

  it("steps over a chip as one with the arrows, so text goes on either side of it and never into it", async () => {
    const { user, onSubmit } = setup();
    await user.type(field(), "Ask @ca");
    await user.keyboard("{Enter}now");
    // From the end: three letters, the space, then the whole chip in one press.
    await user.keyboard("{ArrowLeft>5/}X");
    expect(value()).toBe("Ask X@Carmen Ruiz now");
    await user.keyboard("{ArrowRight}Y");
    expect(value()).toBe("Ask X@Carmen RuizY now");
    expect(chips()).toEqual([CARMEN.id]);
    // Shift and an arrow select the chip whole; typing replaces it.
    await user.keyboard("{ArrowLeft}{Shift>}{ArrowLeft}{/Shift}Z");
    expect(value()).toBe("Ask XZY now");
    expect(chips()).toEqual([]);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Ask XZY now", []);
  });

  it("takes a word or a line back to a chip whole, as Option or Cmd and Backspace do", async () => {
    const { user } = setup();
    await user.type(field(), "Show @ca");
    await user.keyboard("{Enter}");
    beforeInput("deleteWordBackward");
    expect(value()).toBe("Show ");
    await user.keyboard("@ad{Enter}and more");
    beforeInput("deleteSoftLineBackward");
    expect(value()).toBe("");
    expect(chips()).toEqual([]);
  });

  it("undoes and redoes its own changes, a chip with them, and runs of typing as one step", async () => {
    const { user } = setup();
    await user.type(field(), "@ca");
    await user.keyboard("{Enter}");
    expect(chips()).toEqual([CARMEN.id]);
    await user.keyboard("{Control>}z{/Control}");
    expect(value()).toBe("@ca");
    expect(chips()).toEqual([]);
    // Back in the search: the list is there again.
    expect(optionNames()).toEqual(["Carmen Ruiz"]);
    await user.keyboard("{Control>}z{/Control}");
    expect(value()).toBe("");
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(value()).toBe("@ca");
    await user.keyboard("{Control>}y{/Control}");
    expect(value()).toBe("@Carmen Ruiz ");
    expect(chips()).toEqual([CARMEN.id]);
    // The browser's own undo and redo (the Edit menu) come as beforeinput, and do the same.
    beforeInput("historyUndo");
    expect(value()).toBe("@ca");
    beforeInput("historyRedo");
    expect(chips()).toEqual([CARMEN.id]);
  });

  it("pastes plain text only, never HTML and never a chip, and copies and cuts each chip as @Name", async () => {
    const { user } = setup();
    await user.type(field(), "What is @ca");
    await user.keyboard("{Enter}");
    fireEvent.paste(field(), {
      clipboardData: { getData: (type: string) => (type === "text/plain" ? "doing about\r\n@Ada Brooks\u0000?" : "<b>doing</b><img src=x>") },
    });
    expect(value()).toBe("What is @Carmen Ruiz doing about\n@Ada Brooks?");
    expect(chips()).toEqual([CARMEN.id]);
    expect(field().querySelector("b, img:not([data-avatar] img)")).toBeNull();

    selectAll();
    const setData = vi.fn();
    fireEvent.copy(field(), { clipboardData: { setData } });
    expect(setData).toHaveBeenCalledWith("text/plain", "What is @Carmen Ruiz doing about\n@Ada Brooks?");
    expect(setData).toHaveBeenCalledTimes(1);
    fireEvent.cut(field(), { clipboardData: { setData } });
    expect(value()).toBe("");
    expect(chips()).toEqual([]);
  });

  it("drops plain text where it lands, and the spelling fixer's replacement goes in as typed", async () => {
    const { user } = setup();
    await user.type(field(), "Wher is it");
    fireEvent.drop(field(), { dataTransfer: { getData: (type: string) => (type === "text/plain" ? " now" : "<i>now</i>") } });
    expect(value()).toBe("Wher is it now");
    beforeInput("insertReplacementText", "!");
    expect(value()).toBe("Wher is it now!");
  });

  it("stops at 500 characters, counted on the question as sent", async () => {
    const { user } = setup();
    await user.type(field(), "@ca");
    await user.keyboard("{Enter}");
    fireEvent.paste(field(), { clipboardData: { getData: () => "x".repeat(600) } });
    expect(value()).toHaveLength(500);
    expect(value()?.startsWith("@Carmen Ruiz x")).toBe(true);
    expect(screen.getByText(/Questions stop at/)).toHaveTextContent("Questions stop at 500 / 500");
    await user.keyboard("y");
    expect(value()).toHaveLength(500);
  });

  it("closes on Esc and stays closed while the caret stays in that search; a new @ opens it again", async () => {
    const { user, onSubmit } = setup();
    await user.type(field(), "@car");
    await user.keyboard("{Escape}");
    expect(field()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("m");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // With the list closed, Enter sends the question as it is: the @ is plain text.
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("@carm", []);
    await user.keyboard(" @");
    expect(list()).toBeInTheDocument();
  });

  it("leaves an input method to compose, and reads back what it wrote once it is done", async () => {
    const { onSubmit } = setup();
    fireEvent.compositionStart(field());
    // The browser writes the composition into the field itself.
    const composed = document.createTextNode("@");
    act(() => {
      field().insertBefore(composed, field().lastChild);
    });
    expect(screen.queryByText("Ask about the work")).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(field(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(field(), { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field());
    await settle();
    expect(value()).toBe("@");
    expect(list()).toBeInTheDocument();
    // React's own nodes again: the browser's text node is gone, and the text is drawn once.
    expect(composed.isConnected).toBe(false);
    expect(read()).toBe("@");
    fireEvent.keyDown(field(), { key: "ArrowDown", keyCode: 229 });
    expect(activeOption()).toHaveTextContent("Ada Brooks");
  });

  it("reads a composition back at Safari's last input after it ends, and keeps it within the 500 characters", async () => {
    setup({}, { initial: "x".repeat(498) });
    fireEvent.compositionStart(field());
    const run = field().querySelector("[data-run]")!.firstChild as Text;
    act(() => {
      run.appendData("かなか");
    });
    fireEvent.compositionEnd(field());
    fireEvent.input(field(), { inputType: "insertFromComposition" });
    expect(value()).toBe(`${"x".repeat(498)}かな`);
    await settle();
    expect(value()).toHaveLength(500);
  });

  it("says when no one matches, and gets out of the way once a space shows it was never a name", async () => {
    const { user } = setup();
    await user.type(field(), "@zz");
    expect(screen.getByText("No one on this board matches “zz”.")).toBeInTheDocument();
    expect(field()).not.toHaveAttribute("aria-controls");
    expect(screen.getByText("No one on this board matches.")).toBeInTheDocument();
    await user.keyboard(" top");
    expect(screen.queryByText(/No one on this board matches “/)).not.toBeInTheDocument();
  });

  it("shows the list's loading rows while the board's people arrive, and a way to try again if they fail", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = renderKit(<Harness onSubmit={onSubmit} mention={{ people: undefined, state: "pending", retry, ids: [] }} />);
    // An @ typed while they load: the list opens on rows in its final shape, and says why it holds no one yet.
    await user.type(field(), "@");
    expect(document.querySelectorAll("[data-mention-menu] .skeleton").length).toBeGreaterThan(0);
    expect(screen.getByText("Loading the board's people.")).toBeInTheDocument();
    expect(field()).not.toHaveAttribute("aria-controls");

    rerender(<Harness onSubmit={onSubmit} mention={{ people: undefined, state: "error", retry, ids: [] }} />);
    expect(screen.getByText("Couldn’t load the board’s people.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    // The question keeps its text.
    expect(value()).toBe("@");

    rerender(<Harness onSubmit={onSubmit} mention={{ people: PEOPLE, state: "success", retry, ids: [] }} />);
    expect(optionNames()).toHaveLength(4);
  });

  it("tries again with Enter when the people failed to load, and says so: the keyboard reaches what the button does", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = renderKit(<Harness onSubmit={onSubmit} mention={{ people: undefined, state: "error", retry, ids: [] }} />);
    await user.type(field(), "Where is @");
    expect(screen.getByText("Could not load people. Press Enter to retry.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(value()).toBe("Where is @");
    expect(field()).toHaveFocus();

    // While it tries, the loading rows (and their words); then the people, to choose from as ever.
    rerender(<Harness onSubmit={onSubmit} mention={{ people: undefined, state: "pending", retry, ids: [] }} />);
    expect(screen.getByText("Loading the board's people.")).toBeInTheDocument();
    rerender(<Harness onSubmit={onSubmit} mention={{ people: PEOPLE, state: "success", retry, ids: [] }} />);
    expect(optionNames()).toHaveLength(4);
    await user.keyboard("{Enter}");
    expect(value()).toBe("Where is @Ada Brooks ");
    expect(chips()).toEqual([ADA.id]);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("makes a name already typed in full a chip in place, the caret past the space, and later keys land where typed", async () => {
    const { user, onSubmit } = setup();
    await user.type(field(), "@Ada Brooks open findings");
    // Back to just after "Brooks": the search there finds her.
    await user.keyboard("{ArrowLeft>14/}");
    expect(optionNames()).toEqual(["Ada Brooks"]);
    await user.keyboard("{Enter}");
    expect(value()).toBe("@Ada Brooks open findings");
    expect(chips()).toEqual([ADA.id]);
    await user.keyboard("*");
    expect(value()).toBe("@Ada Brooks *open findings");

    await user.keyboard("{Backspace}{ArrowRight>20/}?");
    expect(value()).toBe("@Ada Brooks open findings?");
    await user.keyboard("!");
    expect(value()).toBe("@Ada Brooks open findings?!");
    await user.keyboard("{Backspace}{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("@Ada Brooks open findings?", [ADA.id]);
  });

  it("refuses an eleventh mention where it is seen, with the kit's warning, and keeps the ten", async () => {
    const warn = vi.spyOn(notify, "warn").mockReturnValue("ask-mention-refused");
    // A board of twelve fictional people, ten of them mentioned already.
    const board: Person[] = Array.from({ length: 12 }, (_, index) => ({
      id: `p${(0xa0 + index).toString(16).padStart(12, "0")}`,
      name: `${"ABCDEFGHIJKL"[index]}ri Tester`,
      avatar: null,
    }));
    const asked = board.slice(0, 10);
    const initial = `${asked.map((person) => `@${person.name}`).join(" ")} `;
    const { user, onSubmit } = setup({ people: board.map((person) => entry(person)), ids: asked.map((person) => person.id) }, { initial });
    expect(chips()).toHaveLength(10);

    focusFromKeyboard();
    await user.keyboard("@Kri");
    expect(optionNames()).toEqual(["Kri Tester"]);
    await user.keyboard("{Enter}");
    expect(warn).toHaveBeenCalledWith("Mention limit reached", { id: "ask-mention-refused", description: "A question can mention 10 people at most." });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(value()).toBe(`${initial}@Kri`);
    expect(chips()).toHaveLength(10);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith(`${initial}@Kri`, asked.map((person) => person.id));
  });

  it("refuses a name with no room left in the 500 characters the same way, the text left as it was", async () => {
    const warn = vi.spyOn(notify, "warn").mockReturnValue("ask-mention-refused");
    const long = `${"x".repeat(490)} @Car`;
    const { user } = setup({}, { initial: long });
    focusFromKeyboard();
    await user.keyboard("m");
    expect(optionNames()).toEqual(["Carmen Ruiz"]);
    await user.keyboard("{Enter}");
    expect(warn).toHaveBeenCalledWith("No room for that name", { id: "ask-mention-refused", description: "Questions stop at 500 characters." });
    expect(value()).toBe(`${long}m`);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(chips()).toEqual([]);
  });

  it("brings the last question back with ↑, its chips with it", async () => {
    const { user, onSubmit } = setup({ ids: [CARMEN.id] }, { recall: "What is @Carmen Ruiz working on?" });
    await user.click(field());
    await user.keyboard("{ArrowUp}");
    expect(value()).toBe("What is @Carmen Ruiz working on?");
    expect(chips()).toEqual([CARMEN.id]);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("What is @Carmen Ruiz working on?", [CARMEN.id]);
  });

  it("rebuilds the chips of a question from elsewhere (the address, Ask again) from its text and ids, and sends it as it came", async () => {
    const question = "Compare @Carmen Ruiz and @Ada Brooks";
    const { user, onSubmit } = setup({ ids: [ADA.id, CARMEN.id] }, { initial: question });
    expect(chips()).toEqual([CARMEN.id, ADA.id]);
    expect(read()).toBe("Compare Carmen Ruiz and Ada Brooks");
    await user.click(field());
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith(question, [CARMEN.id, ADA.id]);
  });

  it("keeps Enter to ask and Shift+Enter for a new line when the list is closed", async () => {
    const { user, onSubmit } = setup();
    await user.type(field(), "Where do tickets{Shift>}{Enter}{/Shift}get stuck?");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(value()).toBe("Where do tickets\nget stuck?");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Where do tickets\nget stuck?", []);
  });
});

describe("the @ list's two groups", () => {
  const groups = () => within(list()).queryAllByRole("group");
  const groupNames = () => groups().map((group) => within(group).getAllByRole("option").map((option) => option.textContent));

  it("lists those with tickets, then the members with none, each a group named by its heading, in one listbox", async () => {
    const { user } = setup({ people: DIRECTORY });
    await user.type(field(), "@");
    expect(groups()).toHaveLength(2);
    expect(groups()[0]).toHaveAccessibleName("With tickets");
    expect(groups()[1]).toHaveAccessibleName("No tickets");
    expect(groupNames()).toEqual([
      ["Ada Brooks", "Carmen Ruiz", "Elif Aydin", "Grace Lindqvist"],
      ["Noor Haddad", "Tomás Ferreira", "Yuki Tanabe"],
    ]);
    // The headings are not options: seven to choose from, and the field says seven.
    expect(options()).toHaveLength(7);
    expect(screen.getByText(/7 people to mention/)).toBeInTheDocument();
    // Rows as ever: a 24 px avatar (initials for a member with no picture) and the name.
    expect(options()[4].querySelector("[data-avatar]")).toHaveAttribute("data-initials", "NH");
    expect(options()[4].querySelector("[data-avatar]")).toHaveAttribute("data-size", "24");
    // The listbox is the scroller, in the kit's frame that fades the edge it can still scroll towards.
    expect(list()).toHaveClass("jo-scroller");
    expect(list().parentElement).toHaveAttribute("data-axis", "y");
  });

  it("filters across both groups, case and accents aside, and hides a group the search empties, heading and all", async () => {
    const { user } = setup({ people: DIRECTORY });
    await user.type(field(), "@t");
    expect(groupNames()).toEqual([["Tomás Ferreira", "Yuki Tanabe"]]);
    expect(groups()[0]).toHaveAccessibleName("No tickets");
    expect(screen.queryByText("With tickets")).not.toBeInTheDocument();
    await user.keyboard("om");
    expect(groupNames()).toEqual([["Tomás Ferreira"]]);

    await user.clear(field());
    await user.type(field(), "@a");
    expect(groupNames()).toEqual([["Ada Brooks", "Elif Aydin"]]);
    expect(groups()[0]).toHaveAccessibleName("With tickets");
    expect(screen.queryByText("No tickets")).not.toBeInTheDocument();
  });

  it("moves through both groups as one list, wrapping, and chooses a member with no tickets like anyone else", async () => {
    const { user, onSubmit } = setup({ people: DIRECTORY });
    await user.type(field(), "Is @");
    await user.keyboard("{ArrowUp}");
    expect(activeOption()).toHaveTextContent("Yuki Tanabe");
    await user.keyboard("{ArrowDown}");
    expect(activeOption()).toHaveTextContent("Ada Brooks");
    await user.keyboard("{ArrowDown>4/}");
    expect(activeOption()).toHaveTextContent("Noor Haddad");
    expect(activeOption()?.closest("[role=group]")).toHaveAccessibleName("No tickets");
    expect(activeOption()).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(value()).toBe("Is @Noor Haddad ");
    expect(chips()).toEqual([NOOR.id]);
    // Initials in the chip for a member with no picture.
    expect(field().querySelector("[data-chip] [data-avatar]")).toHaveAttribute("data-initials", "NH");
    await user.keyboard("on this board?{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Is @Noor Haddad on this board?", [NOOR.id]);
  });

  it("says so when the board lists no one at all", async () => {
    const { user } = setup({ people: [] });
    await user.type(field(), "@");
    expect(screen.getByText("No people on this board yet.")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("the question box, for a reader Ask answers at team level", () => {
  it("is the same field with no @ list: @ is just a character, and no mention is ever sent", async () => {
    const { user, onSubmit } = setup(null);
    expect(field()).toHaveAttribute("aria-multiline", "true");
    expect(field()).not.toHaveAttribute("aria-autocomplete");
    expect(field()).not.toHaveAttribute("aria-haspopup");
    await user.type(field(), "What are @Carmen Ruiz's open findings?");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.querySelector("[data-mention-menu]")).toBeNull();
    expect(chips()).toEqual([]);
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("What are @Carmen Ruiz's open findings?", []);
    expect(screen.queryByText(/mention someone/)).not.toBeInTheDocument();
  });
});

describe("while a question is being answered", () => {
  /** The box with `busy` under the test's control, as the page holds it while an answer is on its way. */
  function BusyHarness({ busy, onSubmit }: { busy: boolean; onSubmit: (q: string, m: string[]) => void }) {
    const [value, setValue] = useState("");
    return <QuestionBox value={value} onChange={setValue} onSubmit={onSubmit} busy={busy} placeholder="Ask another question" />;
  }

  it("takes nothing typed or pasted, cannot be sent, and gives the focus back when the answer is in", async () => {
    const onSubmit = vi.fn<(question: string, mentions: string[]) => void>();
    const { rerender } = renderKit(<BusyHarness busy onSubmit={onSubmit} />);

    // Read-only, and said so: nothing can be typed, pasted or dropped into it.
    expect(field()).toHaveAttribute("aria-readonly", "true");
    expect(field()).toHaveAttribute("contenteditable", "false");
    expect(fireEvent.keyDown(field(), { key: "a" })).toBe(false);
    expect(fireEvent.paste(field(), { clipboardData: { getData: () => "pasted", types: ["text/plain"] } })).toBe(false);
    expect(read()).toBe("");

    // The button says it is asking, cannot be pressed, and Enter sends nothing.
    const button = screen.getByRole("button", { name: /Asking/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(field(), { key: "Enter" });
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();

    // The answer is in: the box is a field again, and has the focus for the next question.
    rerender(<BusyHarness busy={false} onSubmit={onSubmit} />);
    expect(field()).not.toHaveAttribute("aria-readonly");
    expect(field()).toHaveAttribute("contenteditable", "true");
    expect(field()).toHaveFocus();
  });
});
