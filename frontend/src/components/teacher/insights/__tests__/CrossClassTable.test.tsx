/**
 * Tests for the CrossClassTable.
 *
 * Properties under test:
 *   - Empty-state when rows are empty.
 *   - Default sort renders rows by `messages` desc.
 *   - Clicking a column header sorts by that column.
 *   - Click twice flips direction.
 *   - Class name is a Next link to /teacher/classes/[id].
 *   - Delta + last-activity formatters render expected output.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CrossClassTable } from "@/components/teacher/insights/CrossClassTable";
import type { InsightsCompareRow } from "@/lib/insightsApi";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ROWS: InsightsCompareRow[] = [
  {
    classId: "c1",
    name: "Astrophysics 9A",
    activeGroups: 3,
    messages: 100,
    messagesPrior: 80,
    messagesDelta: 20,
    simRuns: 7,
    lastActivity: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    classId: "c2",
    name: "Biology 9B",
    activeGroups: 2,
    messages: 200,
    messagesPrior: 220,
    messagesDelta: -20,
    simRuns: 3,
    lastActivity: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
  },
];

describe("CrossClassTable", () => {
  it("shows the empty state when given no rows", () => {
    render(<CrossClassTable rows={[]} />);
    expect(screen.getByTestId("cross-class-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("cross-class-table")).not.toBeInTheDocument();
  });

  it("default sort is by messages descending", () => {
    render(<CrossClassTable rows={ROWS} />);
    const table = screen.getByTestId("cross-class-table");
    const rows = within(table).getAllByRole("row").slice(1); // skip header
    expect(rows[0]).toHaveTextContent("Biology 9B"); // 200 msgs first
    expect(rows[1]).toHaveTextContent("Astrophysics 9A");
  });

  it("clicking the Class column sorts by name ascending", () => {
    render(<CrossClassTable rows={ROWS} />);
    fireEvent.click(screen.getByRole("button", { name: /sort by class/i }));
    const rows = within(screen.getByTestId("cross-class-table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Astrophysics 9A");
    expect(rows[1]).toHaveTextContent("Biology 9B");
  });

  it("clicking the same column twice flips direction", () => {
    render(<CrossClassTable rows={ROWS} />);
    const groupsBtn = screen.getByRole("button", { name: /sort by groups/i });
    fireEvent.click(groupsBtn); // desc by groups -> 3, 2
    let rows = within(screen.getByTestId("cross-class-table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Astrophysics 9A");

    fireEvent.click(groupsBtn); // asc -> 2, 3
    rows = within(screen.getByTestId("cross-class-table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Biology 9B");
  });

  it("class names are anchors to /teacher/classes/[id]", () => {
    render(<CrossClassTable rows={ROWS} />);
    const link = screen.getByRole("link", { name: "Astrophysics 9A" });
    expect(link).toHaveAttribute("href", "/teacher/classes/c1");
  });

  it("renders positive deltas with a + sign and negatives with a minus", () => {
    render(<CrossClassTable rows={ROWS} />);
    expect(screen.getByText("+20")).toBeInTheDocument();
    expect(screen.getByText("-20")).toBeInTheDocument();
  });

  it("respects defaultSort prop", () => {
    render(<CrossClassTable rows={ROWS} defaultSort="simRuns" />);
    // Default desc by sim runs: 7 first (Astrophysics), then 3 (Biology).
    const rows = within(screen.getByTestId("cross-class-table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Astrophysics 9A");
  });
});
