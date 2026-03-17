// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
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
});
