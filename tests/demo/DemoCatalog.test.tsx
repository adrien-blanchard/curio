import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DemoCatalog from "@/components/demo/DemoCatalog";
import { demoEntries } from "@/lib/demo/data";

describe("DemoCatalog", () => {
  it("renders synthetic entries and filters them locally", () => {
    render(<DemoCatalog entries={demoEntries} />);
    expect(screen.getByText("12 entries")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "relighting" } });
    expect(screen.getByText("1 entry")).toBeInTheDocument();
    expect(screen.getByText(/Prism isolates lighting/)).toBeInTheDocument();
    expect(screen.queryByText(/OpenRender/)).not.toBeInTheDocument();
  });
});
