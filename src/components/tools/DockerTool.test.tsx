import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerTool } from "./DockerTool";
import { useUiStore } from "../../store/ui";
import type { ContainerInfo } from "../../bindings/ContainerInfo";
import type { ContainerStats } from "../../bindings/ContainerStats";

vi.mock("../../hooks/useContentFontSize", () => ({ useToolFontSize: () => 17 }));
vi.mock("../../api/docker", () => ({
  dockerApi: { containers: vi.fn(), logs: vi.fn(), stats: vi.fn() },
}));

import { dockerApi } from "../../api/docker";

const CONTAINERS: ContainerInfo[] = [
  {
    id: "e7297b70bd2a",
    name: "app-backend",
    state: "running",
    status: "Up 3 hours (healthy)",
    image: "app-backend",
    ports: [],
    project: "app",
  },
  {
    id: "9f3c822e8334",
    name: "app-nginx",
    state: "running",
    status: "Up 3 hours",
    image: "nginx:alpine",
    ports: ["3000→80"],
    project: "app",
  },
  {
    id: "cca7acd39014",
    name: "loose",
    state: "exited",
    status: "Exited (0) 2 days ago",
    image: "redis",
    ports: [],
    project: null,
  },
];

function renderTool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DockerTool />
    </QueryClientProvider>,
  );
}

describe("DockerTool", () => {
  beforeEach(() => {
    vi.mocked(dockerApi.containers).mockReset();
    vi.mocked(dockerApi.logs).mockReset();
    vi.mocked(dockerApi.stats).mockReset();
    vi.mocked(dockerApi.stats).mockResolvedValue([]);
    useUiStore.setState({ locale: "en" });
  });

  it("says there is nothing rather than showing an error when Docker is absent", async () => {
    // Plenty of machines have no Docker and plenty of projects never use it. That is not a failure.
    vi.mocked(dockerApi.containers).mockResolvedValue([]);
    renderTool();

    expect(await screen.findByText(/No containers/)).toBeInTheDocument();
  });

  it("groups containers by their compose project", async () => {
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    renderTool();

    expect(await screen.findByRole("heading", { name: "APP" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /NOT IN A COMPOSE PROJECT/ })).toBeInTheDocument();
  });

  it("keeps the health verdict verbatim", async () => {
    // `(healthy)` and `(health: starting)` are different situations; a green dot loses both.
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    renderTool();

    expect(await screen.findByText(/Up 3 hours \(healthy\)/)).toBeInTheDocument();
  });

  it("shows a stopped container, which is the one you are looking for", async () => {
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    renderTool();

    expect(await screen.findByText("loose")).toBeInTheDocument();
    expect(screen.getByText(/Exited \(0\)/)).toBeInTheDocument();
  });

  it("shows a published port and nothing about unpublished ones", async () => {
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    renderTool();

    expect(await screen.findByText("3000→80")).toBeInTheDocument();
  });

  it("reads a log only when one is opened", async () => {
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    vi.mocked(dockerApi.logs).mockResolvedValue("listening on :80\n");
    renderTool();

    await screen.findByText("app-nginx");
    expect(dockerApi.logs).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /app-nginx/ }));
    expect(await screen.findByText(/listening on :80/)).toBeInTheDocument();
    expect(vi.mocked(dockerApi.logs).mock.calls[0]?.[0]).toBe("9f3c822e8334");
  });

  it("offers no way to start or stop a container", async () => {
    // Deliberate, and recorded: that is a command, and whether this app may issue one is a decision
    // for an ADR rather than for a widget (ADR-PROJ-001 §5).
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    renderTool();

    await screen.findByText("app-nginx");
    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
    expect(labels.some((l) => /start|stop|restart|remove|kill/i.test(l))).toBe(false);
  });

  it("draws its content at the terminal's own text size", async () => {
    // rule:content-size — container names and logs read like a terminal.
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    const { container } = renderTool();

    await screen.findByText("app-nginx");
    const sized = container.querySelector<HTMLElement>("[style*='font-size']");
    expect(sized?.style.fontSize).toBe("17px");
  });
  it("shows live CPU and memory for a container that reports them", async () => {
    // The monitor half. `docker stats` is a separate, ~2 s call, so it arrives independently of the
    // listing — a container with no figures yet simply has no bars, never a zero.
    const STATS: ContainerStats[] = [
      {
        id: "e7297b70bd2a",
        cpu_percent: 23.47,
        mem_used: 712_179_712,
        mem_limit: 2_147_483_648,
        mem_percent: 33.18,
      },
    ];
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    vi.mocked(dockerApi.stats).mockResolvedValue(STATS);
    renderTool();

    expect(await screen.findByText("23%")).toBeInTheDocument();
    const meters = screen.getAllByRole("meter");
    expect(meters.some((m) => m.getAttribute("aria-valuenow") === "33")).toBe(true);
  });

  it("draws no bars for a container docker reported nothing about", async () => {
    // A stopped container has no figures. Drawing an empty bar would claim it is idle rather than
    // gone, which is a different statement.
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    vi.mocked(dockerApi.stats).mockResolvedValue([]);
    renderTool();

    await screen.findByText("app-backend");
    expect(screen.queryAllByRole("meter")).toHaveLength(0);
  });

  it("shows a CPU above one core exactly, even though the bar cannot", async () => {
    // docker scales CPU against a single core: two cores busy reads 200 %. The bar clamps; the
    // number must not, or the panel would quietly understate the thing you opened it to see.
    vi.mocked(dockerApi.containers).mockResolvedValue(CONTAINERS);
    vi.mocked(dockerApi.stats).mockResolvedValue([
      { id: "e7297b70bd2a", cpu_percent: 240, mem_used: 1024, mem_limit: 2048, mem_percent: 50 },
    ]);
    renderTool();

    expect(await screen.findByText("240%")).toBeInTheDocument();
  });
});
