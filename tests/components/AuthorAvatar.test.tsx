import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AuthorAvatar from "@/components/AuthorAvatar";

describe("AuthorAvatar", () => {
  it("falls back to readable initials when the Google image cannot load", () => {
    const { container } = render(
      <AuthorAvatar
        email="ada@example.com"
        displayName="Ada Lovelace"
        src="https://lh3.googleusercontent.com/a/unavailable"
        size={24}
      />,
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image!);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("retries with a fresh image state when the avatar URL changes", () => {
    const firstAvatar = "https://lh3.googleusercontent.com/a/unavailable";
    const secondAvatar = "https://lh3.googleusercontent.com/a/available";
    const { container, rerender } = render(
      <AuthorAvatar
        email="ada@example.com"
        displayName="Ada Lovelace"
        src={firstAvatar}
        size={24}
      />,
    );

    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();

    rerender(
      <AuthorAvatar
        email="ada@example.com"
        displayName="Ada Lovelace"
        src={secondAvatar}
        size={24}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", secondAvatar);

    rerender(
      <AuthorAvatar
        email="ada@example.com"
        displayName="Ada Lovelace"
        src={firstAvatar}
        size={24}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", firstAvatar);
  });
});
