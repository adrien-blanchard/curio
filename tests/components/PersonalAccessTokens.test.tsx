import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PersonalAccessTokens from "@/app/dashboard/settings/PersonalAccessTokens";

const installUrl = "https://chromewebstore.google.com/detail/bldceafomhokgmndglcllplmnclklcdn";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("browser extension access", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("presents a simple Store and connection-key flow with fixed extension permissions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { tokens: [] }, error: null }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              token: "curio_test_connection_key_that_is_shown_once",
              apiToken: {},
            },
            error: null,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { tokens: [] }, error: null }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PersonalAccessTokens
        allowedScopes={["entries:write", "tags:read", "profile:read"]}
        installUrl={installUrl}
      />,
    );

    expect(screen.getByRole("link", { name: /add to chrome/i })).toHaveAttribute(
      "href",
      installUrl,
    );
    expect(screen.queryByText("Scopes")).not.toBeInTheDocument();
    expect(await screen.findByText("No browser connections yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create connection key" }));

    await screen.findByDisplayValue("curio_test_connection_key_that_is_shown_once");
    const request = fetchMock.mock.calls[1];
    expect(request[0]).toBe("/api/v1/tokens");
    const body = JSON.parse(String(request[1]?.body));
    expect(body).toMatchObject({
      name: "Chrome on this device",
      scopes: ["entries:write", "tags:read", "profile:read"],
    });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 360 * 86_400_000);
  });

  it("does not expose the unpublished Store listing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: { tokens: [] }, error: null })),
    );

    render(
      <PersonalAccessTokens
        allowedScopes={["entries:write", "tags:read", "profile:read"]}
        installUrl={null}
      />,
    );

    await waitFor(() => expect(screen.getByText("No browser connections yet.")).toBeVisible());
    expect(screen.queryByRole("link", { name: /add to chrome/i })).not.toBeInTheDocument();
    expect(screen.getByText(/store link will appear/i)).toBeInTheDocument();
  });

  it("recovers when creating a connection key times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { tokens: [] }, error: null }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PersonalAccessTokens
        allowedScopes={["entries:write", "tags:read", "profile:read"]}
        installUrl={null}
      />,
    );
    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Create connection key" }));
    expect(screen.getByRole("button", { name: /create connection key/i })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/took too long/i);
    expect(screen.getByRole("button", { name: "Create connection key" })).toBeEnabled();
  });
});
