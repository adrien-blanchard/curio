import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname }));

import Sidebar from "@/components/Sidebar";

describe("dashboard sidebar", () => {
  beforeEach(() => {
    mocks.usePathname.mockReturnValue("/dashboard/admin");
  });

  it("calls the administrator-only area Members", () => {
    render(
      <Sidebar
        role="administrator"
        user={{ email: "ada@example.test", displayName: "Ada Lovelace" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/dashboard/admin",
    );
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
  });

  it("does not expose Members to non-administrators", () => {
    render(
      <Sidebar
        role="contributor"
        user={{ email: "grace@example.test", displayName: "Grace Hopper" }}
      />,
    );

    expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
  });

  it("shows the configured Chrome Web Store link", () => {
    const extensionUrl =
      "https://chromewebstore.google.com/detail/bldceafomhokgmndglcllplmnclklcdn";
    render(
      <Sidebar
        role="contributor"
        extensionUrl={extensionUrl}
        user={{ email: "grace@example.test", displayName: "Grace Hopper" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Add to Chrome" })).toHaveAttribute(
      "href",
      extensionUrl,
    );
  });
});
