/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

afterEach(cleanup);

describe("SelectValue shows the item label, not the raw value", () => {
  it("derives labels from SelectItem children", () => {
    const { getByRole } = render(
      <Select value="E">
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="E">Expense</SelectItem>
          <SelectItem value="I">Income</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(getByRole("combobox").textContent).toContain("Expense");
  });

  it("finds items rendered from arrays and keeps explicit items", () => {
    const opts = [{ v: "1", l: "One" }, { v: "2", l: "Two" }];
    const { getAllByRole } = render(
      <>
        <Select value="2">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{opts.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value="x" items={{ x: "Explicit" }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="x">Child</SelectItem></SelectContent>
        </Select>
      </>,
    );
    const [a, b] = getAllByRole("combobox");
    expect(a.textContent).toContain("Two");
    expect(b.textContent).toContain("Explicit");
  });
});
