// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { DataTable } from "../../src/components/ui/data-table.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

type Row = { id: string; name: string; value: number };

const COLUMNS = [
  { id: "name", header: "Name", cell: (row: Row) => row.name },
  { id: "value", header: "Value", cell: (row: Row) => String(row.value) },
];

const DATA: Row[] = [
  { id: "1", name: "Alpha", value: 10 },
  { id: "2", name: "Beta", value: 20 },
];

describe("DataTable", () => {
  it("renders headers and rows", () => {
    const { container, root } = renderIntoDocument(
      React.createElement(DataTable<Row>, {
        columns: COLUMNS,
        data: DATA,
        rowKey: (row) => row.id,
      }),
    );

    const headers = Array.from(container.querySelectorAll("th"));
    expect(headers).toHaveLength(2);
    expect(headers[0]?.textContent).toBe("Name");
    expect(headers[1]?.textContent).toBe("Value");

    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Alpha");
    expect(rows[1]?.textContent).toContain("Beta");

    cleanupTestRoot({ container, root });
  });

  it("handles empty data", () => {
    const { container, root } = renderIntoDocument(
      React.createElement(DataTable<Row>, {
        columns: COLUMNS,
        data: [],
        rowKey: (row) => row.id,
      }),
    );

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(0);

    const headers = container.querySelectorAll("th");
    expect(headers).toHaveLength(2);

    cleanupTestRoot({ container, root });
  });

  it("applies testIdPrefix to rows", () => {
    const { container, root } = renderIntoDocument(
      React.createElement(DataTable<Row>, {
        columns: COLUMNS,
        data: DATA,
        rowKey: (row) => row.id,
        testIdPrefix: "test-row",
      }),
    );

    expect(container.querySelector("[data-testid='test-row-1']")).not.toBeNull();
    expect(container.querySelector("[data-testid='test-row-2']")).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("applies custom column classNames", () => {
    const columns = [
      {
        id: "name",
        header: "Name",
        cell: (row: Row) => row.name,
        headerClassName: "text-right",
        cellClassName: "font-mono",
      },
    ];

    const { container, root } = renderIntoDocument(
      React.createElement(DataTable<Row>, {
        columns,
        data: [DATA[0]!],
        rowKey: (row) => row.id,
      }),
    );

    const th = container.querySelector("th");
    expect(th?.classList.contains("text-right")).toBe(true);

    const td = container.querySelector("td");
    expect(td?.classList.contains("font-mono")).toBe(true);

    cleanupTestRoot({ container, root });
  });

  it("renders renderAfterRow content", () => {
    const { container, root } = renderIntoDocument(
      React.createElement(DataTable<Row>, {
        columns: COLUMNS,
        data: [DATA[0]!],
        rowKey: (row) => row.id,
        renderAfterRow: (row) =>
          React.createElement(
            "tr",
            { key: `${row.id}-detail` },
            React.createElement("td", { colSpan: 2 }, `Detail for ${row.name}`),
          ),
      }),
    );

    const allRows = container.querySelectorAll("tbody tr");
    expect(allRows).toHaveLength(2);
    expect(allRows[1]?.textContent).toContain("Detail for Alpha");

    cleanupTestRoot({ container, root });
  });

  describe("expandable rows", () => {
    function renderExpandableTable() {
      return renderIntoDocument(
        React.createElement(DataTable<Row>, {
          columns: COLUMNS,
          data: DATA,
          rowKey: (row) => row.id,
          renderExpandedRow: (row) =>
            React.createElement(
              "div",
              { "data-testid": "expanded-content" },
              `Details for ${row.name}`,
            ),
        }),
      );
    }

    function getExpandButtons(container: HTMLElement): HTMLButtonElement[] {
      return Array.from(
        container.querySelectorAll<HTMLButtonElement>("tbody button[aria-expanded]"),
      );
    }

    it("renders expand buttons with aria-expanded='false' by default", () => {
      const { container, root } = renderExpandableTable();

      const buttons = getExpandButtons(container);
      expect(buttons).toHaveLength(2);
      expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
      expect(buttons[1]?.getAttribute("aria-expanded")).toBe("false");
      expect(buttons[0]?.getAttribute("aria-label")).toBe("Expand row");

      cleanupTestRoot({ container, root });
    });

    it("expands a row on button click and updates aria-expanded", () => {
      const { container, root } = renderExpandableTable();

      const buttons = getExpandButtons(container);
      act(() => {
        buttons[0]!.click();
      });

      const updatedButtons = getExpandButtons(container);
      expect(updatedButtons[0]?.getAttribute("aria-expanded")).toBe("true");
      expect(updatedButtons[0]?.getAttribute("aria-label")).toBe("Collapse row");
      expect(container.querySelector("[data-testid='expanded-content']")?.textContent).toBe(
        "Details for Alpha",
      );

      cleanupTestRoot({ container, root });
    });

    it("toggles expansion on Enter key", () => {
      const { container, root } = renderExpandableTable();

      const btn = getExpandButtons(container)[0]!;

      // Browsers fire click on Enter for native buttons; simulate the sequence
      act(() => {
        btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        btn.click();
      });

      expect(getExpandButtons(container)[0]?.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector("[data-testid='expanded-content']")).not.toBeNull();

      // Toggle back
      act(() => {
        const updated = getExpandButtons(container)[0]!;
        updated.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        updated.click();
      });

      expect(getExpandButtons(container)[0]?.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector("[data-testid='expanded-content']")).toBeNull();

      cleanupTestRoot({ container, root });
    });

    it("toggles expansion on Space key", () => {
      const { container, root } = renderExpandableTable();

      const btn = getExpandButtons(container)[0]!;

      // Browsers fire click on Space for native buttons; simulate the sequence
      act(() => {
        btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        btn.click();
      });

      expect(getExpandButtons(container)[0]?.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector("[data-testid='expanded-content']")).not.toBeNull();

      // Toggle back
      act(() => {
        const updated = getExpandButtons(container)[0]!;
        updated.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        updated.click();
      });

      expect(getExpandButtons(container)[0]?.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector("[data-testid='expanded-content']")).toBeNull();

      cleanupTestRoot({ container, root });
    });
  });
});
