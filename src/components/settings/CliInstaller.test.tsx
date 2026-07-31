import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CliInstaller } from "./CliInstaller";
import { useUiStore } from "../../store/ui";
import { api } from "../../api/commands";

vi.mock("../../api/commands", () => ({ api: { installCli: vi.fn(), cliStatus: vi.fn() } }));

describe("CliInstaller", () => {
  beforeEach(() => {
    vi.mocked(api.installCli).mockReset();
    vi.mocked(api.cliStatus).mockReset().mockResolvedValue(null);
    useUiStore.setState({ locale: "en" });
  });

  it("writes nothing until it is asked to", async () => {
    // An app that puts executables on someone's PATH because it launched is doing something they
    // did not ask for. This is a button, and it stays one. Reading the STATUS is not writing.
    render(<CliInstaller />);
    await screen.findByText("Not installed yet.");
    expect(api.installCli).not.toHaveBeenCalled();
  });

  it("says where the launcher went, and under which names", async () => {
    vi.mocked(api.installCli).mockResolvedValue({
      directory: "/usr/local/bin",
      names: ["ygg", "yggshell"],
      onPath: true,
    });
    render(<CliInstaller />);
    // The button is disabled until the status is known — otherwise a click could land before the
    // panel can say whether there is anything to install.
    await screen.findByText("Not installed yet.");

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
    // The button is disabled until the status is known — otherwise a click could land before the
    // panel can say whether there is anything to install.
    await screen.findByText("Not installed yet.");

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
    // The button is disabled until the status is known — otherwise a click could land before the
    // panel can say whether there is anything to install.
    await screen.findByText("Not installed yet.");

    fireEvent.click(screen.getByRole("button", { name: "Install ygg command" }));

    await screen.findByText(/\/usr\/local\/bin/);
    expect(screen.queryByText(/is not on your PATH/)).toBeNull();
  });

  it("reports a failure instead of looking like it worked", async () => {
    vi.mocked(api.installCli).mockRejectedValue(new Error("permission denied"));
    render(<CliInstaller />);
    // The button is disabled until the status is known — otherwise a click could land before the
    // panel can say whether there is anything to install.
    await screen.findByText("Not installed yet.");

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
    await screen.findByText("Not installed yet.");

    const button = screen.getByRole("button", { name: "Install ygg command" });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("button", { name: "Installing…" })).toBeDisabled());
    release({ directory: "/usr/local/bin", names: ["ygg"], onPath: true });
    await screen.findByText(/\/usr\/local\/bin/);
    expect(api.installCli).toHaveBeenCalledTimes(1);
  });
});

// The complaint that produced this: the button looked identical whether or not the launcher was
// already installed, so there was nothing to do but press it again — hundreds of times.
describe("saying what is already installed", () => {
  beforeEach(() => {
    vi.mocked(api.installCli).mockReset();
    vi.mocked(api.cliStatus).mockReset();
    useUiStore.setState({ locale: "en" });
  });

  it("says so, and where, when it is already there", async () => {
    vi.mocked(api.cliStatus).mockResolvedValue({
      directory: "/usr/local/bin",
      names: ["ygg", "yggshell"],
      onPath: true,
    });
    render(<CliInstaller />);

    expect(await screen.findByText(/\/usr\/local\/bin/)).toBeInTheDocument();
    expect(screen.getByText(/ygg, yggshell/)).toBeInTheDocument();
  });

  it("offers Reinstall rather than Install once it is there", async () => {
    vi.mocked(api.cliStatus).mockResolvedValue({
      directory: "/usr/local/bin",
      names: ["ygg"],
      onPath: true,
    });
    render(<CliInstaller />);

    expect(await screen.findByRole("button", { name: "Reinstall" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install ygg command" })).toBeNull();
  });

  it("says plainly when it is not installed", async () => {
    vi.mocked(api.cliStatus).mockResolvedValue(null);
    render(<CliInstaller />);

    expect(await screen.findByText("Not installed yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install ygg command" })).toBeInTheDocument();
  });

  it("still warns about PATH for an existing install", async () => {
    // Installed and not found is the state the user cannot diagnose on their own — it has to be said
    // whether the install happened just now or last week.
    vi.mocked(api.cliStatus).mockResolvedValue({
      directory: "/home/s/.local/bin",
      names: ["ygg"],
      onPath: false,
    });
    render(<CliInstaller />);

    expect(await screen.findByText(/is not on your PATH/)).toBeInTheDocument();
  });

  it("does not claim 'not installed' when it simply could not look", async () => {
    // That would send the user to install a second copy over their own.
    vi.mocked(api.cliStatus).mockRejectedValue(new Error("no home directory"));
    render(<CliInstaller />);

    expect(await screen.findByText(/no home directory/)).toBeInTheDocument();
    expect(screen.queryByText("Not installed yet.")).toBeNull();
  });

  it("asks the filesystem rather than remembering", async () => {
    // The user can delete the script; a remembered answer would then be a lie.
    vi.mocked(api.cliStatus).mockResolvedValue(null);
    const { unmount } = render(<CliInstaller />);
    await screen.findByText("Not installed yet.");
    unmount();

    vi.mocked(api.cliStatus).mockResolvedValue({
      directory: "/usr/local/bin",
      names: ["ygg"],
      onPath: true,
    });
    render(<CliInstaller />);
    expect(await screen.findByRole("button", { name: "Reinstall" })).toBeInTheDocument();
  });
});
