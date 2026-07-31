import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliInstaller } from "./CliInstaller";
import { useUiStore } from "../../store/ui";
import { api } from "../../api/commands";

vi.mock("../../api/commands", () => ({ api: { installCli: vi.fn() } }));

describe("CliInstaller", () => {
  beforeEach(() => {
    vi.mocked(api.installCli).mockReset();
    useUiStore.setState({ locale: "en" });
  });

  it("writes nothing until it is asked to", () => {
    // An app that puts executables on someone's PATH because it launched is doing something they
    // did not ask for. This is a button, and it stays one.
    render(<CliInstaller />);
    expect(api.installCli).not.toHaveBeenCalled();
  });

  it("says where the launcher went, and under which names", async () => {
    vi.mocked(api.installCli).mockResolvedValue({
      directory: "/usr/local/bin",
      names: ["ygg", "yggshell"],
      onPath: true,
    });
    render(<CliInstaller />);

    fireEvent.click(screen.getByRole("button", { name: "Install ygg command" }));

    expect(await screen.findByText(/\/usr\/local\/bin/)).toBeInTheDocument();
    expect(screen.getByText(/ygg, yggshell/)).toBeInTheDocument();
  });

  it("warns when it landed somewhere the shell will not look", async () => {
    // The outcome that matters most: installed and not found is worse than not installed, because
    // the user types `ygg`, gets nothing, and has no reason to suspect where the problem is.
    vi.mocked(api.installCli).mockResolvedValue({
      directory: "/home/s/.local/bin",
      names: ["ygg"],
      onPath: false,
    });
    render(<CliInstaller />);

    fireEvent.click(screen.getByRole("button", { name: "Install ygg command" }));

    expect(await screen.findByText(/is not on your PATH/)).toBeInTheDocument();
  });

  it("stays quiet about PATH when there is nothing to warn about", async () => {
    vi.mocked(api.installCli).mockResolvedValue({
      directory: "/usr/local/bin",
      names: ["ygg"],
      onPath: true,
    });
    render(<CliInstaller />);

    fireEvent.click(screen.getByRole("button", { name: "Install ygg command" }));

    await screen.findByText(/\/usr\/local\/bin/);
    expect(screen.queryByText(/is not on your PATH/)).toBeNull();
  });

  it("reports a failure instead of looking like it worked", async () => {
    vi.mocked(api.installCli).mockRejectedValue(new Error("permission denied"));
    render(<CliInstaller />);

    fireEvent.click(screen.getByRole("button", { name: "Install ygg command" }));

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });

  it("cannot be pressed twice while it is working", async () => {
    let release: (value: {
      directory: string;
      names: string[];
      onPath: boolean;
    }) => void = () => {};
    vi.mocked(api.installCli).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<CliInstaller />);

    const button = screen.getByRole("button", { name: "Install ygg command" });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("button", { name: "Installing…" })).toBeDisabled());
    release({ directory: "/usr/local/bin", names: ["ygg"], onPath: true });
    await screen.findByText(/\/usr\/local\/bin/);
    expect(api.installCli).toHaveBeenCalledTimes(1);
  });
});
