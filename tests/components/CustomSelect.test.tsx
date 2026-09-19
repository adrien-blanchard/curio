import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CustomSelect from "@/components/CustomSelect";

const options = [
  { label: "All users", value: "" },
  {
    label: "Ada Lovelace",
    value: "ada@example.com",
    description: "ada@example.com",
    avatarEmail: "ada@example.com",
    avatarDisplayName: "Ada Lovelace",
    avatarUrl: "https://lh3.googleusercontent.com/a/ada",
  },
  { label: "Grace Hopper", value: "grace@example.com" },
];

describe("CustomSelect", () => {
  it("uses a styled listbox and selects an option with the keyboard", async () => {
    const onChange = vi.fn();
    render(<CustomSelect label="Author" options={options} value="" onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Author: All users" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Author" })).toBeInTheDocument();

    const allUsers = screen.getByRole("option", { name: "All users" });
    await waitFor(() => expect(allUsers).toHaveFocus());
    fireEvent.keyDown(allUsers, { key: "ArrowDown" });

    const ada = screen.getByRole("option", { name: /Ada Lovelace/ });
    expect(ada).toHaveFocus();
    fireEvent.keyDown(ada, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("ada@example.com");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("shows a Google avatar and closes without a change on Escape", async () => {
    const onChange = vi.fn();
    render(
      <CustomSelect
        ariaLabel="Author filter"
        options={options}
        value="ada@example.com"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Author filter: Ada Lovelace" });
    fireEvent.click(trigger);
    const avatar = trigger.querySelector("img");
    expect(avatar).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/ada");

    const ada = screen.getByRole("option", { name: /Ada Lovelace/ });
    await waitFor(() => expect(ada).toHaveFocus());
    fireEvent.keyDown(ada, { key: "Escape" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps keyboard focus in filtered results when search is enabled", async () => {
    const onChange = vi.fn();
    render(
      <CustomSelect label="Author" options={options} value="" onChange={onChange} showSearch />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Author: All users" }));
    const search = screen.getByRole("searchbox", { name: "Search author" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.change(search, { target: { value: "Grace" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });

    const grace = screen.getByRole("option", { name: "Grace Hopper" });
    expect(grace).toHaveFocus();
    fireEvent.keyDown(grace, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("grace@example.com");
  });

  it("stops a search Escape before it reaches enclosing document shortcuts", async () => {
    const documentEscape = vi.fn();
    document.addEventListener("keydown", documentEscape);
    render(
      <CustomSelect label="Author" options={options} value="" onChange={vi.fn()} showSearch />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Author: All users" }));
    const search = screen.getByRole("searchbox", { name: "Search author" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Author" })).not.toBeInTheDocument();
    expect(documentEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", documentEscape);
  });

  it("portals the menu outside clipping containers without breaking selection", () => {
    const onChange = vi.fn();
    render(
      <div data-testid="clipping-container" className="overflow-hidden">
        <CustomSelect label="Role" options={options} value="" onChange={onChange} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Role: All users" }));
    const listbox = screen.getByRole("listbox", { name: "Role" });
    const clippingContainer = screen.getByTestId("clipping-container");
    const dropdown = listbox.parentElement;

    expect(clippingContainer).not.toContainElement(listbox);
    expect(dropdown).toHaveClass("fixed", "z-[200]");
    expect(dropdown).toHaveStyle({ visibility: "visible" });

    const grace = screen.getByRole("option", { name: "Grace Hopper" });
    fireEvent.pointerDown(grace);
    fireEvent.click(grace);
    expect(onChange).toHaveBeenCalledWith("grace@example.com");
  });

  it("preserves the trigger's logical Tab order from portaled search and options", async () => {
    render(
      <>
        <button type="button">Before filter</button>
        <div className="overflow-hidden">
          <CustomSelect label="Author" options={options} value="" onChange={vi.fn()} showSearch />
        </div>
        <button type="button">After filter</button>
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Author: All users" });
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "Search author" });
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: "Tab" });
    expect(screen.getByRole("button", { name: "After filter" })).toHaveFocus();

    fireEvent.click(trigger);
    const reopenedSearch = screen.getByRole("searchbox", { name: "Search author" });
    await waitFor(() => expect(reopenedSearch).toHaveFocus());
    fireEvent.keyDown(reopenedSearch, { key: "ArrowDown" });
    const firstOption = screen.getByRole("option", { name: "All users" });
    expect(firstOption).toHaveFocus();
    fireEvent.keyDown(firstOption, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Before filter" })).toHaveFocus();
  });

  it("limits menu height to the viewport and recomputes it on resize", () => {
    const heightSpy = vi
      .spyOn(document.documentElement, "clientHeight", "get")
      .mockReturnValue(120);
    render(<CustomSelect label="Source" options={options} value="" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Source: All users" });
    const rectSpy = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 50,
      height: 30,
      left: 20,
      right: 120,
      top: 20,
      width: 100,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "Source" });
    const dropdown = listbox.parentElement;
    expect(dropdown).toHaveStyle({ maxHeight: "50px" });
    expect(listbox).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");

    heightSpy.mockReturnValue(180);
    fireEvent(window, new Event("resize"));
    expect(dropdown).toHaveStyle({ maxHeight: "110px" });

    rectSpy.mockRestore();
    heightSpy.mockRestore();
  });

  it("listens for outside pointer events only while its menu is open", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    render(<CustomSelect label="Source" options={options} value="" onChange={vi.fn()} />);

    const pointerAdds = () => addSpy.mock.calls.filter(([type]) => type === "pointerdown");
    const pointerRemovals = () => removeSpy.mock.calls.filter(([type]) => type === "pointerdown");
    expect(pointerAdds()).toHaveLength(0);

    const trigger = screen.getByRole("button", { name: "Source: All users" });
    fireEvent.click(trigger);
    expect(pointerAdds()).toHaveLength(1);
    fireEvent.click(trigger);
    expect(pointerRemovals()).toHaveLength(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
