import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RoleBadge from "@/components/RoleBadge";

describe("role badge", () => {
  it.each([
    ["reader", "Reader", "bg-[#F1F5F9]", "text-[#475569]"],
    ["contributor", "Contributor", "bg-[#ECFDF5]", "text-[#047857]"],
    ["administrator", "Administrator", "bg-[#EAF6FF]", "text-[#005C9E]"],
  ] as const)("uses the shared %s presentation", (role, label, background, foreground) => {
    render(<RoleBadge role={role} />);

    const badge = screen.getByText(label).closest("span");
    expect(badge).toHaveClass(background, foreground, "rounded-full");
    expect(badge?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
