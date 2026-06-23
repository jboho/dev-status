import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServicesScreen } from "./ServicesScreen";
import type { AppConfig } from "./types";

const baseConfig: AppConfig = {
  services: [
    { name: "GitHub", url: "https://www.githubstatus.com/api/v2/summary.json" },
    {
      name: "Vercel",
      url: "https://www.vercel-status.com/api/v2/summary.json",
    },
  ],
};

describe("ServicesScreen – URL editing", () => {
  it("clicking the URL text reveals a prefilled input", () => {
    render(
      <ServicesScreen
        config={baseConfig}
        onBack={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const urlText = screen.getByText(
      "https://www.githubstatus.com/api/v2/summary.json",
    );
    fireEvent.click(urlText);
    const input = screen.getByRole("textbox", { name: /github url/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(
      "https://www.githubstatus.com/api/v2/summary.json",
    );
  });
});

describe("ServicesScreen – URL editing (commit and cancel)", () => {
  it("pressing Enter with a valid URL calls onSave with the updated URL", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, {
      target: { value: "https://newurl.example.com/api/v2/summary.json" },
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith({
      services: [
        {
          name: "GitHub",
          url: "https://newurl.example.com/api/v2/summary.json",
        },
        {
          name: "Vercel",
          url: "https://www.vercel-status.com/api/v2/summary.json",
        },
      ],
    });
  });

  it("blurring the input with a valid URL calls onSave", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, {
      target: { value: "https://newurl.example.com/api/v2/summary.json" },
    });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("pressing Escape cancels without calling onSave", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, {
      target: { value: "https://changed.example.com" },
    });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    // URL text restored to original
    expect(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    ).toBeInTheDocument();
  });
});

describe("ServicesScreen – URL validation", () => {
  it("does not call onSave when Enter is pressed with an invalid URL", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, { target: { value: "not-a-url" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
    // Input still visible (still in edit mode)
    expect(input).toBeInTheDocument();
  });

  it("does not call onSave on blur with an invalid URL", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, { target: { value: "http://not-https.com" } });
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not call onSave when URL is empty", () => {
    const onSave = vi.fn();
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(
      screen.getByText("https://www.githubstatus.com/api/v2/summary.json"),
    );
    const input = screen.getByRole("textbox", { name: /github url/i });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ServicesScreen – toggle regression", () => {
  it("toggling enable/disable still calls onSave with enabled flipped", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ServicesScreen config={baseConfig} onBack={vi.fn()} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /disable github/i }));
    expect(onSave).toHaveBeenCalledWith({
      services: [
        {
          name: "GitHub",
          url: "https://www.githubstatus.com/api/v2/summary.json",
          enabled: false,
        },
        {
          name: "Vercel",
          url: "https://www.vercel-status.com/api/v2/summary.json",
        },
      ],
    });
  });
});
