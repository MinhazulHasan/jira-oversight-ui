import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notify } from "@/lib/notify";

import { csvCell, csvFileName, toCsv, type CsvColumn } from "../csv";
import { ExportCsvButton } from "../export-csv-button";
import { renderKit } from "./kit";

vi.mock("@/lib/notify", () => ({
  notify: { ok: vi.fn(), cite: vi.fn(), warn: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

type Row = { key: string; summary: string; ratio: number | null };

const ROWS: Row[] = [
  { key: "DEMO-1", summary: "Retry, then fail", ratio: 1.5 },
  { key: "DEMO-2", summary: '=HYPERLINK("http://example.test")', ratio: null },
];

const COLUMNS: CsvColumn<Row>[] = [
  { header: "Issue", value: (row) => row.key },
  { header: "Summary", value: (row) => row.summary },
  { header: "Effort ratio", value: (row) => row.ratio },
];

describe("csv", () => {
  it("quotes only where it must, doubling quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("writes text that a spreadsheet would run as a formula as plain text, and numbers as numbers", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+44 20")).toBe("'+44 20");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-1.5)).toBe("-1.5");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("writes missing values as empty cells and dates as ISO instants", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(new Date("2026-11-04T14:30:00Z"))).toBe("2026-11-04T14:30:00.000Z");
  });

  it("joins rows with CRLF under a header row", () => {
    expect(toCsv(ROWS, COLUMNS)).toBe(
      'Issue,Summary,Effort ratio\r\nDEMO-1,"Retry, then fail",1.5\r\nDEMO-2,"\'=HYPERLINK(""http://example.test"")",\r\n',
    );
  });

  it("names the file after what it holds and the day", () => {
    expect(csvFileName("Findings", new Date(2026, 10, 4))).toBe("findings-2026-11-04.csv");
    expect(csvFileName("Time in status!", new Date(2026, 0, 9))).toBe("time-in-status-2026-01-09.csv");
    expect(csvFileName("***", new Date(2026, 0, 9))).toBe("export-2026-01-09.csv");
  });
});

describe("ExportCsvButton", () => {
  const blobs: Blob[] = [];

  beforeEach(() => {
    blobs.length = 0;
    vi.mocked(notify.ok).mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 4, 10, 0));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        blobs.push(blob);
        return "blob:jo-test";
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
    // jsdom cannot download; the click on the hidden link is all that matters here.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the CSV in the browser, with a byte order mark for Excel, and says what it saved", async () => {
    const user = userEvent.setup();
    renderKit(<ExportCsvButton rows={ROWS} columns={COLUMNS} fileName="findings" rowNoun="finding" />);

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("text/csv;charset=utf-8");
    // Blob.text() decodes UTF-8 and drops a leading byte order mark, so read the bytes.
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe(toCsv(ROWS, COLUMNS));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(notify.ok).toHaveBeenCalledWith("Export ready", {
      description: "2 findings saved as findings-2026-11-04.csv.",
    });
  });

  it("stays reachable but does nothing when there is nothing to export", async () => {
    const user = userEvent.setup();
    renderKit(<ExportCsvButton rows={[]} columns={COLUMNS} fileName="findings" rowNoun="finding" />);
    const button = screen.getByRole("button", { name: "Export CSV" });
    expect(button).toHaveAttribute("aria-disabled", "true");

    await user.click(button);
    expect(blobs).toHaveLength(0);
    expect(notify.ok).not.toHaveBeenCalled();
  });
});
