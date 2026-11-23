import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { formatCount, formatDelta, formatHours, formatRatio, formatShare } from "@/lib/format";

import { Delta, FigureText, StatTile, deltaVerdict, signed } from "../stat-tile";
import { renderKit } from "./kit";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const MINUS = "−";
const options = { locale: "en-GB" };

describe("delta verdicts", () => {
  it("judges a change by which way is good", () => {
    expect(deltaVerdict(3, "down")).toBe("worse");
    expect(deltaVerdict(-4, "down")).toBe("better");
    expect(deltaVerdict(5, "up")).toBe("better");
    expect(deltaVerdict(-1, "up")).toBe("worse");
    expect(deltaVerdict(2, "neither")).toBe("neutral");
    expect(deltaVerdict(0, "down")).toBe("flat");
    expect(deltaVerdict(null, "down")).toBe("none");
    expect(deltaVerdict(Number.NaN, "down")).toBe("none");
  });
});

describe("signed formats", () => {
  it("signs a change with + or a true minus, in the figure's own format", () => {
    expect(formatDelta(3, options)).toBe("+3");
    expect(formatDelta(-4, options)).toBe(`${MINUS}4`);
    expect(signed(formatHours)(0.3, options)).toBe("+0.3 h");
    expect(signed(formatHours)(-12.25, options)).toBe(`${MINUS}12.3 h`);
    expect(signed(formatRatio)(0.05, options)).toBe("+0.05×");
    expect(signed(formatCount)(1234, options)).toBe("+1,234");
  });

  it("never prints +0.0 h for a change too small to show", () => {
    expect(signed(formatHours)(0.04, options)).toBe("0.0 h");
    expect(signed(formatHours)(-0.04, options)).toBe("0.0 h");
    expect(signed(formatHours)(0, options)).toBe("0.0 h");
  });
});

describe("Delta", () => {
  it("reads a worsening count: arrow, signed figure, comparison, and the verdict for screen readers", () => {
    renderKit(<Delta delta={3} goodDirection="down" label="vs last week" />);
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.getByText("vs last week")).toBeInTheDocument();
    expect(screen.getByText(", worse")).toHaveClass("sr-only");
  });

  it("reads an improvement with a true minus", () => {
    renderKit(<Delta delta={-4} goodDirection="down" />);
    expect(screen.getByText(`${MINUS}4`)).toBeInTheDocument();
    expect(screen.getByText(", better")).toBeInTheDocument();
  });

  it("calls a change that rounds to nothing no change", () => {
    renderKit(<Delta delta={0.04} goodDirection="down" format={signed(formatHours)} />);
    // Testing Library folds the no-break space into a plain one before matching.
    expect(screen.getByText("0.0 h")).toBeInTheDocument();
    expect(screen.getByText(", no change")).toBeInTheDocument();
  });

  it("shows a dash, and no verdict, when there is nothing to compare", () => {
    renderKit(<Delta delta={null} goodDirection="down" label="vs last week" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/better|worse|no change/)).not.toBeInTheDocument();
  });
});

describe("FigureText", () => {
  it("sets a unit back from its figure, and leaves a bare figure alone", () => {
    const { container, rerender } = renderKit(<FigureText text={formatHours(38.2, options)} />);
    expect(container).toHaveTextContent("38.2h");
    expect(screen.getByText("h")).toHaveClass("text-ink-low");

    rerender(<FigureText text={formatRatio(1.51, options)} />);
    expect(screen.getByText("×")).toHaveClass("text-ink-low");

    rerender(<FigureText text={formatShare(0.16, options)} />);
    expect(container).toHaveTextContent("16%");
    expect(container.querySelector("span")).toBeNull();
  });
});

describe("StatTile", () => {
  it("is one link to the rows behind its figure, named by its label, figure and change", () => {
    renderKit(
      <StatTile
        label="Open breaches"
        mark="breach"
        value={14}
        delta={3}
        deltaLabel="vs last week"
        goodDirection="down"
        href="/findings?severity=breach"
        hrefLabel="Show the open breaches"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/findings?severity=breach");
    expect(link).toHaveAccessibleName(/Open breaches.*14.*\+3.*vs last week.*worse.*Show the open breaches/);
  });

  it("formats its figure with the formatter it is given", () => {
    renderKit(<StatTile label="Median cycle time" value={38.25} format={formatHours} />);
    expect(screen.getByText("Median cycle time").closest("div")).toHaveTextContent("38.3h");
  });

  it("says not measurable calmly, with the reason", () => {
    renderKit(
      <StatTile label="Reviewed before testing" value={null} state="not-measurable" notMeasurableReason="The workflow records no code review." />,
    );
    expect(screen.getByText("Not measurable")).toBeInTheDocument();
    expect(screen.getByText("The workflow records no code review.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
