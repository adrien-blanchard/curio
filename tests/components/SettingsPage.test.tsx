import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOptionalServerMetadata: vi.fn(),
  requirePageActor: vi.fn(),
}));

vi.mock("@/lib/auth/page", () => ({ requirePageActor: mocks.requirePageActor }));
vi.mock("@/lib/env/server", () => ({
  getOptionalServerMetadata: mocks.getOptionalServerMetadata,
}));
vi.mock("@/components/SignOutButton", () => ({ default: () => <button>Sign out</button> }));
vi.mock("@/app/dashboard/settings/PersonalAccessTokens", () => ({
  default: ({ installUrl }: { installUrl?: string | null }) => (
    <div>Extension flow {installUrl ?? "unpublished"}</div>
  ),
}));

import SettingsPage from "@/app/dashboard/settings/page";

const installUrl = "https://chromewebstore.google.com/detail/bldceafomhokgmndglcllplmnclklcdn";

describe("account extension access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOptionalServerMetadata.mockReturnValue({
      EXTENSION_ENABLED: true,
      NEXT_PUBLIC_EXTENSION_INSTALL_URL: installUrl,
    });
    mocks.requirePageActor.mockResolvedValue({
      role: "contributor",
      user: {
        email: "grace@example.test",
        displayName: "Grace Hopper",
        avatarUrl: null,
      },
    });
  });

  it("shows the guided browser-extension flow to contributors", async () => {
    render(await SettingsPage());
    expect(screen.getByText("Browser extension")).toBeInTheDocument();
    expect(screen.getByText(`Extension flow ${installUrl}`)).toBeInTheDocument();
  });

  it("does not offer a submitting extension to readers", async () => {
    mocks.requirePageActor.mockResolvedValue({
      role: "reader",
      user: {
        email: "reader@example.test",
        displayName: "Read Only",
        avatarUrl: null,
      },
    });
    render(await SettingsPage());
    expect(screen.queryByText("Browser extension")).not.toBeInTheDocument();
  });
});
